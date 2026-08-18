#!/usr/bin/env bash
# MemoryPets — restart dsh web so host/client code changes take effect.
#
# Usage:
#   ./scripts/restart-dsh.sh
#
# Behavior:
#   1. Kill any running `dsh web` (also kills by $DSH_PORT if set).
#   2. Wait 1s for sockets to release.
#   3. cd into $DSH_REPO and start `node apps/cli/lib/bin.js web` in the
#      foreground. The actual listening port is whatever `webServer.config.port`
#      is set to in your cordis patch (default 3080).
#
# Configurable via env:
#   DSH_REPO   path to the deepseek-harness checkout (default: ~/coding/deepseek-harness-master)
#   DSH_PORT   port to kill if held by a stale process (default: 3080)
#
# Browser hint: after the new server prints its URL, hard-refresh the page
# (Cmd/Ctrl + Shift + R) so the new client bundle rev replaces any cached one.

set -euo pipefail

DSH_REPO="${DSH_REPO:-$HOME/AI/deepseek-harness-master}"
DSH_PORT="${DSH_PORT:-3080}"

if [[ ! -d "$DSH_REPO" ]]; then
  echo "[restart-dsh] DSH_REPO does not exist: $DSH_REPO" >&2
  echo "[restart-dsh] Set DSH_REPO=/path/to/deepseek-harness and re-run." >&2
  exit 1
fi

echo "[restart-dsh] killing any running dsh web processes..."
pkill -f 'dsh web' 2>/dev/null || true
pkill -f 'node apps/cli/lib/bin.js web' 2>/dev/null || true

# Free the port if something else is still bound (pnpm dev / a stale node, etc).
# We only do this if the port is set; pass DSH_PORT=0 to skip.
if [[ "$DSH_PORT" != "0" ]]; then
  port_pids=$(lsof -ti:"$DSH_PORT" 2>/dev/null || true)
  if [[ -n "$port_pids" ]]; then
    echo "[restart-dsh] freeing port $DSH_PORT (pids: $port_pids)"
    # shellcheck disable=SC2086
    kill -9 $port_pids 2>/dev/null || true
  fi
fi

sleep 1

echo "[restart-dsh] starting dsh web in $DSH_REPO..."
echo "[restart-dsh] (Ctrl-C to stop; rerun this script to restart again)"
echo "[restart-dsh] Port is set by ~/.dsh/profiles/web/cordis.patch.yml webServer config (default 3080)."
echo

cd "$DSH_REPO"
exec node apps/cli/lib/bin.js web