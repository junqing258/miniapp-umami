const EVENT_PROPERTIES = {
  login_success: ['method', 'mock'],
  search_submit: ['source', 'keyword_length'],
  release_click: [],
  draft_save_click: [],
  home_refresh: [],
  home_list_item_click: ['source', 'position'],
  home_release_entry_click: [],
};

const MAX_STRING_LENGTH = 80;
const MAX_DATA_LENGTH = 512;

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
