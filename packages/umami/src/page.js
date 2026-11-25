import umami, { getHostname, getPageTitle } from './index.js';
import { normalizeRoute } from './sanitize.js';
import { heatmapTap, heatmapScroll, heatmapSurfaceScroll, startHeatmapPage, stopHeatmapPage } from './heatmap-page.js';

let lastRoute = '';

function after(result, callback) {
  if (result && typeof result.then === 'function') {
    result.then(callback, callback);
  } else {
    callback();
  }
  return result;
}

export function definePage(definition) {
  const originalOnLoad = definition.onLoad;
  const originalOnReady = definition.onReady;
  const originalOnShow = definition.onShow;
  const originalOnHide = definition.onHide;
  const originalOnUnload = definition.onUnload;
  const originalOnPageScroll = definition.onPageScroll;
  return Page({
    ...definition,
    onLoad(...args) {
      this.__umamiLoadAt = Date.now();
      return originalOnLoad && originalOnLoad.apply(this, args);
    },
    onReady(...args) {
      const result = originalOnReady && originalOnReady.apply(this, args);
      return after(result, () => {
        if (this.__umamiPageReadyReported) return;
        this.__umamiPageReadyReported = true;
        const loadAt = this.__umamiLoadAt || Date.now();
        umami.trackPageReady(Date.now() - loadAt, normalizeRoute(this.route));
        startHeatmapPage(this);
      });
    },
    onShow(...args) {
      this.__umamiHeatmapVisible = true;
      this.__umamiHeatmapDepth = 0;
      this.__umamiHeatmapSurfaceDepth = 0;
      const result = originalOnShow && originalOnShow.apply(this, args);
      const route = normalizeRoute(this.route);
      const referrer = lastRoute && lastRoute !== route ? `https://${getHostname()}${lastRoute}` : '';
      umami.trackPageview({ url: route, title: getPageTitle(route), referrer });
      lastRoute = route;
      startHeatmapPage(this);
      return result;
    },
    onPageScroll(...args) {
      heatmapScroll(this);
      return originalOnPageScroll && originalOnPageScroll.apply(this, args);
    },
    onHide(...args) {
      stopHeatmapPage(this);
      umami.flush();
      return originalOnHide && originalOnHide.apply(this, args);
    },
    onUnload(...args) {
      stopHeatmapPage(this);
      umami.flush();
      return originalOnUnload && originalOnUnload.apply(this, args);
    },
    __umamiHeatmapTap(event) {
      heatmapTap(this, event);
    },
    __umamiHeatmapStart() {
      startHeatmapPage(this);
    },
    __umamiHeatmapStatus() {
      return umami.getHeatmapStatus();
    },
    __umamiHeatmapSurfaceTap(event) {
      heatmapTap(this, event, true);
    },
    __umamiHeatmapSurfaceScroll(event) {
      heatmapSurfaceScroll(this, event);
    },
  });
}
