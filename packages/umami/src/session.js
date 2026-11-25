import Transport from './transport.js';

const SESSION_FIELDS = [
  'wx_brand',
  'wx_model',
  'wx_system',
  'wx_platform',
  'wx_version',
  'wx_sdk_version',
  'wx_language',
  'miniapp_version',
  'miniapp_env',
];

export default class SessionProperties extends Transport {
  constructor(options, source, getContext) {
    super({
      endpoint: options.endpoint,
      batchSize: 1,
      debug: options.debug,
      getHeaders: () => ({ 'x-umami-cache': source.sessionCache }),
    });
    this.batchEndpoint = '';
    this.source = source;
    this.getContext = getContext;
    this.website = options.websiteId;
    this.hostname = options.hostname;
    this.lastCache = '';
    this.requestCache = '';
  }

  sync() {
    if (!this.enabled || !this.source.enabled || !this.source.sessionCache) return;
    if (this.queue.length) {
      this.drain();
      return;
    }
    if (this.lastCache === this.source.sessionCache) return;
    const context = this.getContext();
    const data = {};
    SESSION_FIELDS.forEach((key) => {
      const value = context.data && context.data[key];
      if (typeof value !== 'string') return;
      const text = Array.from(value.trim()).slice(0, 80).join('');
      if (text) data[key] = text;
    });
    if (!Object.keys(data).length) return;
    this.lastCache = this.source.sessionCache;
    this.enqueue({
      type: 'identify',
      payload: { website: this.website, hostname: this.hostname, language: context.language, data },
    });
  }

  drain() {
    if (!this.enabled || !this.source.enabled || !this.source.sessionCache) return;
    // Preserve backoff even when new events or lifecycle flushes arrive.
    if (this.queue.length) super.drain();
    else this.sync();
  }

  request(url, items) {
    this.requestCache = this.source.sessionCache;
    this.lastCache = this.requestCache;
    try {
      super.request(url, items, items[0].body, false);
    } catch (error) {
      this.sending = false;
      this.inFlightCount = 0;
      this.retryOrDrop(items, true);
    }
  }

  completeSuccess(items, response) {
    // A concurrent event/error response may already have moved to a newer session.
    // Never overwrite that token with an older identify response.
    if (
      response &&
      !response.disabled &&
      typeof response.cache === 'string' &&
      response.cache &&
      this.source.sessionCache === this.requestCache
    ) {
      this.source.sessionCache = response.cache;
      this.lastCache = response.cache;
    }
    super.completeSuccess(items, response, false);
  }

  setEnabled(value) {
    super.setEnabled(value);
    if (!value) {
      this.lastCache = '';
      this.requestCache = '';
    }
  }
}
