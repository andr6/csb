const fs = require("node:fs");
const path = require("node:path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = process.env.CSB_DB_PATH || path.join(DATA_DIR, "csb.sqlite");

// Driver resolution order: better-sqlite3 (native) → node-sqlite3-wasm (pure WASM).
// Each driver is tried both at require() time AND at open() time, so a binary that
// loads but fails to open the file (e.g. a stale prebuild with a glibc mismatch that
// only surfaces on first I/O) still cascades to the WASM fallback correctly.
let NativeDatabase = null;
let WasmDatabase = null;

try { NativeDatabase = require("better-sqlite3"); } catch (_) {}
try { WasmDatabase = require("node-sqlite3-wasm").Database; } catch (_) {}

let _db = null;
let _dbError = null;
let _usingWasm = false;

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function tryOpen(DatabaseClass, wasm) {
  ensureDataDir();
  const db = new DatabaseClass(DB_PATH);
  if (wasm) {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA busy_timeout = 5000;");
  } else {
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
  }
  return db;
}

function getDb() {
  if (_dbError) throw _dbError;
  if (_db) return _db;

  // Try native first
  if (NativeDatabase) {
    try {
      _db = tryOpen(NativeDatabase, false);
      _usingWasm = false;
      console.log("[sqlite] using native better-sqlite3 at " + DB_PATH);
      return _db;
    } catch (e) {
      console.warn("[sqlite] better-sqlite3 open failed (" + e.message + "), trying WASM fallback");
    }
  }

  // Try WASM
  if (WasmDatabase) {
    try {
      _db = tryOpen(WasmDatabase, true);
      _usingWasm = true;
      console.log("[sqlite] using node-sqlite3-wasm at " + DB_PATH);
      return _db;
    } catch (e) {
      _dbError = e;
      console.error("[sqlite] WASM open also failed (" + e.message + ") — path: " + DB_PATH);
      throw _dbError;
    }
  }

  _dbError = new Error("No SQLite driver available (tried better-sqlite3 and node-sqlite3-wasm). DB path: " + DB_PATH);
  throw _dbError;
}

function escapeSqlString(value) {
  return String(value).replace(/'/g, "''");
}

function runSql(sql) {
  getDb().exec(sql);
}

function queryJson(sql) {
  const db = getDb();
  const stmt = db.prepare(sql);
  // node-sqlite3-wasm requires an explicit [] argument; better-sqlite3 accepts no args.
  return stmt.all([]);
}

function runSqlParams(sql, params) {
  getDb().prepare(sql).run(params || []);
}

function queryJsonParams(sql, params) {
  return getDb().prepare(sql).all(params || []);
}

function healthCheck() {
  try {
    const db = getDb();
    db.prepare("SELECT 1").all([]);
    return true;
  } catch (_) {
    return false;
  }
}

function closeAndReopen() {
  try {
    if (_db && _db.close) {
      _db.close();
    }
  } catch (_) {}
  _db = null;
  _dbError = null;
  return getDb();
}

module.exports = {
  DB_PATH,
  DATA_DIR,
  ensureDataDir,
  escapeSqlString,
  runSql,
  queryJson,
  runSqlParams,
  queryJsonParams,
  isWasm: function() { return _usingWasm; },
  healthCheck,
  closeAndReopen,
};
