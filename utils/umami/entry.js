import { sanitizeUtmQuery } from './sanitize';

// 常用入口按微信官方场景表分类；未列出的有效场景保留原值，归入 other。
// https://developers.weixin.qq.com/miniprogram/dev/reference/scene-list.html
const SCENES = {
  1000: ['其他', 'other'],
  1001: ['发现页小程序最近使用', 'recent'],
  1005: ['微信首页顶部搜索结果', 'search'],
  1006: ['发现栏小程序搜索结果', 'search'],
  1007: ['单聊小程序消息卡片', 'chat_share'],
  1008: ['群聊小程序消息卡片', 'group_share'],
  1010: ['收藏夹', 'favorites'],
  1011: ['扫描二维码', 'qrcode'],
  1012: ['长按图片识别二维码', 'qrcode'],
  1013: ['相册识别二维码', 'qrcode'],
  1014: ['小程序订阅消息', 'subscription_message'],
  1017: ['体验版入口', 'test'],
  1023: ['安卓桌面图标', 'desktop'],
  1025: ['扫描一维码', 'barcode'],
  1027: ['顶部搜索使用过的小程序', 'search'],
  1030: ['自动化测试', 'test'],
  1031: ['长按图片识别一维码', 'barcode'],
  1032: ['相册识别一维码', 'barcode'],
  1035: ['公众号自定义菜单', 'official_account'],
  1036: ['App分享消息卡片', 'app_share'],
  1037: ['小程序打开小程序', 'mini_program'],
  1038: ['从另一个小程序返回', 'mini_program'],
  1044: ['带shareTicket的小程序消息卡片', 'chat_share'],
  1045: ['朋友圈广告', 'ad'],
  1046: ['朋友圈广告详情页', 'ad'],
  1047: ['扫描小程序码', 'qrcode'],
  1048: ['长按图片识别小程序码', 'qrcode'],
  1049: ['相册识别小程序码', 'qrcode'],
  1053: ['搜一搜结果页', 'search'],
  1058: ['公众号文章', 'official_account'],
  1059: ['体验版绑定邀请页', 'test'],
  1065: ['URL Scheme', 'url_scheme'],
  1067: ['公众号文章广告', 'ad'],
  1069: ['移动应用OpenSDK', 'app'],
  1073: ['客服消息小程序卡片', 'customer_service'],
  1074: ['公众号消息小程序卡片', 'official_account'],
  1081: ['客服消息文字链', 'customer_service'],
  1082: ['公众号消息文字链', 'official_account'],
  1084: ['朋友圈广告原生页', 'ad'],
  1089: ['聊天主界面下拉最近使用', 'recent'],
  1090: ['右上角菜单最近使用', 'recent'],
  1095: ['小程序广告组件', 'ad'],
  1101: ['远程调试热更新', 'test'],
  1103: ['发现页我的小程序', 'favorites'],
  1104: ['聊天主界面下拉我的小程序', 'favorites'],
  1106: ['聊天主界面下拉搜索结果', 'search'],
  1107: ['订阅消息', 'subscription_message'],
  1129: ['微信爬虫访问', 'crawler'],
  1154: ['朋友圈单页模式', 'timeline'],
  1155: ['单页模式打开小程序', 'single_page'],
  1158: ['群工具', 'group_tools'],
  1167: ['H5开放标签', 'webview'],
  1189: ['表情雨广告', 'ad'],
  1194: ['URL Link', 'url_link'],
  1200: ['视频号广告', 'ad'],
  1223: ['安卓桌面Widget', 'desktop'],
  1286: ['明文Scheme', 'url_scheme'],
};

export function createEntryContext(entryOptions = {}) {
  const entry = entryOptions && typeof entryOptions === 'object' ? entryOptions : {};
  const { scene } = entry;
  const validScene = Number.isInteger(scene) && scene >= 1000 && scene <= 9999;
  const data = {};
  let defaults = {};
  if (validScene) {
    const [name, category] = SCENES[scene] || ['未分类场景', 'other'];
    data.wx_scene = scene;
    data.wx_scene_name = name;
    data.wx_scene_category = category;
    defaults = { utm_source: 'wechat', utm_medium: category };
  }

  // 先过滤显式参数；无效值不应覆盖场景推导出的默认渠道。
  const explicitQuery = sanitizeUtmQuery(entry.query);
  const explicitKeys = explicitQuery.split('&').map((parameter) => parameter.split('=')[0]);
  explicitKeys.forEach((key) => {
    delete defaults[key];
  });
  const query = [sanitizeUtmQuery(defaults), explicitQuery].filter(Boolean).join('&');
  return { query, data };
}
