const DEFAULT_TIMEOUT = 8000;
const MAX_RETRIES = 2;
const MAX_QUEUE_SIZE = 50;

export default class Transport {
  constructor({ endpoint, debug = false }) {
    this.endpoint = endpoint;
    this.debug = debug;
    this.queue = [];
    this.sending = false;
    this.enabled = true;
  }

  enqueue(body) {
    if (!this.enabled || !this.endpoint) return;
    if (this.queue.length >= MAX_QUEUE_SIZE) this.queue.shift();
    this.queue.push({ body, attempts: 0 });
    this.drain();
  }

  drain() {
    if (this.sending || !this.queue.length || !this.enabled) return;
    this.sending = true;
    const item = this.queue[0];
    wx.request({
      url: this.endpoint,
      method: 'POST',
      data: item.body,
      dataType: 'json',
      timeout: DEFAULT_TIMEOUT,
      header: { 'content-type': 'application/json' },
      success: (response) => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          this.queue.shift();
        } else {
          this.retryOrDrop(item, response.statusCode >= 500);
        }
      },
      fail: () => this.retryOrDrop(item, true),
      complete: () => {
        this.sending = false;
        this.drain();
      },
    });
  }

  retryOrDrop(item, retryable) {
    if (!retryable || item.attempts >= MAX_RETRIES) {
      this.queue.shift();
      this.log('dropped an event after a non-retryable or exhausted request failure');
      return;
    }
    item.attempts += 1;
  }

  clear() {
    this.queue = [];
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  log(message) {
    if (this.debug) console.warn(`[Umami] ${message}`);
  }
}
