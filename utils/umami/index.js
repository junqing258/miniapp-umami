import Transport from './transport';
import { startPerformanceObserver } from './performance';
import { createEntryContext } from './entry';
import { normalizeRoute, sanitizeEvent, sanitizeUtmQuery } from './sanitize';
import { createSystemContext } from './system';

let options = null;
let transport = null;
const getSystemContext = createSystemContext();
let launchAt = 0;
let startupReported = false;
let entryUtmQuery = '';
let entryData = {};

function trackingUrl(url) {
  const route = normalizeRoute(url);
  return route && entryUtmQuery ? `${route}?${entryUtmQuery}` : route;
}

function enabled() {
  return Boolean(options && options.enabled && transport);
}

function payload(base = {}) {
  const info = getSystemContext();
  const data = { ...base.data, ...entryData, ...info.data };
  return {
    website: options.websiteId,
    hostname: options.hostname,
    language: info.language,
    ...(info.screen ? { screen: info.screen } : {}),
    ...(typeof options.tag === 'string' && options.tag ? { tag: options.tag.slice(0, 80) } : {}),
    ...base,
    ...(Object.keys(data).length ? { data } : {}),
  };
}

function send(eventPayload) {
  if (!enabled()) return;
  transport.enqueue({ type: 'event', payload: eventPayload });
}

function trackEvent(name, properties, route) {
  const event = sanitizeEvent(name, properties);
  if (!event) return;
  const pages = getCurrentPages();
  const currentPage = pages[pages.length - 1];
  send(
    payload({
      url: trackingUrl(route || (currentPage && currentPage.route)),
      name: event.name,
      data: event.data,
    }),
  );
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
    startPerformanceObserver(trackEvent, nextOptions.subpackages);
  },

  markLaunch() {
    launchAt = Date.now();
    startupReported = false;
  },

  setEntryQuery(query) {
    entryUtmQuery = sanitizeUtmQuery(query);
    entryData = {};
  },

  setEntryOptions(entryOptions) {
    const entry = createEntryContext(entryOptions);
    entryUtmQuery = entry.query;
    entryData = entry.data;
  },

  trackPageview({ url, title = '', referrer = '' } = {}) {
    const route = trackingUrl(url);
    if (!route) return;
    send(payload({ url: route, title: String(title).slice(0, 120), referrer }));
  },

  track(name, properties) {
    trackEvent(name, properties);
  },

  trackPageReady(duration, route) {
    const elapsed = Number(duration);
    if (!Number.isFinite(elapsed) || elapsed < 0) return;

    const durationMs = Math.round(elapsed);
    trackEvent('performance_page_ready', { duration_ms: durationMs }, route);

    if (!startupReported && launchAt) {
      startupReported = true;
      trackEvent('performance_app_startup', { duration_ms: Math.max(0, Date.now() - launchAt) }, route);
    }
  },

  flush() {
    if (transport) transport.flush();
  },

  setEnabled(value) {
    if (transport) transport.setEnabled(Boolean(value));
    if (options) options.enabled = Boolean(value);
  },
};

export default umami;
