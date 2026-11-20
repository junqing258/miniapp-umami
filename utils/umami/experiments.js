const NAME = /^[a-zA-Z0-9_-]{1,50}$/;

function validName(value) {
  return typeof value === 'string' && NAME.test(value);
}

export default class Experiments {
  constructor(websiteId, definitions = {}) {
    this.websiteId = websiteId;
    this.definitions = new Map();
    this.assignments = new Map();
    this.exposed = new Set();
    if (!definitions || typeof definitions !== 'object' || Array.isArray(definitions)) return;
    // Bound the number of configured experiments within one SDK instance.
    Object.keys(definitions)
      .slice(0, 20)
      .forEach((id) => {
        const config = definitions[id];
        if (!validName(id) || !config || config.enabled !== true || !validName(config.revision)) return;
        const { variants } = config;
        if (!variants || typeof variants !== 'object' || Array.isArray(variants)) return;
        const entries = Object.entries(variants);
        if (entries.length < 2 || entries.length > 10) return;
        if (entries.some(([name, weight]) => !validName(name) || !Number.isInteger(weight) || weight <= 0)) return;
        const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
        if (!Number.isSafeInteger(total)) return;
        this.definitions.set(id, { revision: config.revision, entries, total });
      });
  }

  getVariant(id) {
    const config = this.definitions.get(id);
    if (!config) return null;
    if (this.assignments.has(id)) return this.assignments.get(id);
    const key = `umami:experiment:${this.websiteId}:${id}:${config.revision}`;
    let variant;
    try {
      if (typeof wx.getStorageSync !== 'function' || typeof wx.setStorageSync !== 'function') return null;
      variant = wx.getStorageSync(key);
      if (!config.entries.some(([name]) => name === variant)) {
        let bucket = Math.random() * config.total;
        [variant] = config.entries[config.entries.length - 1];
        config.entries.some(([name, weight]) => {
          bucket -= weight;
          if (bucket >= 0) return false;
          variant = name;
          return true;
        });
        wx.setStorageSync(key, variant);
      }
    } catch (error) {
      // Without persistent assignment, fall back to the original UI and exclude from the experiment.
      return null;
    }
    this.assignments.set(id, variant);
    return variant;
  }

  context(id, requireExposure = true) {
    if (requireExposure && !this.exposed.has(id)) return null;
    const variant = this.getVariant(id);
    if (!variant) return null;
    return {
      [`exp_${id}_${this.definitions.get(id).revision}`]: variant,
    };
  }

  expose(id) {
    if (this.exposed.has(id)) return null;
    const data = this.context(id, false);
    if (!data) return null;
    this.exposed.add(id);
    return data;
  }

  resetExposure() {
    this.exposed.clear();
  }
}
