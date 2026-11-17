const RENDER_METRICS = {
  firstContentfulPaint: 'performance_fcp',
  largestContentfulPaint: 'performance_lcp',
};

let started = false;
let firstRenderStartTime = null;
let reportedMetrics = {};

function asTimestamp(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function asDuration(value) {
  const duration = asTimestamp(value);
  return duration !== null && duration > 0 ? Math.round(duration) : null;
}

function getSubpackageName(route, subpackages) {
  if (typeof route !== 'string' || !Array.isArray(subpackages)) return '';
  const normalizedRoute = `/${route.replace(/^\/+/, '')}`;
  const matched = subpackages.find(({ root }) => {
    const normalizedRoot = typeof root === 'string' ? `/${root.replace(/^\/+|\/+$/g, '')}` : '';
    return normalizedRoot && (normalizedRoute === normalizedRoot || normalizedRoute.startsWith(`${normalizedRoot}/`));
  });
  return matched && typeof matched.name === 'string' ? matched.name : '';
}

function handleNavigationEntry(entry, track, subpackages) {
  const duration = asDuration(entry.duration);
  if (entry.name === 'appLaunch' && duration !== null) {
    track('performance_app_launch', { duration_ms: duration }, entry.path);
    return;
  }

  if (entry.name !== 'route' || duration === null) return;
  const packageName = getSubpackageName(entry.path, subpackages);
  if (packageName) track('performance_subpackage_route', { package_name: packageName, duration_ms: duration }, entry.path);
}

function handleScriptEntry(entry, track) {
  if (entry.name !== 'evaluateScript') return;
  const duration = asDuration(entry.duration);
  if (duration === null || typeof entry.moduleName !== 'string' || !entry.moduleName) return;
  track('performance_package_script', {
    package_name: entry.moduleName === 'APP' ? 'main' : entry.moduleName,
    duration_ms: duration,
  });
}

function handleEntries(entryList, track, subpackages) {
  const entries = entryList && typeof entryList.getEntries === 'function' ? entryList.getEntries() : [];
  entries.forEach((entry) => {
    if (!entry) return;

    if (entry.entryType === 'navigation') {
      handleNavigationEntry(entry, track, subpackages);
      return;
    }

    if (entry.entryType === 'script') {
      handleScriptEntry(entry, track);
      return;
    }

    if (entry.name === 'firstRender') {
      firstRenderStartTime = asTimestamp(entry.startTime);
      reportedMetrics = {};
      return;
    }

    const metric = RENDER_METRICS[entry.name];
    const timestamp = asTimestamp(entry.startTime);
    if (!metric || firstRenderStartTime === null || reportedMetrics[metric]) return;

    if (timestamp === null) return;
    const duration = timestamp - firstRenderStartTime;
    if (duration <= 0) return;
    reportedMetrics[metric] = true;
    track(metric, { value_ms: Math.round(duration) });
  });
}

export function startPerformanceObserver(track, subpackages = []) {
  if (
    started ||
    typeof track !== 'function' ||
    typeof wx === 'undefined' ||
    typeof wx.getPerformance !== 'function'
  ) {
    return;
  }

  try {
    const performance = wx.getPerformance();
    if (!performance || typeof performance.createObserver !== 'function') return;

    const observer = performance.createObserver((entryList) => handleEntries(entryList, track, subpackages));
    const supportedEntryTypes = observer.supportedEntryTypes;
    const entryTypes = ['render', 'navigation', 'script'].filter(
      (entryType) => !Array.isArray(supportedEntryTypes) || supportedEntryTypes.includes(entryType),
    );
    if (!entryTypes.length) return;

    observer.observe({ entryTypes });
    started = true;
  } catch (error) {
    // Performance collection must never affect page startup on older base libraries.
  }
}
