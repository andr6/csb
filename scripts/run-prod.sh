#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${ROOT_DIR}/app"
ENV_FILE="${CSB_ENV_FILE:-${APP_DIR}/.env}"
LOG_DIR="${CSB_LOG_DIR:-${APP_DIR}/logs}"
NODE_BIN="${NODE_BIN:-node}"
NPM_BIN="${NPM_BIN:-npm}"

if [[ ! -d "${APP_DIR}" ]]; then
  echo "App directory not found: ${APP_DIR}" >&2
  exit 1
fi

if ! command -v "${NODE_BIN}" >/dev/null 2>&1; then
  echo "Node.js binary not found: ${NODE_BIN}" >&2
  exit 1
fi

if ! command -v "${NPM_BIN}" >/dev/null 2>&1; then
  echo "npm binary not found: ${NPM_BIN}" >&2
  exit 1
fi

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
else
  echo "Environment file not found: ${ENV_FILE}" >&2
  echo "Create ${APP_DIR}/.env from ${APP_DIR}/env.example before launching." >&2
  exit 1
fi

mkdir -p "${APP_DIR}/data" "${LOG_DIR}"

# ── Dependency installation ────────────────────────────────────────────────────
# Runs when node_modules is absent or FORCE_INSTALL=1 is set.
# better-sqlite3 is declared as an optionalDependency so npm never fails the
# install if it can't build (RHEL 8, old g++, glibc < 2.29, etc.).
# node-sqlite3-wasm (pure WASM, no native deps) is always installed and is
# used as the SQLite driver automatically when better-sqlite3 is unavailable.
_install_deps() {
  echo "Installing production dependencies..."
  "${NPM_BIN}" ci --omit=dev
  echo "Dependencies installed."
}

NEEDS_INSTALL=false
[[ ! -d "${APP_DIR}/node_modules" ]] && NEEDS_INSTALL=true
[[ "${CSB_SKIP_INSTALL:-0}" == "1" ]] && NEEDS_INSTALL=false
[[ "${FORCE_INSTALL:-0}" == "1" ]] && NEEDS_INSTALL=true

if [[ "${NEEDS_INSTALL}" == "true" ]]; then
  (cd "${APP_DIR}" && _install_deps)
fi

if ! "${NODE_BIN}" -e 'const major = Number(process.versions.node.split(".")[0]); if (major < 18) process.exit(1);'; then
  echo "Node.js 18+ is required. Current version: $("${NODE_BIN}" -v)" >&2
  exit 1
fi

export NODE_ENV="${NODE_ENV:-production}"
export PORT="${PORT:-3000}"

echo "Starting Chat Shit Bob"
echo "  app dir   : ${APP_DIR}"
echo "  env file  : ${ENV_FILE}"
echo "  log dir   : ${LOG_DIR}"
echo "  node env  : ${NODE_ENV}"
echo "  port      : ${PORT}"

cd "${APP_DIR}"
exec "${NODE_BIN}" server.js
