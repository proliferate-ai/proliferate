#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_ENV_FILE="${PROLIFERATE_ENV_FILE:-$SCRIPT_DIR/.env.runtime}"
HEALTHCHECK_URL="${PROLIFERATE_HEALTHCHECK_URL:-http://127.0.0.1:8000/health}"
PUBLIC_HEALTHCHECK_URL="${PROLIFERATE_PUBLIC_HEALTHCHECK_URL:-}"
MAX_ATTEMPTS="${PROLIFERATE_HEALTHCHECK_ATTEMPTS:-60}"
SLEEP_SECONDS="${PROLIFERATE_HEALTHCHECK_SLEEP_SECONDS:-2}"

read_env_value() {
  local file="$1"
  local key="$2"
  local line

  if [[ ! -f "$file" ]]; then
    return 0
  fi

  line="$(grep -m1 "^${key}=" "$file" || true)"
  if [[ -z "$line" ]]; then
    return 0
  fi

  printf '%s' "${line#*=}"
}

wait_for_url() {
  local url="$1"
  local attempt=1

  until curl -fsS "$url" >/dev/null; do
    if (( attempt >= MAX_ATTEMPTS )); then
      echo "Health check failed for $url after $MAX_ATTEMPTS attempts." >&2
      exit 1
    fi

    attempt=$((attempt + 1))
    sleep "$SLEEP_SECONDS"
  done
}

if [[ -z "$PUBLIC_HEALTHCHECK_URL" ]]; then
  PUBLIC_HEALTHCHECK_URL="$(read_env_value "$RUNTIME_ENV_FILE" PROLIFERATE_PUBLIC_HEALTHCHECK_URL)"
fi

wait_for_url "$HEALTHCHECK_URL"

if [[ -n "$PUBLIC_HEALTHCHECK_URL" ]]; then
  wait_for_url "$PUBLIC_HEALTHCHECK_URL"
fi
