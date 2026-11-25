import { normalizeLanguage } from './sanitize.js';

const TEXT_FIELDS = {
  brand: 'wx_brand',
  model: 'wx_model',
  system: 'wx_system',
  platform: 'wx_platform',
  version: 'wx_version',
  SDKVersion: 'wx_sdk_version',
};

function read(method) {
  try {
    const value = typeof wx[method] === 'function' ? wx[method]() : null;
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (error) {
    return null;
  }
}

function positive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function createSystemContext() {
  let stableInfo;
  let legacyInfo;
  function legacy() {
    if (!legacyInfo) legacyInfo = read('getSystemInfoSync') || {};
    return legacyInfo;
  }

  return () => {
    if (!stableInfo) {
      stableInfo = {
        ...(read('getDeviceInfo') || legacy()),
        ...(read('getAppBaseInfo') || legacy()),
      };
    }
    // Window dimensions can change after rotation or desktop window resizing.
    const info = { ...stableInfo, ...(read('getWindowInfo') || legacy()) };
    const data = {};
    Object.keys(TEXT_FIELDS).forEach((key) => {
      if (typeof info[key] !== 'string') return;
      const value = Array.from(info[key].trim()).slice(0, 80).join('');
      if (value) data[TEXT_FIELDS[key]] = value;
    });
    const language = normalizeLanguage(info.language);
    if (language) data.wx_language = language;
    const width = positive(info.screenWidth) ? info.screenWidth : info.windowWidth;
    const height = positive(info.screenHeight) ? info.screenHeight : info.windowHeight;
    return {
      language,
      ...(positive(width) && positive(height) ? { screen: `${width}x${height}` } : {}),
      data,
    };
  };
}
