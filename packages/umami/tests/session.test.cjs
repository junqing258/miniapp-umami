const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

async function runtime(options = {}, wxOverrides = {}) {
  const requests = [];
  const timers = new Map();
  let now = 100000;
  let timerId = 0;
  let width = 390;
  class Clock extends Date {
    static now() {
      return now;
    }
  }
  const context = vm.createContext({
    console,
    Date: Clock,
    setTimeout(fn, delay) {
      timerId += 1;
      timers.set(timerId, { fn, at: now + delay });
      return timerId;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    getCurrentPages: () => [{ route: 'pages/home/index' }],
    wx: {
      getDeviceInfo: () => ({ brand: 'Apple', model: 'iPhone', system: 'iOS 18', platform: 'ios', id: 'private' }),
      getAppBaseInfo: () => ({ version: '8.0.60', SDKVersion: '3.18.0', language: 'zh_CN' }),
      getAccountInfoSync: () => ({ miniProgram: { version: '2.3.4', envVersion: 'release', appId: 'private' } }),
      getWindowInfo: () => ({
        screenWidth: 390,
        screenHeight: 844,
        windowWidth: width,
        windowHeight: 700,
        pixelRatio: 3,
      }),
      request: (request) => requests.push(request),
      ...wxOverrides,
    },
  });
  const modules = new Map();
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename);
    const module = new vm.SourceTextModule(readFileSync(filename, 'utf8'), { context, identifier: filename });
    modules.set(filename, module);
    return module;
  }
  const module = load(path.resolve(__dirname, '../src/index.js'));
  await module.link((specifier, parent) =>
    load(path.resolve(path.dirname(parent.identifier), path.extname(specifier) ? specifier : `${specifier}.js`)),
  );
  await module.evaluate();
  const sdk = module.namespace.default;
  sdk.init({
    enabled: true,
    endpoint: 'https://example.com/api/send',
    websiteId: 'test',
    hostname: 'miniapp.local',
    tag: 'test-audience',
    eventProperties: { search_submit: ['source', 'keyword_length'], home_release_entry_click: [] },
    ...options,
  });
  return {
    sdk,
    requests,
    timers,
    page() {
      sdk.trackPageview({ url: '/pages/home/index' });
      sdk.flush();
    },
    resize(value) {
      width = value;
    },
    respond(request, data = {}, statusCode = 200) {
      request.success({ statusCode, data });
      request.complete();
    },
    advance(ms) {
      now += ms;
      [...timers].forEach(([id, timer]) => {
        if (timer.at <= now) {
          timers.delete(id);
          timer.fn();
        }
      });
    },
  };
}

test('batch response sends device and release data only as session properties while preserving custom event data', async () => {
  const r = await runtime();
  r.sdk.setEntryOptions({ scene: 1047, query: { utm_campaign: 'campaign', token: 'private' } });
  r.sdk.trackPageview({ url: '/pages/home/index' });
  r.resize(700);
  r.sdk.track('search_submit', { source: 'home', keyword_length: 3, wx_model: 'spoofed' });
  r.sdk.flush();
  assert.equal(r.requests.length, 1);
  const batch = r.requests[0];
  assert.equal(batch.url, 'https://example.com/api/batch');
  assert.equal(batch.data.length, 2);
  assert.deepEqual(Object.keys(batch.data[0].payload.data), ['wx_scene', 'wx_scene_name', 'wx_scene_category']);
  assert.deepEqual(Object.keys(batch.data[1].payload.data), [
    'source',
    'keyword_length',
    'wx_scene',
    'wx_scene_name',
    'wx_scene_category',
  ]);
  assert.equal(batch.data[1].payload.data.keyword_length, 3);
  assert.doesNotMatch(JSON.stringify(batch.data), /miniapp_version|miniapp_env|wx_model|wx_window|wx_screen|wx_pixel/);
  r.respond(batch, { processed: 2, errors: 0, cache: 'session-a' });
  assert.equal(r.requests.length, 2);
  const identify = r.requests[1];
  assert.equal(identify.url, 'https://example.com/api/send');
  assert.equal(identify.header['x-umami-cache'], 'session-a');
  assert.equal(identify.data.type, 'identify');
  assert.deepEqual(JSON.parse(JSON.stringify(identify.data.payload)), {
    website: 'test',
    hostname: 'miniapp.local',
    language: 'zh-CN',
    data: {
      wx_brand: 'Apple',
      wx_model: 'iPhone',
      wx_system: 'iOS 18',
      wx_platform: 'ios',
      wx_version: '8.0.60',
      wx_sdk_version: '3.18.0',
      wx_language: 'zh-CN',
      miniapp_version: '2.3.4',
      miniapp_env: 'release',
    },
  });
  assert.doesNotMatch(
    JSON.stringify(identify.data),
    /private|spoofed|scene|campaign|window|screen|pixel|"id"|"name"|"url"|"tag"/,
  );
  r.respond(identify, { cache: 'session-a' });
  r.page();
  assert.equal(r.requests[2].header['x-umami-cache'], 'session-a');
  r.respond(r.requests[2], { cache: 'session-a' });
  assert.equal(r.requests.length, 3, 'same token must not repeatedly write session properties');
  r.page();
  r.respond(r.requests[3], { cache: 'session-b' });
  assert.equal(r.requests[4].data.type, 'identify');
  assert.equal(r.requests[4].header['x-umami-cache'], 'session-b');
  r.respond(r.requests[4], { cache: 'session-b' });
  assert.equal(r.timers.size, 0);
});

test('session release metadata is cached, bounded and omitted safely when unavailable', async () => {
  await Promise.all(
    [
      { version: ' 2.3.4 ', envVersion: 'release' },
      { version: '', envVersion: 'develop' },
      { version: '😀'.repeat(100), envVersion: 'invalid' },
      null,
    ].map(async (info) => {
      let reads = 0;
      const r = await runtime(
        {},
        {
          getAccountInfoSync() {
            reads += 1;
            if (!info) throw new Error('unsupported');
            return { miniProgram: { ...info, appId: 'private' } };
          },
        },
      );
      r.page();
      r.respond(r.requests[0], { cache: 'session-a' });
      const { data } = r.requests[1].data.payload;
      assert.equal(
        data.miniapp_version,
        info && info.version ? Array.from(info.version.trim()).slice(0, 80).join('') : undefined,
      );
      assert.equal(
        data.miniapp_env,
        info && ['develop', 'release'].includes(info.envVersion) ? info.envVersion : undefined,
      );
      assert.equal(data.wx_version, '8.0.60');
      r.respond(r.requests[1], { cache: 'session-a' });
      r.page();
      r.respond(r.requests[2], { cache: 'session-b' });
      assert.equal(reads, 1);
      assert.doesNotMatch(JSON.stringify(r.requests[3].data), /private/);
      r.respond(r.requests[3], { cache: 'session-b' });
    }),
  );
});

test('legacy system metadata is sanitized for sessions without leaking into event properties', async () => {
  const r = await runtime(
    {},
    {
      getDeviceInfo() {
        throw new Error('unsupported');
      },
      getAppBaseInfo: () => null,
      getSystemInfoSync: () => ({ brand: 'x'.repeat(100), model: {}, platform: 'devtools', cameraAuthorized: true }),
    },
  );
  r.page();
  assert.equal(r.requests[0].data.payload.data, undefined);
  r.respond(r.requests[0], { cache: 'session' });
  const { data } = r.requests[1].data.payload;
  assert.equal(data.wx_brand.length, 80);
  assert.equal(data.wx_platform, 'devtools');
  assert.equal(data.wx_model, undefined);
  assert.equal(data.cameraAuthorized, undefined);
  r.respond(r.requests[1], { cache: 'session' });
});

test('bot-filtered responses, opt out and missing system APIs never manufacture sessions or empty identify calls', async () => {
  const bot = await runtime();
  bot.page();
  bot.respond(bot.requests[0], { beep: 'boop' });
  bot.sdk.flush();
  assert.equal(bot.requests.length, 1);
  const disabled = await runtime({ sessionProperties: false });
  disabled.page();
  disabled.respond(disabled.requests[0], { cache: 'session' });
  assert.equal(disabled.requests.length, 1);
  const optedOut = await runtime({ enabled: false });
  optedOut.page();
  assert.equal(optedOut.requests.length, 0);
  const missing = await runtime(
    {},
    {
      getDeviceInfo: undefined,
      getAppBaseInfo: undefined,
      getAccountInfoSync: undefined,
      getWindowInfo: undefined,
    },
  );
  missing.page();
  missing.respond(missing.requests[0], { cache: 'session' });
  assert.equal(missing.requests.length, 1);
});

test('stale identify responses cannot replace a newer session; response token refreshes do not cause a loop', async () => {
  const r = await runtime();
  r.page();
  r.respond(r.requests[0], { cache: 'old-session' });
  const oldIdentify = r.requests[1];
  r.page();
  r.respond(r.requests[2], { cache: 'new-session' });
  assert.equal(r.requests.length, 3, 'only one identify may be in flight');
  r.respond(oldIdentify, { cache: 'old-session' });
  const currentIdentify = r.requests[3];
  assert.equal(currentIdentify.header['x-umami-cache'], 'new-session');
  r.respond(currentIdentify, { cache: 'refreshed-session' });
  assert.equal(r.requests.length, 4, 'identify token refresh must not trigger another identify');
  r.page();
  assert.equal(r.requests[4].header['x-umami-cache'], 'refreshed-session');
  r.respond(r.requests[4], { cache: 'refreshed-session' });
  assert.equal(r.requests.length, 5);
});

test('identify failures use bounded backoff without blocking ordinary tracking or retrying on every event', async () => {
  const r = await runtime();
  r.page();
  r.respond(r.requests[0], { cache: 'session' });
  r.respond(r.requests[1], {}, 503);
  r.sdk.flush();
  assert.equal(r.requests.length, 2, 'lifecycle flush must preserve identify backoff');
  r.page();
  r.respond(r.requests[2], { cache: 'session' });
  assert.equal(r.requests.length, 3, 'new events must not bypass identify backoff');
  r.advance(2000);
  r.requests[3].fail();
  r.requests[3].complete();
  r.advance(4000);
  r.respond(r.requests[4], {}, 500);
  r.advance(60000);
  r.page();
  r.respond(r.requests[5], { cache: 'session' });
  assert.equal(r.requests.filter(({ data }) => data.type === 'identify').length, 3);
  assert.equal(r.requests.length, 6);
  assert.equal(r.timers.size, 0);
});

test('disabling and re-enabling discards both stale normal and identify callbacks without losing new queued events', async () => {
  const r = await runtime();
  r.page();
  r.respond(r.requests[0], { cache: 'old-session' });
  const staleIdentify = r.requests[1];
  r.page();
  const staleEvent = r.requests[2];
  r.sdk.setEnabled(false);
  r.sdk.setEnabled(true);
  r.page();
  const currentEvent = r.requests[3];
  assert.equal(currentEvent.header['x-umami-cache'], undefined);
  r.respond(currentEvent, { cache: 'current-session' });
  const currentIdentify = r.requests[4];
  r.respond(staleIdentify, { cache: 'stale-identify' });
  r.respond(staleEvent, { cache: 'stale-event' });
  staleIdentify.fail();
  staleEvent.fail();
  r.respond(currentIdentify, { cache: 'current-session' });
  r.page();
  assert.equal(r.requests[5].header['x-umami-cache'], 'current-session');
  r.respond(r.requests[5], { cache: 'current-session' });
  r.advance(60000);
  assert.equal(r.requests.length, 6);
  assert.equal(r.timers.size, 0);
});

test('identify rejection and synchronous request exceptions are isolated from page tracking', async () => {
  await Promise.all(
    [400, 429, 200].map(async (status) => {
      const r = await runtime();
      r.page();
      r.respond(r.requests[0], { cache: 'session' });
      r.respond(r.requests[1], { beep: 'boop' }, status);
      r.sdk.flush();
      r.page();
      r.respond(r.requests[2], { cache: 'session' });
      assert.equal(r.requests.length, 3);
    }),
  );
  const requests = [];
  const r = await runtime(
    {},
    {
      request(request) {
        requests.push(request);
        if (request.data.type === 'identify') throw new Error('request unavailable');
      },
    },
  );
  r.page();
  assert.doesNotThrow(() => r.respond(requests[0], { cache: 'session' }));
  r.advance(2000);
  r.advance(4000);
  assert.equal(requests.length, 4);
  assert.equal(r.timers.size, 0);
  r.page();
  assert.equal(requests[4].data.type, 'event');
  r.respond(requests[4], { cache: 'session' });
});

test('batch fallback still establishes a shared session before identifying without batching identify records', async () => {
  const r = await runtime();
  r.sdk.trackPageview({ url: '/pages/home/index' });
  r.sdk.track('home_release_entry_click');
  r.sdk.flush();
  r.respond(r.requests[0], {}, 404);
  const first = r.requests[1];
  assert.equal(first.url, 'https://example.com/api/send');
  r.respond(first, { cache: 'session' });
  const identify = r.requests[2];
  const second = r.requests[3];
  assert.equal(identify.data.type, 'identify');
  assert.equal(second.data.type, 'event');
  assert.equal(identify.header['x-umami-cache'], second.header['x-umami-cache']);
  r.respond(identify, { cache: 'session' });
  r.respond(second, { cache: 'session' });
  assert.equal(r.requests.length, 4);
});
