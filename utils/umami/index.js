import Transport from './transport';
import { normalizeLanguage, normalizeRoute, sanitizeEvent } from './sanitize';

let options = null;
let transport = null;
let systemInfo = null;

function getSystemInfo() {
  if (systemInfo) return systemInfo;
  try {
    systemInfo = wx.getSystemInfoSync();
  } catch (error) {
    systemInfo = {};
  }
  return systemInfo;
}

function enabled() {
  return Boolean(options && options.enabled && transport);
}

function payload(base = {}) {
  const info = getSystemInfo();
  return {
    website: options.websiteId,
    hostname: options.hostname,
    language: normalizeLanguage(info.language),
    screen: `${info.windowWidth || info.screenWidth || 0}x${info.windowHeight || info.screenHeight || 0}`,
    ...(typeof options.tag === 'string' && options.tag ? { tag: options.tag.slice(0, 80) } : {}),
    ...base,
  };
}

function send(eventPayload) {
  if (!enabled()) return;
  transport.enqueue({ type: 'event', payload: eventPayload });
}

export function getHostname() {
  return options && options.hostname ? options.hostname : '';
}

const umami = {
  init(nextOptions = {}) {
    if (options) return;
    if (!nextOptions.enabled || !nextOptions.endpoint || !nextOptions.websiteId || !nextOptions.hostname) {
      options = { enabled: false };
      return;
    }
    options = nextOptions;
    transport = new Transport(nextOptions);
  },

  trackPageview({ url, title = '', referrer = '' } = {}) {
    const route = normalizeRoute(url);
    if (!route) return;
    send(payload({ url: route, title: String(title).slice(0, 120), referrer }));
  },

  track(name, properties) {
    const event = sanitizeEvent(name, properties);
    if (!event) return;
    const pages = getCurrentPages();
    const currentPage = pages[pages.length - 1];
    send(payload({ url: normalizeRoute(currentPage && currentPage.route), name: event.name, data: event.data }));
  },

  flush() {
    if (transport) transport.drain();
  },

  setEnabled(value) {
    if (transport) transport.setEnabled(Boolean(value));
    if (options) options.enabled = Boolean(value);
  },
};

export default umami;
