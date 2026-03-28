#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-900}"
ONCE="${ONCE:-0}"

cd "$ROOT_DIR"

while true; do
  echo "[watch_launch_agenthunt] $(date -u +"%Y-%m-%dT%H:%M:%SZ") checking GitHub main for Launch AgentHunt..."
  python3 -m agenthunt.cli check-launch | tee .omx/logs/launch-watch-latest.json
  if [[ "$ONCE" == "1" ]]; then
    break
  fi
  sleep "$INTERVAL_SECONDS"
done
