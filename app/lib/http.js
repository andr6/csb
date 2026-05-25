const { HTTP_TIMEOUT_MS } = require("./config");

function withTimeout(ms) {
  const controller = new AbortController();
  const timeout = setTimeout(function() {
    controller.abort(new Error("Request timed out after " + ms + "ms"));
  }, ms);

  return {
    signal: controller.signal,
    cleanup: function() {
      clearTimeout(timeout);
    },
  };
}

async function fetchJson(url, options, label, timeoutMs) {
  const effectiveTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : HTTP_TIMEOUT_MS;
  const timer = withTimeout(effectiveTimeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      signal: timer.signal,
    });

    const text = await res.text();
    let data = null;

    if (text) {
      try {
        data = JSON.parse(text);
      } catch (e) {
        if (!res.ok) {
          throw new Error(label + " returned non-JSON error " + res.status);
        }
        throw new Error(label + " returned invalid JSON");
      }
    }

    if (!res.ok) {
      const message = data && data.error && data.error.message
        ? data.error.message
        : label + " error " + res.status;
      throw new Error(message);
    }

    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(label + " request timed out after " + effectiveTimeoutMs + "ms");
    }
    throw error;
  } finally {
    timer.cleanup();
  }
}

module.exports = {
  fetchJson: fetchJson,
  withTimeout: withTimeout,
};
