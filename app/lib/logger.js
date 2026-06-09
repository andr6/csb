const isProd = process.env.NODE_ENV === "production";

function _now() {
  return new Date().toISOString();
}

function _serialize(obj) {
  try {
    return JSON.stringify(obj);
  } catch (_) {
    return String(obj);
  }
}

function _build(level, msg, meta) {
  var entry = {
    time: _now(),
    level: level,
    msg: String(msg || ""),
  };
  if (meta && typeof meta === "object") {
    Object.keys(meta).forEach(function(k) {
      if (entry[k] === undefined) entry[k] = meta[k];
    });
  }
  return _serialize(entry);
}

function info(msg, meta) {
  var line = _build("info", msg, meta);
  if (isProd) {
    console.log(line);
  } else {
    console.log("[INFO] " + (meta && meta.requestId ? "[" + meta.requestId + "] " : "") + msg);
  }
}

function warn(msg, meta) {
  var line = _build("warn", msg, meta);
  if (isProd) {
    console.log(line);
  } else {
    console.warn("[WARN] " + (meta && meta.requestId ? "[" + meta.requestId + "] " : "") + msg);
  }
}

function error(msg, meta) {
  var line = _build("error", msg, meta);
  if (isProd) {
    console.log(line);
  } else {
    console.error("[ERROR] " + (meta && meta.requestId ? "[" + meta.requestId + "] " : "") + msg);
  }
}

module.exports = { info, warn, error };
