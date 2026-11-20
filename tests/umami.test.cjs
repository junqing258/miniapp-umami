const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

async function createRuntime() {
  let app;
  let definition;
  let currentRoute = 'pages/home/index';
  const requests = [];
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    App: (value) => {
      app = value;
    },
    Page: (value) => {
      definition = value;
    },
    getCurrentPages: () => [{ route: currentRoute }],
    wx: {
      getSystemInfoSync: () => ({ language: 'zh_CN', windowWidth: 375, windowHeight: 812 }),
      getUpdateManager: () => ({ onCheckForUpdate() {}, onUpdateReady() {} }),
      request(options) {
        requests.push(JSON.parse(JSON.stringify(options.data)));
        options.success({ statusCode: 200, data: {} });
        options.complete();
      },
    },
  });
  const config = {
    isMock: false,
    umami: {
      enabled: true,
      endpoint: 'https://analytics.example/api/send',
      websiteId: 'test',
      hostname: 'miniapp.local',
    },
  };
  const stubs = {
    'config.js': { default: config },
    'mock/index.js': { default() {} },
    'utils/eventBus.js': { default: () => ({ emit() {} }) },
    'mock/chat.js': {
      connectSocket: () => ({ onMessage() {} }),
      fetchUnreadNum: async () => ({ data: 0 }),
    },
  };
  const modules = new Map();
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename);
    const relative = path.relative(root, filename);
    const stub = stubs[relative];
    const module = stub
      ? new vm.SyntheticModule(
          Object.keys(stub),
          function () {
            Object.entries(stub).forEach(([key, value]) => this.setExport(key, value));
          },
          { context, identifier: filename },
        )
      : new vm.SourceTextModule(readFileSync(filename, 'utf8'), { context, identifier: filename });
    modules.set(filename, module);
    return module;
  }
  const entry = new vm.SourceTextModule(
    "import './app.js'; export { default as umami } from './utils/umami/index.js'; export { definePage } from './utils/umami/page.js'; export { sanitizeUtmQuery } from './utils/umami/sanitize.js';",
    { context, identifier: path.join(root, 'test-entry.js') },
  );
  await entry.link((specifier, parent) => {
    const resolved = path.resolve(path.dirname(parent.identifier), specifier);
    return load(path.extname(resolved) ? resolved : `${resolved}.js`);
  });
  await entry.evaluate();
  const { umami, definePage, sanitizeUtmQuery } = entry.namespace;
  return {
    app,
    umami,
    sanitizeUtmQuery,
    show(route, query = {}) {
      currentRoute = route;
      definePage({});
      const page = { ...definition, route };
      page.onLoad(query);
      page.onShow();
    },
    drain() {
      umami.flush();
      return requests.splice(0).flat();
    },
  };
}

test('cold entry, internal navigation and events preserve only entry UTM without adding PV', async () => {
  const runtime = await createRuntime();
  const entry = {
    query: { utm_source: 'wechat', utm_medium: 'qrcode', utm_campaign: 'launch', phone: 'private-phone' },
  };
  runtime.app.onLaunch(entry);
  runtime.app.onShow(entry);
  runtime.show('pages/home/index', entry.query);
  runtime.show('pages/search/index?token=private-token', { utm_source: 'internal', keyword: 'private-search' });
  runtime.umami.track('search_submit', { source: 'home', keyword_length: 4, keyword: 'private-search' });
  const records = runtime.drain();
  assert.equal(records.length, 3);
  assert.equal(records.filter(({ payload }) => !payload.name).length, 2);
  records.forEach(({ payload }) => {
    const url = new URL(payload.url, 'https://miniapp.local');
    assert.deepEqual(
      [...url.searchParams],
      [
        ['utm_source', 'wechat'],
        ['utm_medium', 'qrcode'],
        ['utm_campaign', 'launch'],
      ],
    );
    assert.equal(payload.language, 'zh-CN');
  });
  assert.equal(records[1].payload.referrer, 'https://miniapp.local/pages/home/index');
  assert.equal(records[2].payload.name, 'search_submit');
  assert.doesNotMatch(JSON.stringify(records), /private-|internal/);
});

test('warm entry replaces the whole campaign, and a direct entry clears it without rewriting queued records', async () => {
  const runtime = await createRuntime();
  runtime.app.onLaunch();
  runtime.app.onShow({ query: { utm_source: 'first', utm_campaign: 'old' } });
  runtime.show('pages/home/index');
  runtime.app.onShow({ query: { utm_source: 'second' } });
  runtime.show('pages/home/index');
  runtime.app.onShow({ query: { scene: '1234', token: 'private-token' } });
  runtime.show('pages/home/index');
  assert.deepEqual(
    runtime.drain().map(({ payload }) => payload.url),
    ['/pages/home/index?utm_source=first&utm_campaign=old', '/pages/home/index?utm_source=second', '/pages/home/index'],
  );
});

test('entry values are encoded, bounded and validated, including malformed Unicode', async () => {
  const { sanitizeUtmQuery } = await createRuntime();
  const query = Object.assign(Object.create({ utm_term: 'inherited' }), {
    utm_source: ' 微信 & qr=1 ',
    utm_medium: ['bad'],
    utm_campaign: '😀'.repeat(100),
    utm_content: '\uD800',
    utm_term: '   ',
    token: 'private-token',
    scene: '1234',
  });
  const encoded = sanitizeUtmQuery(query);
  const values = new URLSearchParams(encoded);
  assert.equal(values.get('utm_source'), '微信 & qr=1');
  assert.equal(values.get('utm_campaign'), '😀'.repeat(80));
  assert.equal(values.size, 2);
  assert.equal(sanitizeUtmQuery(Object.create({ utm_source: 'inherited' })), '');
  [undefined, null, '', [], { utm_source: 42 }].forEach((input) => assert.equal(sanitizeUtmQuery(input), ''));
});

test('official numeric scene fills UTM source and medium on PV and events without extra records', async () => {
  const runtime = await createRuntime();
  const entry = {
    scene: 1047,
    query: { utm_campaign: '模拟拉新活动', scene: 'private-code', phone: 'private-phone' },
    referrerInfo: { appId: 'private-appid', extraData: { token: 'private-token' } },
    shareTicket: 'private-ticket',
  };
  runtime.app.onLaunch(entry);
  runtime.app.onShow(entry);
  runtime.show('pages/home/index');
  runtime.show('pages/search/index', { utm_medium: 'internal', scene: 1008 });
  runtime.umami.track('search_submit', {
    source: 'input',
    keyword_length: 4,
    wx_scene: 1008,
    wx_scene_name: 'private-override',
  });
  const records = runtime.drain();
  assert.equal(records.length, 3);
  assert.equal(records.filter(({ payload }) => !payload.name).length, 2);
  records.forEach(({ payload }) => {
    const url = new URL(payload.url, 'https://miniapp.local');
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      utm_source: 'wechat',
      utm_medium: 'qrcode',
      utm_campaign: '模拟拉新活动',
    });
    assert.equal(payload.data.wx_scene, 1047);
    assert.equal(payload.data.wx_scene_name, '扫描小程序码');
    assert.equal(payload.data.wx_scene_category, 'qrcode');
  });
  assert.equal(records[2].payload.data.source, 'input');
  assert.equal(records[2].payload.data.keyword_length, 4);
  assert.doesNotMatch(JSON.stringify(records), /private-|internal/);
});

test('explicit UTM wins over inferred channels while scene context remains available', async () => {
  const runtime = await createRuntime();
  runtime.app.onLaunch({ scene: 1008, query: { utm_source: 'poster', utm_medium: 'paid', utm_campaign: 'summer' } });
  runtime.show('pages/home/index');
  const [{ payload }] = runtime.drain();
  const url = new URL(payload.url, 'https://miniapp.local');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    utm_source: 'poster',
    utm_medium: 'paid',
    utm_campaign: 'summer',
  });
  assert.equal(payload.data.wx_scene, 1008);
  assert.equal(payload.data.wx_scene_category, 'group_share');
});

test('warm scene replaces both attribution and scene without rewriting queued payloads', async () => {
  const runtime = await createRuntime();
  runtime.app.onLaunch({ scene: 1047, query: { utm_campaign: 'old-campaign' } });
  runtime.show('pages/home/index');
  runtime.app.onShow({ scene: 1007 });
  runtime.show('pages/home/index');
  runtime.umami.track('home_release_entry_click');
  runtime.app.onShow({ scene: 1001 });
  runtime.show('pages/home/index');
  runtime.app.onShow({ query: { scene: 'private-code' } });
  runtime.show('pages/home/index');
  const records = runtime.drain();
  assert.deepEqual(
    records.map(({ payload }) => new URL(payload.url, 'https://miniapp.local').searchParams.get('utm_medium')),
    ['qrcode', 'chat_share', 'chat_share', 'recent', null],
  );
  assert.deepEqual(
    records.map(({ payload }) => payload.data && payload.data.wx_scene),
    [1047, 1007, 1007, 1001, undefined],
  );
  assert.match(records[0].payload.url, /old-campaign/);
  records.slice(1).forEach(({ payload }) => assert.doesNotMatch(payload.url, /old-campaign/));
  assert.equal(records.filter(({ payload }) => !payload.name).length, 4);
});

test('valid unknown scenes retain raw ID; invalid scenes and QR business scene are not inferred', async () => {
  const runtime = await createRuntime();
  runtime.app.onLaunch();
  runtime.app.onShow({ scene: 9999, query: { utm_source: [], utm_medium: '   ' } });
  runtime.show('pages/home/index');
  const [{ payload }] = runtime.drain();
  assert.equal(payload.data.wx_scene, 9999);
  assert.equal(payload.data.wx_scene_name, '未分类场景');
  assert.equal(payload.data.wx_scene_category, 'other');
  assert.equal(new URL(payload.url, 'https://miniapp.local').searchParams.get('utm_medium'), 'other');
  [undefined, null, '1047', 999, 10000, 1007.5, NaN, {}, []].forEach((scene) => {
    runtime.app.onShow({ scene, query: { scene: '1047', token: 'private-token' } });
    runtime.show('pages/home/index');
  });
  const records = runtime.drain();
  assert.equal(records.length, 9);
  records.forEach(({ payload: record }) => {
    assert.equal(record.url, '/pages/home/index');
    assert.equal(record.data, undefined);
  });
});

test('common scene classifications and legacy query setter preserve a clean attribution context', async () => {
  const runtime = await createRuntime();
  runtime.app.onLaunch();
  const scenes = [
    [1005, 'search'],
    [1008, 'group_share'],
    [1045, 'ad'],
    [1058, 'official_account'],
    [1030, 'test'],
    [1194, 'url_link'],
    [1065, 'url_scheme'],
  ];
  scenes.forEach(([scene]) => {
    runtime.app.onShow({ scene });
    runtime.show('pages/home/index');
  });
  const records = runtime.drain();
  scenes.forEach(([scene, category], index) => {
    const { payload } = records[index];
    assert.equal(payload.data.wx_scene, scene);
    assert.equal(payload.data.wx_scene_category, category);
    const params = new URL(payload.url, 'https://miniapp.local').searchParams;
    assert.equal(params.get('utm_medium'), category);
    assert.equal(params.has('utm_campaign'), false, 'scene must not fabricate a campaign');
  });
  runtime.umami.setEntryQuery({ utm_campaign: 'legacy' });
  runtime.show('pages/home/index');
  assert.deepEqual(
    runtime.drain().map(({ payload }) => [payload.url, payload.data]),
    [['/pages/home/index?utm_campaign=legacy', undefined]],
  );
});
