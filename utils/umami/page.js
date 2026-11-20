import umami, { getHostname } from './index';
import { normalizeRoute } from './sanitize';
import { heatmapTap, heatmapScroll, heatmapSurfaceScroll, startHeatmapPage, stopHeatmapPage } from './heatmap-page';

const TITLES = {
  '/pages/home/index': '首页',
  '/pages/message/index': '消息',
  '/pages/my/index': '我的',
  '/pages/search/index': '搜索',
  '/pages/my/info-edit/index': '编辑资料',
  '/pages/chat/index': '聊天',
  '/pages/login/login': '登录',
  '/pages/loginCode/loginCode': '验证码登录',
  '/pages/dataCenter/index': '数据中心',
  '/pages/setting/index': '设置',
  '/pages/release/index': '发布',
};

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
      umami.trackPageview({ url: route, title: TITLES[route] || '', referrer });
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
