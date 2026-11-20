const EVENT_PROPERTIES = {
  login_success: ['method', 'mock'],
  search_submit: ['source', 'keyword_length'],
  release_click: [],
  draft_save_click: [],
  home_refresh: [],
  home_list_item_click: ['source', 'position'],
  home_release_entry_click: [],
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

export function sanitizeEvent(name, properties = {}) {
  const allowedProperties = EVENT_PROPERTIES[name];
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
