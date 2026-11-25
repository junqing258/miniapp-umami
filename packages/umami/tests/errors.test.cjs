const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

async function runtime({ config = {}, request, account } = {}) {
  const requests = [];
  const timers = new Map();
  let time = 100000;
  let timerId = 0;
  class Clock extends Date {
    static now() {
      return time;
    }
  }
  const context = vm.createContext({
    console,
    Date: Clock,
    setTimeout(fn) {
      timerId += 1;
      timers.set(timerId, fn);
      return timerId;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    wx: {
      getAccountInfoSync:
        account || (() => ({ miniProgram: { version: '2.3.4', envVersion: 'trial', appId: 'private' } })),
      request(options) {
        requests.push(options);
        if (request) request(options);
      },
    },
  });
  const modules = new Map();
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename);
    const module = new vm.SourceTextModule(readFileSync(filename, 'utf8'), { context, identifier: filename });
    modules.set(filename, module);
    return module;
  }
  const module = load(path.resolve(__dirname, '../src/errors.js'));
  await module.link((specifier, parent) =>
    load(path.resolve(path.dirname(parent.identifier), path.extname(specifier) ? specifier : `${specifier}.js`)),
  );
  await module.evaluate();
  const source = { sessionCache: '' };
  const monitor = new module.namespace.default(
    { endpoint: 'https://example.com/api/send', websiteId: 'test', errors: config },
    source,
    () => ({
      url: '/pages/home/index?token=private#private',
      language: 'zh-CN',
      screen: '390x844',
      data: { wx_platform: 'ios', phone: 'private' },
    }),
  );
  return {
    monitor,
    source,
    requests,
    timers,
    sanitize: module.namespace.sanitizeErrorText,
    advance(ms) {
      time += ms;
    },
    respond(statusCode = 200, data = {}, header = {}) {
      const latest = requests[requests.length - 1];
      latest.success({ statusCode, data, header });
      latest.complete();
    },
    tick() {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((fn) => fn());
    },
  };
}

test('error payload strips credentials and business objects but preserves source locations', async () => {
  const r = await runtime();
  r.monitor.capture({
    name: 'TypeError',
    message: 'failure token=private phone=13800138000 a@example.com',
    stack:
      'at https://user:private@example.com/app.js?token=private#private:12:3\n at /pages/home.js?token=private:9:2',
    extra: { secret: 'private' },
  });
  assert.equal(r.requests.length, 1);
  const { data, url } = r.requests[0];
  assert.equal(url, 'https://example.com/api/send');
  assert.equal(data.type, 'error');
  assert.equal(data.payload.release, '2.3.4');
  assert.equal(data.payload.environment, 'trial');
  assert.equal(data.payload.tags.wx_platform, 'ios');
  assert.match(data.payload.stack, /https:\/\/example.com\/app.js:12:3/);
  assert.equal(data.payload.url, '/pages/home/index');
  assert.doesNotMatch(JSON.stringify(data), /private|13800138000|a@example.com|appId/);
  assert.equal(
    r.sanitize('Bearer private 13800138000 "token":"private"'),
    'Bearer [redacted] [phone] "token=[redacted]',
  );
  r.respond();
  r.monitor.capture({ arbitrary: 'private' });
  assert.equal(r.requests[1].data.payload.message, 'Non-Error exception');
});

test('error queue reuses server sessions and does not batch errors or emit PV', async () => {
  const r = await runtime();
  r.source.sessionCache = 'server-session';
  r.monitor.capture(new Error('one'));
  r.monitor.capture(new Error('two'));
  assert.equal(r.requests.length, 1);
  assert.equal(r.requests[0].header['x-umami-cache'], 'server-session');
  r.respond(200, { cache: 'updated-session' });
  assert.equal(r.requests.length, 2);
  assert.equal(r.requests[1].header['x-umami-cache'], 'updated-session');
  assert.equal(r.source.sessionCache, 'updated-session');
  assert.equal(r.requests[1].url, 'https://example.com/api/send');
  assert.equal(Array.isArray(r.requests[1].data), false);
  r.monitor.setEnabled(false);
  r.respond(200, { cache: 'late-session' });
  assert.equal(r.source.sessionCache, 'updated-session');
  assert.equal(r.monitor.queue.length, 0);
});

test('identical errors deduplicate for one second, repeated occurrences get new ids, volume is bounded', async () => {
  const r = await runtime();
  const error = { message: 'same', stack: 'at home.js:1:2' };
  r.monitor.capture(error);
  r.respond();
  r.monitor.capture({ ...error });
  assert.equal(r.requests.length, 1);
  r.advance(1000);
  r.monitor.capture(error);
  assert.equal(r.requests.length, 2);
  assert.notEqual(r.requests[0].data.payload.eventId, r.requests[1].data.payload.eventId);
  r.respond();
  for (let i = 0; i < 100; i += 1) r.monitor.capture(`failure ${i}`);
  assert.ok(r.monitor.queue.length <= 20);
  assert.equal(r.monitor.count, 20);
  r.advance(60000);
  r.respond();
  r.monitor.capture('next minute');
  assert.equal(r.monitor.count, 1);
});

test('network and server failures retry twice with a stable id, client rejection drops and 429 pauses', async () => {
  const r = await runtime();
  r.monitor.capture('network failure');
  const id = r.requests[0].data.payload.eventId;
  for (let i = 0; i < 3; i += 1) {
    r.requests[i].fail();
    r.requests[i].complete();
    r.advance(10000);
    r.tick();
  }
  assert.equal(r.requests.length, 3);
  assert.equal(r.monitor.queue.length, 0);
  r.requests.forEach((req) => assert.equal(req.data.payload.eventId, id));
  r.monitor.capture('bad payload');
  r.respond(400);
  assert.equal(r.monitor.queue.length, 0);
  r.monitor.capture('server failure');
  r.respond(503);
  assert.equal(r.monitor.queue.length, 1);
  r.advance(10000);
  r.tick();
  r.respond();
  r.monitor.capture('rate limited');
  r.monitor.capture('pending');
  r.respond(429, {}, { 'retry-after': '10' });
  assert.equal(r.monitor.queue.length, 0);
  const count = r.requests.length;
  r.monitor.capture('during pause');
  assert.equal(r.requests.length, count);
  r.advance(10000);
  r.monitor.capture('after pause');
  assert.equal(r.requests.length, count + 1);
});

test('malformed errors, unavailable APIs, request exceptions and disabled queues cannot break business code', async () => {
  const r = await runtime({
    request() {
      throw new Error('request unavailable');
    },
    account() {
      throw new Error('unsupported');
    },
  });
  assert.doesNotThrow(() =>
    r.monitor.capture({
      get message() {
        throw new Error('getter');
      },
    }),
  );
  assert.doesNotThrow(() => r.monitor.capture('x'.repeat(20000)));
  assert.equal(r.requests[0].data.payload.environment, 'unknown');
  assert.equal(r.requests[0].data.payload.message.length, 2000);
  assert.equal(r.requests[0].data.payload.stack.length, 8000);
  assert.equal(r.monitor.sending, false);
  r.monitor.setEnabled(false);
  assert.equal(r.timers.size, 0);
  assert.equal(r.monitor.queue.length, 0);
  r.monitor.capture('disabled');
  assert.equal(r.requests.length, 1);
});

test('new errors and lifecycle flushes preserve the retry backoff', async () => {
  const r = await runtime();
  r.monitor.capture('first failure');
  r.respond(503);
  r.monitor.capture('second failure');
  r.monitor.flush();
  assert.equal(r.requests.length, 1);
  r.advance(10000);
  r.tick();
  assert.equal(r.requests.length, 2);
  r.respond();
  assert.equal(r.requests.length, 3);
  assert.equal(r.requests[2].data.payload.message, 'second failure');
});
