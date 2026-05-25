const MAX_ROUTE_STATS = 200;

function createMetricsStore() {
  return {
    startedAt: new Date().toISOString(),
    requests: 0,
    apiRequests: 0,
    errors5xx: 0,
    routeStats: {},
  };
}

function getRouteKey(req) {
  return req.route && req.route.path
    ? req.method + " " + req.route.path
    : req.method + " " + req.path;
}

function recordRequest(metrics, req, res, durationMs) {
  metrics.requests += 1;
  if (req.path.indexOf("/api/") === 0) {
    metrics.apiRequests += 1;
  }
  if (res.statusCode >= 500) {
    metrics.errors5xx += 1;
  }

  const key = getRouteKey(req);
  if (!metrics.routeStats[key] && Object.keys(metrics.routeStats).length >= MAX_ROUTE_STATS) {
    const leastUsed = Object.keys(metrics.routeStats).reduce(function(min, k) {
      return metrics.routeStats[k].count < metrics.routeStats[min].count ? k : min;
    });
    if (metrics.routeStats[leastUsed].count < 2) {
      delete metrics.routeStats[leastUsed];
    } else {
      return;
    }
  }
  if (!metrics.routeStats[key]) {
    metrics.routeStats[key] = { count: 0, errors5xx: 0, avgMs: 0, maxMs: 0 };
  }

  const stat = metrics.routeStats[key];
  stat.count += 1;
  if (res.statusCode >= 500) stat.errors5xx += 1;
  stat.maxMs = Math.max(stat.maxMs, durationMs);
  stat.avgMs = Math.round((((stat.avgMs * (stat.count - 1)) + durationMs) / stat.count) * 100) / 100;
}

const defaultStore = createMetricsStore();

function saveMetrics(store) {
  try {
    const { runSqlParams, runSql } = require("./sqlite");
    const snapshot = JSON.stringify(store);
    const now = new Date().toISOString();
    runSqlParams("INSERT INTO metrics_snapshots (snapshot_at, data_json) VALUES (?, ?)", [now, snapshot]);
    runSql(
      "DELETE FROM metrics_snapshots WHERE snapshot_at NOT IN (" +
      "  SELECT snapshot_at FROM metrics_snapshots ORDER BY snapshot_at DESC LIMIT 336" +
      ");"
    );
  } catch (e) {
    // sqlite may not be ready yet on first boot
  }
}

function loadMetrics(store) {
  try {
    const { queryJson } = require("./sqlite");
    const rows = queryJson(
      "SELECT data_json FROM metrics_snapshots ORDER BY snapshot_at DESC LIMIT 1;"
    );
    if (!rows.length) return;
    const saved = JSON.parse(rows[0].data_json);
    if (saved && typeof saved === "object") {
      store.requests = Number(saved.requests || 0);
      store.apiRequests = Number(saved.apiRequests || 0);
      store.errors5xx = Number(saved.errors5xx || 0);
      store.routeStats = saved.routeStats && typeof saved.routeStats === "object" ? saved.routeStats : {};
    }
  } catch (e) {
    // fresh start — no snapshot to load
  }
}

function startAutoSave(store, intervalMs) {
  const ms = Number(intervalMs || 5 * 60 * 1000);
  const timer = setInterval(function() { saveMetrics(store); }, ms);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = {
  createMetricsStore: createMetricsStore,
  recordRequest: recordRequest,
  defaultStore: defaultStore,
  saveMetrics: saveMetrics,
  loadMetrics: loadMetrics,
  startAutoSave: startAutoSave,
};
