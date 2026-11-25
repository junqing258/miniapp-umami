const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

async function createRuntime(wxOverrides = {}, umamiOptions = {}, random = Math.random) {
  let app;
  let definition;
  let currentRoute = 'pages/home/index';
  const requests = [];
  const context = vm.createContext({
    console,
    Math: Object.assign(Object.create(Math), { random }),
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
      ...wxOverrides,
    },
  });
  const config = {
    isMock: false,
    umami: {
      enabled: true,
      endpoint: 'https://analytics.example/api/send',
      websiteId: 'test',
      hostname: 'miniapp.local',
      eventProperties: {
        login_success: ['method', 'mock'],
        search_submit: ['source', 'keyword_length'],
        release_click: [],
        draft_save_click: [],
        home_refresh: [],
        home_list_item_click: ['source', 'position'],
        home_release_entry_click: [],
      },
      ...umamiOptions,
    },
  };
  const stubs = {
    'api/request.js': { default: async () => ({ data: { data: [] } }) },
    'tdesign-message.js': { default: { success() {} } },
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
    "import './app.js'; export { default as umami } from './packages/umami/src/index.js'; export { definePage } from './packages/umami/src/page.js'; export { sanitizeUtmQuery } from './packages/umami/src/sanitize.js';",
    { context, identifier: path.join(root, 'test-entry.js') },
  );
  function resolveModule(specifier, parent) {
    let resolved = specifier.startsWith('~/')
      ? path.resolve(root, specifier.slice(2))
      : path.resolve(path.dirname(parent.identifier), specifier);
    if (specifier === 'miniapp-umami') resolved = path.join(root, 'packages/umami/src/index.js');
    if (specifier === 'miniapp-umami/page') resolved = path.join(root, 'packages/umami/src/page.js');
    if (specifier === 'tdesign-miniprogram/message/index') resolved = path.join(root, 'tdesign-message.js');
    return load(path.extname(resolved) ? resolved : `${resolved}.js`);
  }
  await entry.link(resolveModule);
  await entry.evaluate();
  const { umami, definePage, sanitizeUtmQuery } = entry.namespace;
  return {
    app,
    umami,
    sanitizeUtmQuery,
    async loadHome() {
      const module = load(path.join(root, 'pages/home/index.js'));
      await module.link(resolveModule);
      await module.evaluate();
      return definition;
    },
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

test('App errors and Promise rejections use the independent error protocol and respect consent', async () => {
  const runtime = await createRuntime({}, { errors: { enabled: true, release: '1.2.3', environment: 'develop' } });
  runtime.app.onLaunch();
  runtime.show('pages/home/index?token=private-token#private-hash');
  runtime.drain();
  runtime.app.onError('TypeError: unavailable\n    at home.js:10:4');
  runtime.app.onUnhandledRejection({ reason: new Error('promise failed'), promise: { secret: 'private' } });
  runtime.umami.captureException(new Error('handled failure'));
  const records = runtime.drain();
  assert.equal(records.length, 3);
  records.forEach(({ type, payload }) => {
    assert.equal(type, 'error');
    assert.equal(payload.version, 1);
    assert.equal(payload.website, 'test');
    assert.equal(payload.url, '/pages/home/index');
    assert.equal(payload.release, '1.2.3');
    assert.equal(payload.environment, 'develop');
    assert.match(payload.eventId, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  });
  assert.deepEqual(
    records.map(({ payload }) => payload.handled),
    [false, false, true],
  );
  assert.deepEqual(
    records.map(({ payload }) => payload.tags.source),
    ['runtime', 'unhandledrejection', 'manual'],
  );
  assert.equal(records[0].payload.name, 'TypeError');
  assert.match(records[0].payload.stack, /home.js:10:4/);
  assert.doesNotMatch(JSON.stringify(records), /private/);
  runtime.umami.setEnabled(false);
  runtime.app.onError('disabled failure');
  runtime.umami.captureException(new Error('disabled manual'));
  assert.equal(runtime.drain().length, 0);
  const disabled = await createRuntime();
  disabled.app.onLaunch();
  disabled.app.onError('opt out');
  assert.equal(disabled.drain().length, 0);
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
    assert.equal(payload.data.wx_scene, '1047');
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
  assert.equal(payload.data.wx_scene, '1008');
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
    ['1047', '1007', '1007', '1001', undefined],
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
  assert.equal(payload.data.wx_scene, '9999');
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
    assert.equal(payload.data.wx_scene, String(scene));
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

test('normal events retain standard language and screen without duplicating device data', async () => {
  let width = 390;
  const runtime = await createRuntime({
    getDeviceInfo: () => ({
      brand: 'Apple',
      model: 'iPhone',
      system: 'iOS 18',
      platform: 'ios',
      deviceId: 'private-id',
    }),
    getAppBaseInfo: () => ({
      version: '8.0.60',
      SDKVersion: '3.18.0',
      language: 'zh_CN',
      host: { appId: 'private-app' },
    }),
    getWindowInfo: () => ({
      windowWidth: width,
      windowHeight: 700,
      pixelRatio: 3,
    }),
    getSystemInfoSync: () => {
      throw new Error('legacy API should not be called');
    },
  });
  runtime.app.onLaunch({ scene: 1047 });
  runtime.show('pages/home/index');
  width = 700;
  runtime.umami.track('search_submit', { source: 'home', keyword_length: 2, wx_model: 'spoofed' });
  const records = runtime.drain();
  assert.equal(records.length, 2);
  records.forEach(({ payload }) => {
    assert.equal(payload.language, 'zh-CN');
    assert.deepEqual(
      Object.keys(payload.data).filter((key) => key.startsWith('wx_')),
      ['wx_scene', 'wx_scene_name', 'wx_scene_category'],
    );
    assert.equal(payload.data.wx_scene, '1047');
  });
  assert.equal(records[0].payload.screen, '390x700');
  assert.equal(records[1].payload.screen, '700x700');
  assert.equal(records[1].payload.data.source, 'home');
  assert.doesNotMatch(JSON.stringify(records), /private-|spoofed/);
});

test('failed modern APIs fall back safely and omit invalid system values', async () => {
  const runtime = await createRuntime({
    getDeviceInfo: () => {
      throw new Error('unsupported');
    },
    getAppBaseInfo: () => null,
    getWindowInfo: () => ({}),
    getSystemInfoSync: () => ({
      brand: 'x'.repeat(100),
      model: {},
      platform: 'devtools',
      language: 'en_US',
      cameraAuthorized: true,
    }),
  });
  runtime.app.onLaunch();
  runtime.show('pages/home/index');
  const [{ payload }] = runtime.drain();
  assert.equal(payload.language, 'en-US');
  assert.equal(payload.screen, undefined);
  assert.equal(payload.data, undefined);
  assert.doesNotMatch(JSON.stringify(payload), /cameraAuthorized/);
  const broken = await createRuntime({
    getSystemInfoSync: () => {
      throw new Error('unavailable');
    },
  });
  broken.app.onLaunch();
  broken.show('pages/home/index');
  assert.equal(broken.drain()[0].payload.screen, undefined);
});

test('normal events omit session fields and empty data while retaining event-specific properties', async () => {
  let reads = 0;
  const runtime = await createRuntime({
    getAccountInfoSync() {
      reads += 1;
      return { miniProgram: { version: '2.3.4', envVersion: 'release', appId: 'private-app' } };
    },
    getAppBaseInfo: () => ({ version: '8.0.60' }),
  });
  runtime.app.onLaunch();
  runtime.show('pages/home/index');
  runtime.umami.track('home_release_entry_click', { miniapp_version: 'spoofed' });
  runtime.umami.trackPageReady(100, '/pages/home/index');
  const records = runtime.drain();
  assert.equal(records.length, 4);
  assert.equal(records[0].payload.data, undefined);
  assert.equal(records[1].payload.data, undefined);
  assert.deepEqual(records[2].payload.data, { duration_ms: 100 });
  assert.deepEqual(Object.keys(records[3].payload.data), ['duration_ms']);
  assert.ok(records[3].payload.data.duration_ms >= 0);
  assert.equal(reads, 0, 'ordinary events do not read release metadata before a session exists');
  assert.doesNotMatch(JSON.stringify(records), /private|spoofed|miniapp_version|miniapp_env|wx_version/);
});

function experimentFixture(storage = new Map()) {
  const writes = [];
  return {
    storage,
    writes,
    wx: {
      getStorageSync: (key) => storage.get(key),
      setStorageSync(key, value) {
        writes.push([key, value]);
        storage.set(key, value);
      },
    },
    options: {
      tag: 'test-audience',
      experiments: { home_publish_cta: { enabled: true, revision: 'v1', variants: { A: 50, B: 50 } } },
    },
  };
}

test('weighted allocation respects bucket boundaries and repairs invalid stored assignments', async () => {
  await Promise.all(
    [
      [0, 'A'],
      [0.249999, 'A'],
      [0.25, 'B'],
      [0.999999, 'B'],
    ].map(async ([random, expected]) => {
      const fixture = experimentFixture(new Map([['umami:experiment:test:home_publish_cta:v1', 'retired']]));
      fixture.options.experiments.home_publish_cta.variants = { A: 25, B: 75 };
      const r = await createRuntime(fixture.wx, fixture.options, () => random);
      r.app.onLaunch();
      assert.equal(r.umami.getVariant('home_publish_cta'), expected);
      assert.equal(fixture.writes.length, 1);
      assert.equal(fixture.writes[0][1], expected);
    }),
  );
});

test('experiment assignment survives restarts and exposure/attribution stay scoped to experiment and revision', async () => {
  const key = 'umami:experiment:test:home_publish_cta:v1';
  const fixture = experimentFixture(new Map([[key, 'B']]));
  const r = await createRuntime(fixture.wx, fixture.options);
  r.app.onLaunch();
  r.show('pages/home/index');
  assert.equal(r.umami.getVariant('home_publish_cta'), 'B');
  assert.equal(r.drain().length, 1, 'assignment must not generate exposure or extra PV');
  r.umami.trackExperiment('home_publish_cta', 'home_release_entry_click');
  assert.equal(r.drain()[0].payload.data, undefined, 'no conversion attribution before exposure');
  r.umami.trackExposure('home_publish_cta');
  r.umami.trackExposure('home_publish_cta');
  r.umami.track('experiment_exposure', { exp_home_publish_cta_v1: 'spoofed' });
  r.umami.trackExperiment('home_publish_cta', 'home_release_entry_click', {
    exp_home_publish_cta_v1: 'spoofed',
    variant: 'spoofed',
    experiment_id: 'spoofed',
    token: 'private-token',
  });
  r.umami.trackExperiment('unknown', 'search_submit', { source: 'home', keyword_length: 3 });
  r.umami.track('search_submit', { source: 'home' });
  const records = r.drain();
  assert.equal(records.length, 4);
  assert.deepEqual(
    records.slice(0, 2).map(({ payload }) => payload.name),
    ['experiment_exposure', 'home_release_entry_click'],
  );
  records.slice(0, 2).forEach(({ payload }) => {
    assert.deepEqual(payload.data, { exp_home_publish_cta_v1: 'B' });
    assert.equal(payload.tag, 'test-audience');
  });
  assert.deepEqual(records[2].payload.data, { source: 'home', keyword_length: 3 });
  assert.deepEqual(records[3].payload.data, { source: 'home' });
  assert.doesNotMatch(JSON.stringify(records), /private|spoofed/);
  assert.equal(fixture.writes.length, 0, 'existing assignment does not rewrite storage');
  const restarted = await createRuntime(fixture.wx, fixture.options);
  restarted.app.onLaunch();
  assert.equal(restarted.umami.getVariant('home_publish_cta'), 'B');
  restarted.umami.trackExposure('home_publish_cta');
  assert.equal(restarted.drain().length, 1, 'new app launch records a new exposure');
  fixture.options.experiments.home_publish_cta.revision = 'v2';
  const revised = await createRuntime(fixture.wx, fixture.options);
  revised.app.onLaunch();
  const variant = revised.umami.getVariant('home_publish_cta');
  assert.ok(['A', 'B'].includes(variant));
  assert.equal(revised.umami.getVariant('home_publish_cta'), variant);
  assert.equal(fixture.writes.length, 1);
  assert.equal(fixture.writes[0][0], 'umami:experiment:test:home_publish_cta:v2');
  revised.umami.trackExposure('home_publish_cta');
  revised.umami.trackExperiment('home_publish_cta', 'home_release_entry_click');
  revised.drain().forEach(({ payload }) => {
    assert.deepEqual(payload.data, { exp_home_publish_cta_v2: variant });
  });
});

test('disabled, invalid and nonpersistent experiments safely retain ordinary business tracking', async () => {
  const fixture = experimentFixture();
  await Promise.all(
    [
      {
        getStorageSync() {
          throw new Error('unavailable');
        },
      },
      {
        setStorageSync() {
          throw new Error('quota');
        },
      },
      { getStorageSync: undefined },
    ].map(async (overrides) => {
      const r = await createRuntime({ ...fixture.wx, ...overrides }, fixture.options);
      r.app.onLaunch();
      assert.equal(r.umami.getVariant('home_publish_cta'), null);
      r.umami.trackExposure('home_publish_cta');
      r.umami.trackExperiment('home_publish_cta', 'home_release_entry_click');
      const records = r.drain();
      assert.equal(records.length, 1);
      assert.equal(records[0].payload.data, undefined);
    }),
  );
  await Promise.all(
    [
      { enabled: false, revision: 'v1', variants: { A: 1, B: 1 } },
      { enabled: true, revision: '', variants: { A: 1, B: 1 } },
      { enabled: true, revision: 'v1', variants: { A: 1, B: 0 } },
      { enabled: true, revision: 'v1', variants: { A: '50', B: 50 } },
      { enabled: true, revision: 'v1', variants: { A: 1 } },
    ].map(async (config) => {
      const r = await createRuntime(fixture.wx, { experiments: { home_publish_cta: config } });
      r.app.onLaunch();
      assert.equal(r.umami.getVariant('home_publish_cta'), null);
      r.umami.trackExposure('home_publish_cta');
      assert.equal(r.drain().length, 0);
    }),
  );
  const disabled = await createRuntime(fixture.wx, { ...fixture.options, enabled: false });
  disabled.app.onLaunch();
  assert.equal(disabled.umami.getVariant('home_publish_cta'), null);
  disabled.umami.trackExposure('home_publish_cta');
  assert.equal(disabled.drain().length, 0);
  assert.equal(fixture.writes.length, 0, 'disabled analytics or invalid config must not persist assignments');
});

test('opt out suppresses exposure and conversion and re-enabling requires fresh exposure', async () => {
  const fixture = experimentFixture();
  const r = await createRuntime(fixture.wx, fixture.options);
  r.app.onLaunch();
  r.umami.trackExposure('home_publish_cta');
  r.drain();
  r.umami.setEnabled(false);
  assert.equal(r.umami.getVariant('home_publish_cta'), null);
  r.umami.trackExposure('home_publish_cta');
  r.umami.trackExperiment('home_publish_cta', 'home_release_entry_click');
  assert.equal(r.drain().length, 0);
  r.umami.setEnabled(true);
  r.umami.trackExperiment('home_publish_cta', 'home_release_entry_click');
  assert.equal(r.drain()[0].payload.data, undefined);
  r.umami.trackExposure('home_publish_cta');
  assert.equal(r.drain()[0].payload.name, 'experiment_exposure');
});

test('homepage renders variant before exposure, ignores hidden callbacks and preserves navigation', async () => {
  const fixture = experimentFixture(new Map([['umami:experiment:test:home_publish_cta:v1', 'B']]));
  let navigated;
  const r = await createRuntime(
    {
      ...fixture.wx,
      canIUse: () => false,
      navigateTo: (value) => {
        navigated = value.url;
      },
    },
    fixture.options,
  );
  r.app.onLaunch();
  const definition = await r.loadHome();
  const callbacks = [];
  const page = {
    ...definition,
    data: { ...definition.data },
    route: 'pages/home/index',
    setData(data, callback) {
      Object.assign(this.data, data);
      if (callback) callbacks.push(callback);
    },
  };
  page.onLoad({});
  page.onShow();
  assert.equal(page.data.publishLabel, '立即发布');
  assert.equal(r.drain().filter(({ payload }) => payload.name === 'experiment_exposure').length, 0);
  page.onHide();
  callbacks.splice(0).forEach((callback) => callback());
  assert.equal(r.drain().length, 0, 'a hidden page must not produce exposure');
  page.onShow();
  callbacks.splice(0).forEach((callback) => callback());
  page.goRelease();
  const records = r.drain();
  assert.equal(records.filter(({ payload }) => !payload.name).length, 1);
  assert.equal(records.filter(({ payload }) => payload.name === 'experiment_exposure').length, 1);
  const clicks = records.filter(({ payload }) => payload.name === 'home_release_entry_click');
  assert.equal(clicks.length, 1, 'experiment attribution must not duplicate the business event');
  assert.deepEqual(clicks[0].payload.data, { exp_home_publish_cta_v1: 'B' });
  assert.equal(navigated, '/pages/release/index');
  const control = await createRuntime({ canIUse: () => false });
  control.app.onLaunch();
  const controlPage = await control.loadHome();
  const data = { ...controlPage.data };
  controlPage.onShow.call({
    setData(value, callback) {
      Object.assign(data, value);
      callback();
    },
  });
  assert.equal(data.publishLabel, '发布');
  assert.equal(control.drain().filter(({ payload }) => payload.name === 'experiment_exposure').length, 0);
});
