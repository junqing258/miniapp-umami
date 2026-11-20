import umami from './index';

// These pages scroll inside components/CSS containers, not the Page viewport.
const VIEWPORT_ONLY_ROUTES = ['pages/home/index', 'pages/my/index', 'pages/message/index', 'pages/chat/index'];

function windowInfo() {
  try {
    if (typeof wx.getWindowInfo === 'function') return wx.getWindowInfo();
  } catch (error) {
    /* Fall back on older clients. */
  }
  try {
    return wx.getSystemInfoSync();
  } catch (error) {
    return {};
  }
}

function measure(page, callback) {
  if (!umami.isHeatmapEnabled() || typeof wx.createSelectorQuery !== 'function') return;
  try {
    const query = wx.createSelectorQuery().in(page);
    query.select('.umami-heatmap-root').boundingClientRect();
    query.selectViewport().scrollOffset();
    query.exec((results) => {
      if (!page.__umamiHeatmapVisible || !results) return;
      const [root, scroll] = results;
      const viewport = windowInfo();
      if (!root || !scroll || !viewport) return;
      const metrics = {
        pageW: Math.max(viewport.windowWidth, root.right + scroll.scrollLeft),
        pageH: Math.max(viewport.windowHeight, root.bottom + scroll.scrollTop),
        viewportW: viewport.windowWidth,
        viewportH: viewport.windowHeight,
        scrollTop: scroll.scrollTop,
        scrollLeft: scroll.scrollLeft,
      };
      if (VIEWPORT_ONLY_ROUTES.includes(page.route)) {
        metrics.pageW = metrics.viewportW;
        metrics.pageH = metrics.viewportH;
      }
      page.__umamiHeatmapMetrics = metrics;
      callback(metrics);
    });
  } catch (error) {
    // Unsupported APIs or a disappearing page must not interrupt business handlers.
  }
}

function measureSurface(page, callback) {
  try {
    const query = wx.createSelectorQuery().in(page);
    query.select('#umami-scroll-surface').boundingClientRect();
    query.select('.umami-heatmap-scroll-content').boundingClientRect();
    query.select('#umami-scroll-surface').scrollOffset();
    query.exec((results) => {
      if (!results) return;
      const [rect, content, scroll] = results;
      if (!rect || !content || !scroll) return;
      const metrics = {
        pageW: Math.max(rect.width, content.width),
        pageH: Math.max(rect.height, content.height),
        viewportW: rect.width,
        viewportH: rect.height,
        left: rect.left,
        top: rect.top,
        scrollLeft: scroll.scrollLeft || 0,
        scrollTop: scroll.scrollTop || 0,
      };
      page.__umamiHeatmapSurface = metrics;
      callback(metrics);
    });
  } catch (error) {
    // Ignore unsupported selector APIs.
  }
}

export function heatmapTap(page, event, surface = false) {
  if (!umami.isHeatmapEnabled()) return;
  const touch = event && event.changedTouches && event.changedTouches[0];
  if (!touch) return; // Component-generated semantic taps are not coordinates.
  const { clientX: x, clientY: y } = touch;
  if (surface) {
    measureSurface(page, (inner) => {
      umami.trackHeatmap('click', `${page.route}/heatmap-scroll`, inner, {
        x: x - inner.left,
        y: y - inner.top,
        pageX: x - inner.left + inner.scrollLeft,
        pageY: y - inner.top + inner.scrollTop,
      });
    });
    return;
  }
  const send = (metrics) => {
    umami.trackHeatmap('click', page.route, metrics, {
      x,
      y,
      pageX: Number.isFinite(touch.pageX) ? touch.pageX : x + metrics.scrollLeft,
      pageY: Number.isFinite(touch.pageY) ? touch.pageY : y + metrics.scrollTop,
    });
  };
  if (page.__umamiHeatmapMetrics) send(page.__umamiHeatmapMetrics);
  else measure(page, send);
}

export function heatmapScroll(page) {
  if (!umami.isHeatmapEnabled() || page.__umamiHeatmapTimer) return;
  page.__umamiHeatmapTimer = setTimeout(() => {
    page.__umamiHeatmapTimer = null;
    measure(page, (metrics) => {
      if (VIEWPORT_ONLY_ROUTES.includes(page.route)) return;
      const pct = Math.min(100, Math.round((100 * (metrics.scrollTop + metrics.viewportH)) / metrics.pageH));
      if (pct <= (page.__umamiHeatmapDepth || 0)) return;
      page.__umamiHeatmapDepth = pct;
      umami.trackHeatmap('scroll', page.route, metrics, { scrollPct: pct });
    });
  }, 400);
}

export function heatmapSurfaceScroll(page) {
  if (!umami.isHeatmapEnabled() || page.__umamiHeatmapSurfaceTimer) return;
  page.__umamiHeatmapSurfaceTimer = setTimeout(() => {
    page.__umamiHeatmapSurfaceTimer = null;
    if (!page.__umamiHeatmapVisible) return;
    measureSurface(page, (metrics) => {
      const pct = Math.min(100, Math.round((100 * (metrics.scrollTop + metrics.viewportH)) / metrics.pageH));
      if (pct <= (page.__umamiHeatmapSurfaceDepth || 0)) return;
      page.__umamiHeatmapSurfaceDepth = pct;
      umami.trackHeatmap('scroll', `${page.route}/heatmap-scroll`, metrics, { scrollPct: pct });
    });
  }, 400);
}

export function startHeatmapPage(page) {
  if (!page.__umamiHeatmapVisible) return;
  heatmapScroll(page);
  if (['pages/message/index', 'pages/chat/index'].includes(page.route)) heatmapSurfaceScroll(page);
}

export function stopHeatmapPage(page) {
  page.__umamiHeatmapVisible = false;
  clearTimeout(page.__umamiHeatmapTimer);
  page.__umamiHeatmapTimer = null;
  clearTimeout(page.__umamiHeatmapSurfaceTimer);
  page.__umamiHeatmapSurfaceTimer = null;
}
