import umami, { getHostname } from './index';
import { normalizeRoute } from './sanitize';

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
      });
    },
    onShow(...args) {
      const result = originalOnShow && originalOnShow.apply(this, args);
      const route = normalizeRoute(this.route);
      const referrer = lastRoute && lastRoute !== route ? `https://${getHostname()}${lastRoute}` : '';
      umami.trackPageview({ url: route, title: TITLES[route] || '', referrer });
      lastRoute = route;
      return result;
    },
  });
}

