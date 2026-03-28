#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DURATION_SECONDS="${DURATION_SECONDS:-10800}"
MAX_AGENTS="${MAX_AGENTS:-2}"
MAX_TASKS="${MAX_TASKS:-3}"
MAX_TOOLS="${MAX_TOOLS:-3}"
PEAK_AGENTS="${PEAK_AGENTS:-4}"
PEAK_TASKS="${PEAK_TASKS:-5}"
PEAK_TOOLS="${PEAK_TOOLS:-5}"
MIN_AGENTS="${MIN_AGENTS:-1}"
MIN_TASKS="${MIN_TASKS:-1}"
MIN_TOOLS="${MIN_TOOLS:-1}"
SUCCESS_STREAK_TO_RAMP="${SUCCESS_STREAK_TO_RAMP:-2}"
INSECURE_SSL="${INSECURE_SSL:-1}"
EVALUATION_MODE="${EVALUATION_MODE:-llm}"
PROVIDER="${PROVIDER:-}"
SLEEP_BETWEEN_CATEGORIES="${SLEEP_BETWEEN_CATEGORIES:-5}"
LOG_PATH="${LOG_PATH:-.omx/logs/agenthunt-simulation-loop.jsonl}"
export AGENTHUNT_LLM_SLEEP_SECONDS="${AGENTHUNT_LLM_SLEEP_SECONDS:-0.5}"
export AGENTHUNT_LLM_MAX_ATTEMPTS="${AGENTHUNT_LLM_MAX_ATTEMPTS:-8}"
export AGENTHUNT_LLM_RETRY_BASE_SECONDS="${AGENTHUNT_LLM_RETRY_BASE_SECONDS:-2.0}"

mkdir -p "$(dirname "$LOG_PATH")"

categories_json="$(python3 - <<'PY'
import json
from pathlib import Path
runtime = json.loads(Path('config/runtime.json').read_text(encoding='utf-8'))
print(json.dumps(runtime.get('active_categories', runtime.get('working_categories', []))))
PY
)"

readarray -t CATEGORIES < <(python3 - <<'PY'
import json
from pathlib import Path
runtime = json.loads(Path('config/runtime.json').read_text(encoding='utf-8'))
for item in runtime.get('active_categories', runtime.get('working_categories', [])):
    print(item)
PY
)

START_TS="$(date +%s)"
CYCLE=0
SUCCESS_STREAK=0
FAILURE_STREAK=0

run_one() {
  local category="$1"
  local cmd=(python3 -m agenthunt.cli run-demo
    --categories "$category"
    --max-agents "$MAX_AGENTS"
    --max-tasks "$MAX_TASKS"
    --max-tools "$MAX_TOOLS"
    --evaluation-mode "$EVALUATION_MODE"
  )
  if [[ "$INSECURE_SSL" == "1" ]]; then
    cmd+=(--insecure-ssl)
  fi
  if [[ -n "$PROVIDER" ]]; then
    cmd+=(--provider "$PROVIDER")
  fi
  "${cmd[@]}"
}

log_json() {
  printf '%s\n' "$1" >> "$LOG_PATH"
}

ramp_up() {
  if [[ "$MAX_TOOLS" -lt "$PEAK_TOOLS" ]]; then
    MAX_TOOLS=$((MAX_TOOLS + 1))
  elif [[ "$MAX_TASKS" -lt "$PEAK_TASKS" ]]; then
    MAX_TASKS=$((MAX_TASKS + 1))
  elif [[ "$MAX_AGENTS" -lt "$PEAK_AGENTS" ]]; then
    MAX_AGENTS=$((MAX_AGENTS + 1))
  else
    return
  fi
  log_json "$(printf '{"ts":"%s","event":"ramp_up","max_agents":%s,"max_tasks":%s,"max_tools":%s}' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$MAX_AGENTS" "$MAX_TASKS" "$MAX_TOOLS")"
}

backoff_down() {
  if [[ "$MAX_AGENTS" -gt "$MIN_AGENTS" ]]; then
    MAX_AGENTS=$((MAX_AGENTS - 1))
  elif [[ "$MAX_TASKS" -gt "$MIN_TASKS" ]]; then
    MAX_TASKS=$((MAX_TASKS - 1))
  elif [[ "$MAX_TOOLS" -gt "$MIN_TOOLS" ]]; then
    MAX_TOOLS=$((MAX_TOOLS - 1))
  fi
  log_json "$(printf '{"ts":"%s","event":"ramp_down","max_agents":%s,"max_tasks":%s,"max_tools":%s}' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$MAX_AGENTS" "$MAX_TASKS" "$MAX_TOOLS")"
}

cleanup() {
  {
    printf '{"ts":"%s","event":"simulation_loop_exit","cycle":%s}\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$CYCLE"
  } >> "$LOG_PATH"
  python3 -m agenthunt.cli sync-backend >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

{
  printf '{"ts":"%s","event":"simulation_loop_start","duration_seconds":%s,"max_agents":%s,"max_tasks":%s,"max_tools":%s,"evaluation_mode":"%s","provider":"%s","categories":%s}\n' \
    "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$DURATION_SECONDS" "$MAX_AGENTS" "$MAX_TASKS" "$MAX_TOOLS" "$EVALUATION_MODE" "${PROVIDER:-mixed}" "$categories_json"
} >> "$LOG_PATH"

while true; do
  NOW_TS="$(date +%s)"
  ELAPSED="$((NOW_TS - START_TS))"
  if [[ "$ELAPSED" -ge "$DURATION_SECONDS" ]]; then
    break
  fi
  CYCLE="$((CYCLE + 1))"
  for category in "${CATEGORIES[@]}"; do
    NOW_TS="$(date +%s)"
    ELAPSED="$((NOW_TS - START_TS))"
    if [[ "$ELAPSED" -ge "$DURATION_SECONDS" ]]; then
      break 2
    fi
    {
      printf '{"ts":"%s","event":"category_run_start","cycle":%s,"category":"%s","max_agents":%s,"max_tasks":%s,"max_tools":%s}\n' \
        "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$CYCLE" "$category" "$MAX_AGENTS" "$MAX_TASKS" "$MAX_TOOLS"
    } >> "$LOG_PATH"
    tmp_out="$(mktemp)"
    if run_one "$category" >"$tmp_out" 2>&1; then
      cat "$tmp_out" | tee -a "$LOG_PATH"
      SUCCESS_STREAK=$((SUCCESS_STREAK + 1))
      FAILURE_STREAK=0
      python3 -m agenthunt.cli sync-backend >/dev/null 2>&1 || true
      if [[ "$SUCCESS_STREAK" -ge "$SUCCESS_STREAK_TO_RAMP" ]]; then
        ramp_up
        SUCCESS_STREAK=0
      fi
      sleep "$SLEEP_BETWEEN_CATEGORIES"
    else
      cat "$tmp_out" | tee -a "$LOG_PATH"
      FAILURE_STREAK=$((FAILURE_STREAK + 1))
      SUCCESS_STREAK=0
      if grep -q "HTTP Error 429" "$tmp_out"; then
        log_json "$(printf '{"ts":"%s","event":"rate_limit_hit","cycle":%s,"category":"%s","failure_streak":%s}' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$CYCLE" "$category" "$FAILURE_STREAK")"
      else
        log_json "$(printf '{"ts":"%s","event":"category_run_failed","cycle":%s,"category":"%s","failure_streak":%s}' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$CYCLE" "$category" "$FAILURE_STREAK")"
      fi
      backoff_down
      sleep $((SLEEP_BETWEEN_CATEGORIES + FAILURE_STREAK * 10))
    fi
    rm -f "$tmp_out"
  done
done
