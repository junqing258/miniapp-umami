const EVENT_PROPERTIES = {
  experiment_exposure: [],
  performance_page_ready: ['duration_ms'],
  performance_app_startup: ['duration_ms'],
  performance_app_launch: ['duration_ms'],
  performance_subpackage_route: ['package_name', 'duration_ms'],
  performance_package_script: ['package_name', 'duration_ms'],
  performance_fcp: ['value_ms'],
  performance_lcp: ['value_ms'],
};

const MAX_STRING_LENGTH = 80;
const MAX_DATA_LENGTH = 512;
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

export function sanitizeUtmQuery(query) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) return '';

  const parameters = [];
  UTM_KEYS.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(query, key) || typeof query[key] !== 'string') return;
    const value = Array.from(query[key].trim()).slice(0, MAX_STRING_LENGTH).join('');
    if (!value) return;
    try {
      parameters.push(`${key}=${encodeURIComponent(value)}`);
    } catch (error) {
      // Malformed Unicode in an entry parameter must not interrupt app startup.
    }
  });
  return parameters.join('&');
}

function sanitizeValue(value) {
  if (typeof value === 'string') return value.slice(0, MAX_STRING_LENGTH);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return undefined;
}

export function sanitizeEvent(name, properties = {}, eventProperties = {}) {
  const allowedProperties = Object.prototype.hasOwnProperty.call(EVENT_PROPERTIES, name)
    ? EVENT_PROPERTIES[name]
    : Object.prototype.hasOwnProperty.call(eventProperties, name) && eventProperties[name];
  if (!Array.isArray(allowedProperties)) return null;
  if (!allowedProperties) return null;

  const data = {};
  allowedProperties.forEach((key) => {
    const value = sanitizeValue(properties[key]);
    if (value !== undefined) data[key] = value;
  });

  if (JSON.stringify(data).length > MAX_DATA_LENGTH) return null;
  return { name, data };
}

export function normalizeLanguage(language) {
  return typeof language === 'string' ? language.replace(/_/g, '-').slice(0, MAX_STRING_LENGTH) : '';
}

export function normalizeRoute(route) {
  if (typeof route !== 'string') return '';
  return `/${route.replace(/^\/+/, '').split('?')[0]}`;
}
