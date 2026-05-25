const fs = require("node:fs");
const path = require("node:path");

const { runSql, queryJson, runSqlParams } = require("./sqlite");

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

function ensureSchemaMigrationsTable() {
  runSql([
    "CREATE TABLE IF NOT EXISTS schema_migrations (",
    "  version TEXT PRIMARY KEY,",
    "  applied_at TEXT NOT NULL",
    ");",
  ].join("\n"));
}

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(function(file) { return file.endsWith(".sql"); })
    .sort();
}

function getAppliedVersions() {
  const rows = queryJson("SELECT version FROM schema_migrations ORDER BY version ASC;");
  return new Set(rows.map(function(row) { return row.version; }));
}

function applyMigration(version, sql) {
  // Split multi-statement SQL and run each statement individually so we can
  // identify exactly which statement fails and apply targeted error handling.
  const stmts = sql
    .split(/;\s*\n/)
    .map(function(s) { return s.trim(); })
    .filter(function(s) { return s.length > 0; });

  stmts.forEach(function(stmt, i) {
    const fullStmt = stmt.endsWith(";") ? stmt : stmt + ";";
    try {
      runSql(fullStmt);
    } catch (err) {
      // ALTER TABLE ADD COLUMN fails with "duplicate column name" when the column
      // already exists (e.g. schema drift between environments). Treat as idempotent.
      if (/duplicate column name/i.test(err.message) && /ALTER TABLE/i.test(fullStmt)) {
        console.warn("[migrations] " + version + " stmt " + (i + 1) + ": column already exists, skipping — " + err.message);
        return;
      }
      // For any other error, attach context and re-throw so the caller can log clearly.
      const wrapped = new Error("[migrations] " + version + " stmt " + (i + 1) + " failed: " + err.message + "\nSQL: " + fullStmt.slice(0, 200));
      wrapped.cause = err;
      throw wrapped;
    }
  });

  runSqlParams(
    "INSERT INTO schema_migrations (version, applied_at) VALUES (?, datetime('now'))",
    [String(version)]
  );
}

function applyPendingMigrations() {
  ensureSchemaMigrationsTable();
  const applied = getAppliedVersions();
  const files = listMigrationFiles();

  files.forEach(function(file) {
    if (applied.has(file)) return;
    console.log("[migrations] applying " + file);
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    applyMigration(file, sql);
    console.log("[migrations] " + file + " done");
  });

  return files;
}

module.exports = {
  applyPendingMigrations: applyPendingMigrations,
  MIGRATIONS_DIR: MIGRATIONS_DIR,
};
