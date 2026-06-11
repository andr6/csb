const fs = require("node:fs");
const path = require("node:path");

const { DB_PATH, DATA_DIR, runSql } = require("./sqlite");

const BACKUPS_DIR = process.env.CSB_BACKUPS_DIR || path.join(DATA_DIR, "backups");
const BACKUP_KEEP_COUNT = process.env.CSB_BACKUP_KEEP_COUNT
  ? Number(process.env.CSB_BACKUP_KEEP_COUNT)
  : 7;

function ensureBackupsDir() {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

function backupFilename() {
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return "csb_" + ts + ".sqlite";
}

function pruneOldBackups() {
  try {
    const files = fs
      .readdirSync(BACKUPS_DIR)
      .filter(function(f) { return f.endsWith(".sqlite") && f.startsWith("csb_"); })
      .map(function(f) {
        return {
          name: f,
          path: path.join(BACKUPS_DIR, f),
          mtime: fs.statSync(path.join(BACKUPS_DIR, f)).mtimeMs,
        };
      })
      .sort(function(a, b) { return b.mtime - a.mtime; });

    const toDelete = files.slice(BACKUP_KEEP_COUNT);
    toDelete.forEach(function(file) {
      try {
        fs.unlinkSync(file.path);
        console.log("[backup] pruned old backup:", file.name);
      } catch (e) {
        console.warn("[backup] failed to prune", file.name, e.message);
      }
    });
  } catch (e) {
    console.warn("[backup] prune error:", e.message);
  }
}

function runBackup() {
  ensureBackupsDir();
  const filename = backupFilename();
  const destPath = path.resolve(path.join(BACKUPS_DIR, filename));

  // Path traversal guard: destination must live inside BACKUPS_DIR.
  if (!destPath.startsWith(path.resolve(BACKUPS_DIR) + path.sep)) {
    console.error("[backup] aborted: path escapes backups directory");
    return { ok: false, error: "Invalid backup path." };
  }

  try {
    // VACUUM INTO creates a consistent snapshot without locking the source DB.
    // Works with both better-sqlite3 and node-sqlite3-wasm (SQLite ≥3.27).
    // SQLite VACUUM INTO does not accept placeholders; the path is system-built
    // above and validated against traversal, so inline escaping is acceptable.
    runSql("VACUUM INTO '" + destPath.replace(/'/g, "''") + "';");
    console.log("[backup] created", destPath);
    pruneOldBackups();
    return { ok: true, path: destPath };
  } catch (e) {
    console.error("[backup] failed:", e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = {
  BACKUPS_DIR,
  BACKUP_KEEP_COUNT,
  runBackup,
};
