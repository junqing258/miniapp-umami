import Transport from './transport.js';
import { normalizeRoute } from './sanitize.js';

const MAX_ERRORS = 20;
const SOURCES = ['manual', 'runtime', 'unhandledrejection'];
const SYSTEM_TAGS = ['wx_platform', 'wx_system', 'wx_brand', 'wx_model', 'wx_version', 'wx_sdk_version'];

// Keep diagnostic text, never query strings, credentials or complete rejection objects.
export function sanitizeErrorText(value, limit = 2000) {
  if (typeof value !== 'string') return '';
  return value
    .slice(0, limit)
    .replace(/(?:https?|wxfile|file|weapp):\/\/[^\s)]+/gi, (url) => {
      const position = (url.match(/:\d+(?::\d+)?$/) || [''])[0];
      return url.split(/[?#]/)[0].replace(/(\/\/)[^/@\s]+@/, '$1') + (/[?#]/.test(url) ? position : '');
    })
    .replace(/(\/[\w./-]+)\?[^\s)]*/g, '$1')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, '[token]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(
      /\b(password|secret|token|authorization|api[_-]?key|cookie|openid|unionid|phone|mobile|keyword)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1=[redacted]',
    )
    .replace(/\b(?:\+?86[- ]?)?1[3-9]\d{9}\b/g, '[phone]')
    .slice(0, limit);
}

function eventId() {
  // A per-occurrence id for server deduplication, never a device or user identifier.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    return (char === 'x' ? random : (random % 4) + 8).toString(16);
  });
}

function appVersion(config) {
  let info = {};
  try {
    if (typeof wx.getAccountInfoSync === 'function') info = wx.getAccountInfoSync().miniProgram || {};
  } catch (error) {
    // Older base libraries may not expose account information.
  }
  return {
    release: sanitizeErrorText(config.release || info.version, 100),
    environment: sanitizeErrorText(config.environment || info.envVersion || 'unknown', 50),
  };
}

export default class ErrorMonitor extends Transport {
  constructor(options, source, getContext) {
    const config = options.errors;
    super({
      endpoint: config.endpoint || options.endpoint,
      batchSize: 1,
      debug: options.debug,
      getHeaders: () => (source.sessionCache ? { 'x-umami-cache': source.sessionCache } : {}),
      onResponse: (data) => {
        if (data && typeof data.cache === 'string') source.sessionCache = data.cache;
      },
    });
    this.batchEndpoint = '';
    this.website = options.websiteId;
    this.source = source;
    this.getContext = getContext;
    this.version = appVersion(config);
    this.recent = new Map();
    this.minute = -1;
    this.count = 0;
    this.blockedUntil = 0;
    this.capturing = false;
  }

  capture(error, context = {}) {
    if (!this.enabled || this.capturing || this.queue.length >= MAX_ERRORS || Date.now() < this.blockedUntil) return;
    this.capturing = true;
    try {
      const now = Date.now();
      const minute = Math.floor(now / 60000);
      if (this.minute !== minute) {
        this.minute = minute;
        this.count = 0;
      }
      if (this.count >= MAX_ERRORS) return;
      const object = error && typeof error === 'object' ? error : {};
      const rawMessage = typeof object.message === 'string' ? object.message : error;
      let rawStack = typeof error === 'string' ? error : '';
      if (typeof object.stack === 'string') rawStack = object.stack;
      let message = 'Non-Error exception';
      if (typeof rawMessage === 'string') [message] = rawMessage.split('\n');
      else if (['number', 'boolean'].includes(typeof rawMessage)) message = String(rawMessage);
      message = sanitizeErrorText(message);
      const inferredName = (message.match(/^([\w.]*Error):/) || [])[1];
      const name = sanitizeErrorText(object.name || inferredName || 'Error', 200) || 'Error';
      const stack = sanitizeErrorText(rawStack, 8000);
      const info = this.getContext();
      const url = sanitizeErrorText(normalizeRoute((info.url || '').split(/[?#]/)[0]) || '/', 500);
      const handled = context.handled !== false;
      const key = JSON.stringify([name, message, stack, url, handled]);
      this.recent.forEach((time, recentKey) => {
        if (now - time >= 1000) this.recent.delete(recentKey);
      });
      if (this.recent.has(key)) return;
      const tags = {
        source: SOURCES.includes(context.source) ? context.source : 'manual',
        platform: 'wechat-miniprogram',
      };
      SYSTEM_TAGS.forEach((key) => {
        const value = sanitizeErrorText(info.data && info.data[key], 80);
        if (value) tags[key] = value;
      });
      this.recent.set(key, now);
      this.count += 1;
      this.enqueue({
        type: 'error',
        payload: {
          version: 1,
          website: this.website,
          eventId: eventId(),
          timestamp: now,
          name,
          message: message || 'Unknown error',
          stack,
          handled,
          url,
          language: info.language,
          ...(info.screen ? { screen: info.screen } : {}),
          ...this.version,
          tags,
        },
      });
    } catch (error) {
      // Reporting must not throw, stringify arbitrary business objects, or recurse.
    } finally {
      this.capturing = false;
    }
  }

  request(url, items) {
    try {
      super.request(url, items, items[0].body, false);
    } catch (error) {
      this.sending = false;
      this.inFlightCount = 0;
      this.retryOrDrop(items, true);
    }
  }

  drain() {
    // New errors and lifecycle flushes must still respect an earlier retry's backoff.
    super.drain();
  }

  handleFailure(items, status, headers = {}) {
    if (status === 429) {
      const responseHeaders = headers || {};
      const seconds = Number(responseHeaders['Retry-After'] || responseHeaders['retry-after']) || 60;
      this.blockedUntil = Date.now() + Math.max(1, Math.min(seconds, 300)) * 1000;
      this.clear();
      return;
    }
    super.handleFailure(items, status, headers);
  }

  setEnabled(value) {
    super.setEnabled(value);
    if (!value) this.recent.clear();
  }
}
