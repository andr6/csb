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

function rollupMetrics() {
  try {
    const { runSqlParams, queryJson, runSql } = require("./sqlite");
    const now = new Date();
    const hour = now.toISOString().slice(0, 13) + ":00:00.000Z";
    const hourStart = hour;
    const hourEnd = now.toISOString();

    const rows = queryJson(
      "SELECT data_json FROM metrics_snapshots WHERE snapshot_at >= '" + hourStart + "' AND snapshot_at < '" + hourEnd + "' ORDER BY snapshot_at ASC;"
    );
    if (!rows.length) return;

    let totalRequests = 0;
    let apiRequests = 0;
    let errors5xx = 0;
    const routeAgg = {};

    rows.forEach(function(row) {
      const data = JSON.parse(row.data_json);
      totalRequests += Number(data.requests || 0);
      apiRequests += Number(data.apiRequests || 0);
      errors5xx += Number(data.errors5xx || 0);
      const stats = data.routeStats || {};
      Object.keys(stats).forEach(function(key) {
        const s = stats[key];
        if (!routeAgg[key]) {
          routeAgg[key] = { count: 0, errors5xx: 0, maxMs: 0, totalMs: 0 };
        }
        routeAgg[key].count += Number(s.count || 0);
        routeAgg[key].errors5xx += Number(s.errors5xx || 0);
        routeAgg[key].maxMs = Math.max(routeAgg[key].maxMs, Number(s.maxMs || 0));
        routeAgg[key].totalMs += Number(s.avgMs || 0) * Number(s.count || 0);
      });
    });

    // Compute averages
    Object.keys(routeAgg).forEach(function(key) {
      const agg = routeAgg[key];
      agg.avgMs = agg.count ? Math.round((agg.totalMs / agg.count) * 100) / 100 : 0;
      delete agg.totalMs;
    });

    runSqlParams(
      "INSERT OR REPLACE INTO metrics_hourly (hour, total_requests, api_requests, errors_5xx, route_stats_json) VALUES (?, ?, ?, ?, ?)",
      [hour, totalRequests, apiRequests, errors5xx, JSON.stringify(routeAgg)]
    );

    // Prune snapshots older than 7 days after successful rollup
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    runSql(
      "DELETE FROM metrics_snapshots WHERE snapshot_at < '" + cutoff + "';"
    );
  } catch (e) {
    console.warn("[metrics] rollup failed:", e.message);
  }
}

function startHourlyRollup(intervalMs) {
  const ms = Number(intervalMs || 60 * 60 * 1000);
  const timer = setInterval(rollupMetrics, ms);
  if (timer.unref) timer.unref();
  // Run once shortly after startup to catch any lingering snapshots
  setTimeout(rollupMetrics, 5000);
  return timer;
}

module.exports = {
  createMetricsStore: createMetricsStore,
  recordRequest: recordRequest,
  defaultStore: defaultStore,
  saveMetrics: saveMetrics,
  loadMetrics: loadMetrics,
  startAutoSave: startAutoSave,
  rollupMetrics: rollupMetrics,
  startHourlyRollup: startHourlyRollup,
};
