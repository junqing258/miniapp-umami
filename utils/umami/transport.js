const DEFAULT_TIMEOUT = 8000;
const MAX_RETRIES = 2;
const MAX_QUEUE_SIZE = 50;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_BATCH_DELAY = 1500;
const RETRY_BASE_DELAY = 1000;
const RETRY_MAX_DELAY = 8000;

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function getBatchEndpoint(endpoint) {
  return typeof endpoint === 'string' ? endpoint.replace(/\/send(?=\?|$)/, '/batch') : '';
}

export default class Transport {
  constructor({ endpoint, batchEndpoint, batchSize, batchDelay, debug = false, getHeaders, onResponse }) {
    this.endpoint = endpoint;
    this.batchEndpoint = batchEndpoint || getBatchEndpoint(endpoint);
    this.batchSize = positiveInteger(batchSize, DEFAULT_BATCH_SIZE);
    this.batchDelay = positiveInteger(batchDelay, DEFAULT_BATCH_DELAY);
    this.debug = debug;
    this.getHeaders = getHeaders;
    this.onResponse = onResponse;
    this.sessionCache = '';
    this.queue = [];
    this.sending = false;
    this.inFlightCount = 0;
    this.enabled = true;
    this.timer = null;
  }

  enqueue(body) {
    if (!this.enabled || !this.endpoint) return;
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      // Do not evict records which are already being submitted.
      this.queue.splice(this.sending ? this.inFlightCount : 0, 1);
    }
    this.queue.push({ body, attempts: 0, retryAt: 0 });
    if (this.queue.length >= this.batchSize) this.drain(true);
    else this.scheduleDrain(this.batchDelay);
  }

  flush() {
    this.drain(true);
  }

  drain(immediate = false) {
    this.clearTimer();
    if (this.sending || !this.queue.length || !this.enabled) return;

    const wait = this.queue[0].retryAt - Date.now();
    if (wait > 0 && !immediate) {
      this.scheduleDrain(wait);
      return;
    }

    this.sending = true;
    const items = this.queue.slice(0, this.batchSize);
    this.inFlightCount = items.length;
    if (items.length > 1 && this.batchEndpoint) {
      this.request(
        this.batchEndpoint,
        items,
        items.map((item) => item.body),
        true,
      );
      return;
    }
    this.request(this.endpoint, [items[0]], items[0].body, false);
  }

  request(url, items, data, isBatch) {
    wx.request({
      url,
      method: 'POST',
      data,
      dataType: 'json',
      timeout: DEFAULT_TIMEOUT,
      header: {
        'content-type': 'application/json',
        ...(this.sessionCache ? { 'x-umami-cache': this.sessionCache } : {}),
        ...(this.getHeaders ? this.getHeaders() : {}),
      },
      success: (response) => {
        if (!this.enabled) return;
        if (response.statusCode >= 200 && response.statusCode < 300) {
          if (response.data && typeof response.data.cache === 'string') this.sessionCache = response.data.cache;
          if (this.onResponse) this.onResponse(response.data);
          this.completeSuccess(items, response.data, isBatch);
        } else if (isBatch && (response.statusCode === 404 || response.statusCode === 405)) {
          this.batchEndpoint = '';
          this.scheduleDrain(0);
        } else {
          this.handleFailure(items, response.statusCode, response.header);
        }
      },
      fail: () => this.retryOrDrop(items, true),
      complete: () => {
        this.sending = false;
        this.inFlightCount = 0;
        this.drain();
      },
    });
  }

  handleFailure(items, status) {
    this.retryOrDrop(items, status >= 500);
  }

  completeSuccess(items, response, isBatch) {
    if (!isBatch || !response || !response.errors) {
      this.queue.splice(0, items.length);
      return;
    }

    const failed = new Set(
      (response.details || [])
        .map((detail) => Number(detail.index))
        .filter((index) => index >= 0 && index < items.length),
    );
    if (!failed.size) {
      this.retryOrDrop(items, true);
      return;
    }

    this.queue.splice(0, items.length);
    const retryItems = items.filter((item, index) => failed.has(index));
    this.queue.unshift(...retryItems);
    this.retryOrDrop(retryItems, true, true);
  }

  retryOrDrop(items, retryable, alreadyDetached = false) {
    const retained = [];
    const delay = this.retryDelay(items[0] && items[0].attempts);
    items.forEach((item) => {
      if (!retryable || item.attempts >= MAX_RETRIES) return;
      item.attempts += 1;
      item.retryAt = Date.now() + delay;
      retained.push(item);
    });

    if (alreadyDetached || retained.length !== items.length) {
      this.queue.splice(0, items.length, ...retained);
    }

    if (!retained.length) this.log('dropped events after a non-retryable or exhausted request failure');
    else this.scheduleDrain(delay);
  }

  retryDelay(attempts = 0) {
    const ceiling = Math.min(RETRY_BASE_DELAY * 2 ** attempts, RETRY_MAX_DELAY);
    return Math.round(ceiling * (0.75 + Math.random() * 0.5));
  }

  scheduleDrain(delay) {
    if (!this.enabled || this.sending || !this.queue.length || this.timer) return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.drain();
      },
      Math.max(0, delay),
    );
  }

  clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  clear() {
    this.clearTimer();
    this.queue = [];
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      this.clear();
      this.sessionCache = '';
    }
  }

  log(message) {
    if (this.debug) console.warn(`[Umami] ${message}`);
  }
}
