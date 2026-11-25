const assert = require('node:assert/strict');
const { test } = require('node:test');

test('standalone ESM API accepts consumer events and titles without demo policy', async () => {
  const { sanitizeEvent } = await import('../src/sanitize.js');
  assert.equal(sanitizeEvent('home_refresh'), null);
  assert.equal(sanitizeEvent('toString'), null);
  assert.deepEqual(sanitizeEvent('purchase', { amount: 99, secret: 'discard' }, { purchase: ['amount'] }), {
    name: 'purchase',
    data: { amount: 99 },
  });
  const requests = [];
  let definition;
  global.wx = {
    getSystemInfoSync: () => ({ language: 'en', windowWidth: 375, windowHeight: 812 }),
    request(options) {
      requests.push(options.data);
      options.success({ statusCode: 200, data: {} });
      options.complete();
    },
  };
  global.getCurrentPages = () => [{ route: 'pages/catalog/index' }];
  global.Page = (value) => {
    definition = value;
  };
  const { default: umami } = await import('../src/index.js');
  const { definePage } = await import('../src/page.js');
  try {
    umami.init({
      enabled: true,
      websiteId: 'consumer-site',
      endpoint: 'https://example.com/api/send',
      hostname: 'consumer.example',
      sessionProperties: false,
      batchSize: 1,
      eventProperties: { purchase: ['amount'] },
      pageTitles: { '/pages/catalog/index': 'Catalog' },
    });
    definePage({
      onShow() {
        return 'business-result';
      },
    });
    assert.equal(definition.onShow.call({ route: 'pages/catalog/index' }), 'business-result');
    umami.track('purchase', { amount: 99, secret: 'discard' });
    umami.track('home_refresh');
    umami.flush();
    assert.equal(requests.length, 2);
    assert.equal(requests[0].payload.title, 'Catalog');
    assert.equal(requests[1].payload.name, 'purchase');
    assert.deepEqual(requests[1].payload.data, { amount: 99 });
  } finally {
    umami.setEnabled(false);
    delete global.wx;
    delete global.Page;
    delete global.getCurrentPages;
  }
});
