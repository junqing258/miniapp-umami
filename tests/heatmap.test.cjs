const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

async function runtime(configResponse = { enabled: true, heatmapEnabled: true, heatmapSampleRate: 1 }) {
  const requests = [];
  const timers = new Map();
  let nextTimer = 0;
  const context = vm.createContext({
    console,
    setTimeout(fn) {
      nextTimer += 1;
      timers.set(nextTimer, fn);
      return nextTimer;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    wx: {
      request(options) {
        if (options.method === 'GET') options.success({ statusCode: 200, data: configResponse });
        else requests.push(options);
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
  const module = load(path.resolve(__dirname, '../utils/umami/heatmap.js'));
  await module.link((specifier, parent) => load(path.resolve(path.dirname(parent.identifier), `${specifier}.js`)));
  await module.evaluate();
  const Transport = Object.getPrototypeOf(module.namespace.default);
  let heatmap;
  const source = new Transport({ endpoint: 'https://example.com/api/send', onResponse: () => heatmap.flush() });
  heatmap = new module.namespace.default(
    {
      endpoint: 'https://example.com/api/send',
      websiteId: 'test',
      heatmap: { enabled: true },
    },
    source,
  );
  const metrics = { viewportW: 390, viewportH: 700, pageW: 390, pageH: 2000 };
  const point = { x: 10, y: 20, pageX: 10, pageY: 420 };
  return { heatmap, source, requests, timers, metrics, point, sanitize: module.namespace.sanitizeHeatmap };
}

test('heatmap waits for a real session token and batches coordinates with the native record protocol', async () => {
  const { heatmap, source, requests, metrics, point } = await runtime();
  heatmap.track('click', '/pages/home/index?token=private', metrics, { ...point, text: 'private' });
  heatmap.track('scroll', '/pages/home/index', metrics, { scrollPct: 70 });
  heatmap.flush();
  assert.equal(requests.length, 0);
  source.sessionCache = 'server-session';
  heatmap.flush();
  assert.equal(requests.length, 1);
  const req = requests[0];
  assert.equal(req.url, 'https://example.com/api/record');
  assert.equal(req.header['x-umami-cache'], 'server-session');
  assert.equal(req.data.type, 'heatmap');
  assert.equal(req.data.payload.events.length, 2);
  assert.equal(req.data.payload.events[0].pageY, 420);
  assert.equal(req.data.payload.events[0].url, '/pages/home/index');
  assert.doesNotMatch(JSON.stringify(req.data), /private|server-session/);
  req.success({ statusCode: 200, data: { ok: true } });
  req.complete();
  assert.equal(heatmap.queue.length, 0);
});

test('heatmap rejects malformed geometry and coordinates rather than rendering false hotspots', async () => {
  const { sanitize, metrics, point } = await runtime();
  [NaN, Infinity, -1, '20', null].forEach((bad) => {
    assert.equal(sanitize('click', '/test', metrics, { ...point, x: bad }), null);
  });
  assert.equal(sanitize('click', '/test', metrics, { ...point, pageY: 2001 }), null);
  assert.equal(sanitize('click', '/test', { ...metrics, viewportH: 0 }, point), null);
  assert.equal(sanitize('click', '/test', { ...metrics, pageH: 1 }, point), null);
  assert.equal(sanitize('scroll', '/test', metrics, { scrollPct: NaN }), null);
  assert.equal(sanitize('scroll', '/test', metrics, { scrollPct: 110 }).scrollPct, 100);
});

test('a real batch response releases pending heatmaps and disabling ignores late session responses', async () => {
  const { heatmap, source, metrics, point, requests } = await runtime();
  heatmap.track('click', '/test', metrics, point);
  source.enqueue({ type: 'event', payload: { website: 'test', url: '/test' } });
  source.enqueue({ type: 'event', payload: { website: 'test', url: '/test', name: 'test-event' } });
  source.flush();
  const batch = requests[0];
  assert.equal(batch.url, 'https://example.com/api/batch');
  batch.success({ statusCode: 200, data: { processed: 2, errors: 0, cache: 'issued-by-server' } });
  batch.complete();
  assert.equal(requests[1].url, 'https://example.com/api/record');
  assert.equal(requests[1].header['x-umami-cache'], 'issued-by-server');
  source.setEnabled(false);
  batch.success({ statusCode: 200, data: { cache: 'late-response' } });
  assert.equal(source.sessionCache, '');
  assert.equal(requests.length, 2);
});

test('disabled or unsampled recorder never queues heatmap data; pending session queue remains bounded', async () => {
  await Promise.all(
    [
      { enabled: false },
      { enabled: true, heatmapEnabled: false },
      { enabled: true, heatmapEnabled: true, heatmapSampleRate: 0 },
    ].map(async (config) => {
      const { heatmap, metrics, point } = await runtime(config);
      heatmap.track('click', '/test', metrics, point);
      assert.equal(heatmap.queue.length, 0);
    }),
  );
  const { heatmap, metrics, point } = await runtime();
  for (let i = 0; i < 100; i += 1) heatmap.track('click', '/test', metrics, point);
  assert.equal(heatmap.queue.length, 50);
  heatmap.setEnabled(false);
  assert.equal(heatmap.queue.length, 0);
});

test('heatmap handles explicit recorder rejection and network failure without infinite retries', async () => {
  const { heatmap, source, metrics, point, requests } = await runtime();
  source.sessionCache = 'server-session';
  heatmap.track('click', '/test', metrics, point);
  heatmap.flush();
  requests[0].success({ statusCode: 200, data: { ok: false, reason: 'heatmap_disabled' } });
  requests[0].complete();
  assert.equal(heatmap.collecting, false);
  assert.equal(heatmap.queue.length, 0);
  const failing = await runtime();
  failing.source.sessionCache = 'server-session';
  failing.heatmap.track('click', '/test', metrics, point);
  for (let i = 0; i < 3; i += 1) {
    failing.heatmap.flush();
    failing.requests[i].fail();
    failing.requests[i].complete();
  }
  assert.equal(failing.requests.length, 3);
  assert.equal(failing.heatmap.queue.length, 0);
});

async function pageRuntime(route = 'pages/dataCenter/index') {
  const calls = [];
  const timers = new Map();
  let nextTimer = 0;
  let scrollTop = 0;
  let surface = false;
  const sdk = {
    isHeatmapEnabled: () => true,
    trackHeatmap: (...args) => calls.push(JSON.parse(JSON.stringify(args))),
  };
  const context = vm.createContext({
    setTimeout(fn) {
      nextTimer += 1;
      timers.set(nextTimer, fn);
      return nextTimer;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    wx: {
      getWindowInfo: () => ({ windowWidth: 390, windowHeight: 700 }),
      createSelectorQuery() {
        const query = {
          in() {
            return query;
          },
          select(selector) {
            surface = selector.includes('umami-scroll') || selector.includes('scroll-content');
            return query;
          },
          selectViewport() {
            return query;
          },
          boundingClientRect() {
            return query;
          },
          scrollOffset() {
            return query;
          },
          exec(callback) {
            if (surface)
              callback([
                { width: 390, height: 600, left: 0, top: 100 },
                { width: 390, height: 2000 },
                { scrollLeft: 0, scrollTop },
              ]);
            else
              callback([
                { right: 390, bottom: 2000 - scrollTop },
                { scrollLeft: 0, scrollTop },
              ]);
          },
        };
        return query;
      },
    },
  });
  const filename = path.resolve(__dirname, '../utils/umami/heatmap-page.js');
  const module = new vm.SourceTextModule(readFileSync(filename, 'utf8'), { context });
  await module.link(
    () =>
      new vm.SyntheticModule(
        ['default'],
        function () {
          this.setExport('default', sdk);
        },
        { context },
      ),
  );
  await module.evaluate();
  const page = { route, __umamiHeatmapVisible: true };
  return {
    page,
    calls,
    timers,
    api: module.namespace,
    scroll(value) {
      scrollTop = value;
    },
    tick() {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((fn) => fn());
    },
  };
}

test('page scroll reports increasing depth and cached taps survive immediate navigation without collecting text', async () => {
  const r = await pageRuntime();
  r.api.startHeatmapPage(r.page);
  r.tick();
  assert.equal(r.calls[0][3].scrollPct, 35);
  r.scroll(500);
  r.api.heatmapScroll(r.page);
  r.tick();
  assert.equal(r.calls[1][3].scrollPct, 60);
  r.api.heatmapTap(r.page, {
    changedTouches: [{ clientX: 20, clientY: 30, pageX: 20, pageY: 530 }],
    target: { dataset: { phone: 'private' } },
  });
  r.api.stopHeatmapPage(r.page);
  assert.equal(r.calls[2][3].pageY, 530);
  assert.equal(r.timers.size, 0);
  assert.doesNotMatch(JSON.stringify(r.calls), /private|phone/);
});

test('native scroll-view coordinates stay separate from viewport clicks; CSS scrolling pages do not invent depth', async () => {
  const r = await pageRuntime('pages/message/index');
  r.scroll(500);
  r.api.heatmapSurfaceScroll(r.page);
  r.tick();
  assert.equal(r.calls[0][1], 'pages/message/index/heatmap-scroll');
  assert.equal(r.calls[0][3].scrollPct, 55);
  r.api.heatmapTap(r.page, { changedTouches: [{ clientX: 20, clientY: 150 }] }, true);
  assert.equal(r.calls[1][3].y, 50);
  assert.equal(r.calls[1][3].pageY, 550);
  const home = await pageRuntime('pages/home/index');
  home.api.startHeatmapPage(home.page);
  home.tick();
  assert.equal(home.calls.length, 0);
  home.api.heatmapTap(home.page, { detail: { x: 20, y: 30 } });
  assert.equal(home.calls.length, 0, 'semantic component events do not contain physical touch coordinates');
});
