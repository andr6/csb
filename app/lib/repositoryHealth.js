const { healthCheck, closeAndReopen } = require("./sqlite");

const DISABLED = process.env.CSB_REPOSITORY_HEALTH_DISABLED === "1";
const FAILURE_THRESHOLD = 3;
const RECOVERY_INTERVAL_MS = 30000;

let _failureCount = 0;
let _unhealthy = false;
let _lastRecoveryAttempt = 0;

function isEnabled() {
  return !DISABLED;
}

function markFailure() {
  if (DISABLED) return;
  _failureCount++;
  if (_failureCount >= FAILURE_THRESHOLD) {
    if (!_unhealthy) {
      console.warn("[repository-health] SQLite marked unhealthy after " + _failureCount + " consecutive failures.");
      _unhealthy = true;
    }
  }
}

function markSuccess() {
  if (DISABLED) return;
  if (_failureCount > 0) {
    _failureCount = 0;
    if (_unhealthy) {
      console.log("[repository-health] SQLite recovered — queries succeeding again.");
      _unhealthy = false;
    }
  }
}

function maybeRecover() {
  if (DISABLED || !_unhealthy) return false;
  const now = Date.now();
  if (now - _lastRecoveryAttempt < RECOVERY_INTERVAL_MS) return false;
  _lastRecoveryAttempt = now;

  try {
    closeAndReopen();
    if (healthCheck()) {
      markSuccess();
      return true;
    }
  } catch (e) {
    console.warn("[repository-health] SQLite recovery attempt failed:", e.message);
  }
  return false;
}

function isHealthy() {
  if (DISABLED) return true;
  maybeRecover();
  return !_unhealthy;
}

module.exports = {
  isEnabled,
  markFailure,
  markSuccess,
  maybeRecover,
};
