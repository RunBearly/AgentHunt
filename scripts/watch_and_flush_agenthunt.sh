#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-900}"
ONCE="${ONCE:-0}"

cd "$ROOT_DIR"

while true; do
  echo "[watch_and_flush_agenthunt] $(date -u +"%Y-%m-%dT%H:%M:%SZ") checking Launch AgentHunt commit..."
  python3 -m agenthunt.cli check-launch --fetch | tee .omx/logs/launch-watch-latest.json

  echo "[watch_and_flush_agenthunt] planning backend sync..."
  python3 -m agenthunt.cli sync-backend | tee .omx/logs/backend-sync-plan-latest.json

  if grep -q '"status": "ready_for_backend_replay"' .omx/logs/backend-sync-plan-latest.json; then
    echo "[watch_and_flush_agenthunt] backend looks ready, applying queued sync..."
    python3 -m agenthunt.cli sync-backend --apply | tee .omx/logs/backend-sync-apply-latest.json
  fi

  if [[ "$ONCE" == "1" ]]; then
    break
  fi
  sleep "$INTERVAL_SECONDS"
done
