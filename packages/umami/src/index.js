import Transport from './transport.js';
import { startPerformanceObserver } from './performance.js';
import { createEntryContext } from './entry.js';
import { normalizeRoute, sanitizeEvent, sanitizeUtmQuery } from './sanitize.js';
import { createSystemContext } from './system.js';
import Heatmap from './heatmap.js';
import ErrorMonitor from './errors.js';
import { createVersionContext } from './version.js';
import Experiments from './experiments.js';
import SessionProperties from './session.js';

let options = null;
let transport = null;
let heatmap = null;
let errors = null;
let experiments = null;
let sessionProperties = null;
const getSystemContext = createSystemContext();
const getVersionContext = createVersionContext();
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
  const { data: eventData, ...event } = base;
  const data = { ...eventData, ...entryData };
  return {
    website: options.websiteId,
    hostname: options.hostname,
    language: info.language,
    ...(info.screen ? { screen: info.screen } : {}),
    ...(typeof options.tag === 'string' && options.tag ? { tag: options.tag.slice(0, 80) } : {}),
    ...event,
    ...(Object.keys(data).length ? { data } : {}),
  };
}

function send(eventPayload) {
  if (!enabled()) return;
  transport.enqueue({ type: 'event', payload: eventPayload });
}

function trackEvent(name, properties, route, experimentData) {
  if (!enabled()) return;
  if (name === 'experiment_exposure' && !experimentData) return;
  const event = sanitizeEvent(name, properties, options.eventProperties);
  if (!event) return;
  const pages = getCurrentPages();
  const currentPage = pages[pages.length - 1];
  send(
    payload({
      url: trackingUrl(route || (currentPage && currentPage.route)),
      name: event.name,
      data: { ...event.data, ...experimentData },
    }),
  );
}

export function getPageTitle(route) {
  const titles = options && options.pageTitles;
  return titles && Object.prototype.hasOwnProperty.call(titles, route) ? titles[route] : '';
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
    experiments = new Experiments(nextOptions.websiteId, nextOptions.experiments);
    transport = new Transport({
      ...nextOptions,
      onResponse: () => {
        if (sessionProperties) sessionProperties.sync();
        if (heatmap) heatmap.flush();
      },
    });
    if (nextOptions.sessionProperties !== false) {
      sessionProperties = new SessionProperties(nextOptions, transport, () => {
        const info = getSystemContext();
        return { ...info, data: { ...info.data, ...getVersionContext() } };
      });
    }
    if (nextOptions.errors && nextOptions.errors.enabled) {
      errors = new ErrorMonitor(nextOptions, transport, () => {
        const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
        const page = pages[pages.length - 1];
        return { ...getSystemContext(), url: page && page.route };
      });
    }
    if (nextOptions.heatmap && nextOptions.heatmap.enabled) {
      heatmap = new Heatmap(
        {
          ...nextOptions,
          onHeatmapReady: () => {
            getCurrentPages().forEach((page) => {
              if (page.__umamiHeatmapStart) page.__umamiHeatmapStart();
            });
          },
        },
        transport,
      );
    }
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
    if (!enabled()) return;
    const route = trackingUrl(url);
    if (!route) return;
    send(payload({ url: route, title: String(title).slice(0, 120), referrer }));
  },

  track(name, properties) {
    trackEvent(name, properties);
  },

  getVariant(experimentId) {
    return enabled() && experiments ? experiments.getVariant(experimentId) : null;
  },

  trackExposure(experimentId) {
    if (!enabled() || !experiments) return;
    const data = experiments.expose(experimentId);
    if (data) trackEvent('experiment_exposure', {}, undefined, data);
  },

  trackExperiment(experimentId, name, properties) {
    // Preserve the business event even when the experiment is disabled or not yet exposed.
    const data = enabled() && experiments ? experiments.context(experimentId) : null;
    trackEvent(name, properties, undefined, data);
  },

  captureException(error, context) {
    if (enabled() && errors) errors.capture(error, context);
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
    if (sessionProperties) sessionProperties.flush();
    if (heatmap) heatmap.flush();
    if (errors) errors.flush();
  },

  trackHeatmap(type, route, metrics, point) {
    if (enabled() && heatmap) heatmap.track(type, route, metrics, point);
  },

  isHeatmapEnabled() {
    return Boolean(enabled() && heatmap && heatmap.collecting);
  },

  getHeatmapStatus() {
    return heatmap ? heatmap.status() : { collecting: false, hasSession: false, queued: 0 };
  },

  setEnabled(value) {
    if (!value && experiments) experiments.resetExposure();
    if (transport) transport.setEnabled(Boolean(value));
    if (sessionProperties) sessionProperties.setEnabled(Boolean(value));
    if (heatmap) heatmap.setEnabled(Boolean(value));
    if (errors) errors.setEnabled(Boolean(value));
    if (options) options.enabled = Boolean(value);
  },
};

export default umami;
