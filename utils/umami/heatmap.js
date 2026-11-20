import Transport from './transport';
import { normalizeRoute } from './sanitize';

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// Only coordinates and geometry cross this boundary. Never spread UI events or datasets.
export function sanitizeHeatmap(type, route, metrics = {}, point = {}) {
  if (typeof route !== 'string' || !route || route.length > 500 || !['click', 'scroll'].includes(type)) return null;
  const event = { type, url: normalizeRoute(route.split(/[?#]/)[0]), timestamp: Date.now() };
  const dimensions = ['pageW', 'pageH', 'viewportW', 'viewportH'];
  if (dimensions.some((key) => !finite(metrics[key]) || metrics[key] <= 0 || metrics[key] > 1000000)) return null;
  dimensions.forEach((key) => {
    event[key] = Math.round(metrics[key]);
  });
  if (event.pageW < event.viewportW || event.pageH < event.viewportH) return null;
  if (type === 'click') {
    if (['x', 'y', 'pageX', 'pageY'].some((key) => !finite(point[key]) || point[key] < 0)) return null;
    if (
      point.x > event.viewportW ||
      point.y > event.viewportH ||
      point.pageX > event.pageW ||
      point.pageY > event.pageH
    )
      return null;
    ['x', 'y', 'pageX', 'pageY'].forEach((key) => {
      event[key] = Math.round(point[key]);
    });
  } else {
    if (!finite(point.scrollPct)) return null;
    event.scrollPct = Math.max(0, Math.min(100, Math.round(point.scrollPct)));
  }
  return event;
}

export default class Heatmap extends Transport {
  constructor(options, source) {
    const endpoint = options.heatmap.endpoint || options.endpoint.replace(/\/send(?=\?|$)/, '/record');
    super({
      endpoint,
      batchEndpoint: endpoint,
      batchSize: 20,
      batchDelay: 2000,
      debug: options.debug,
      getHeaders: () => ({ 'x-umami-cache': source.sessionCache }),
    });
    this.source = source;
    this.website = options.websiteId;
    this.collecting = false;
    const configEndpoint =
      options.heatmap.configEndpoint ||
      options.endpoint.replace(/\/send(?:\?.*)?$/, `/websites/${options.websiteId}/recorder`);
    wx.request({
      url: configEndpoint,
      method: 'GET',
      timeout: 8000,
      success: ({ statusCode, data }) => {
        if (!this.enabled || statusCode !== 200 || !data || !data.enabled || !data.heatmapEnabled) return;
        const rate = data.heatmapSampleRate;
        this.collecting = finite(rate) && rate > 0 && Math.random() < Math.min(1, rate);
        if (this.collecting && options.onHeatmapReady) options.onHeatmapReady();
      },
      fail: () => this.log('heatmap configuration unavailable; skipped collection'),
    });
  }

  track(type, route, metrics, point) {
    if (!this.enabled || !this.collecting) return;
    const event = sanitizeHeatmap(type, route, metrics, point);
    if (event) this.enqueue(event);
  }

  status() {
    return {
      collecting: Boolean(this.enabled && this.collecting),
      hasSession: Boolean(this.source.sessionCache),
      queued: this.queue.length,
    };
  }

  drain(immediate = false) {
    if (!this.source.sessionCache) {
      this.clearTimer();
      return;
    }
    super.drain(immediate);
  }

  request(url, items) {
    super.request(
      url,
      items,
      {
        type: 'heatmap',
        payload: { website: this.website, events: items.map((item) => item.body) },
      },
      false,
    );
  }

  completeSuccess(items, response) {
    if (response && (response.ok === false || response.beep)) {
      this.collecting = false;
      this.log(`heatmap collection skipped: ${response.reason || 'bot_filter'}`);
      this.queue.splice(items.length);
    }
    super.completeSuccess(items, response, false);
  }
}
