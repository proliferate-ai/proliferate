#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_ENV_FILE="${PROLIFERATE_ENV_FILE:-$SCRIPT_DIR/.env.runtime}"
HEALTHCHECK_URL="${PROLIFERATE_HEALTHCHECK_URL:-http://127.0.0.1:8000/health}"
PUBLIC_HEALTHCHECK_URL="${PROLIFERATE_PUBLIC_HEALTHCHECK_URL:-}"
MAX_ATTEMPTS="${PROLIFERATE_HEALTHCHECK_ATTEMPTS:-60}"
SLEEP_SECONDS="${PROLIFERATE_HEALTHCHECK_SLEEP_SECONDS:-2}"
COMPOSE_FILE="${PROLIFERATE_COMPOSE_FILE:-$SCRIPT_DIR/docker-compose.production.yml}"
SETUP_TOKEN_PATH="${PROLIFERATE_SETUP_TOKEN_PATH:-/var/lib/proliferate/setup/setup-token}"

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

print_setup_instructions() {
  # While the instance is unclaimed the api container holds the first-run
  # setup token in a local file (never served over HTTP). Print it together
  # with the claim URL. Prints nothing once the instance is claimed, in
  # hosted mode, or when this script runs without the compose stack.
  local token=""
  local site_address=""

  if ! command -v docker >/dev/null 2>&1; then
    return 0
  fi
  if [[ ! -f "$COMPOSE_FILE" || ! -f "$RUNTIME_ENV_FILE" ]]; then
    return 0
  fi

  token="$(docker compose --env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE" \
    exec -T api cat "$SETUP_TOKEN_PATH" 2>/dev/null | tr -d '[:space:]' || true)"
  if [[ -z "$token" ]]; then
    return 0
  fi

  site_address="$(read_env_value "$RUNTIME_ENV_FILE" SITE_ADDRESS)"
  echo ""
  echo "First-run setup is pending. Claim this instance in a browser:"
  echo ""
  echo "  Setup token: $token"
  echo "  Claim URL:   https://${site_address:-<your-host>}/setup"
  echo ""
  echo "The token stays available at $SETUP_TOKEN_PATH inside the api container"
  echo "until the instance is claimed."
}

if [[ -z "$PUBLIC_HEALTHCHECK_URL" ]]; then
  PUBLIC_HEALTHCHECK_URL="$(read_env_value "$RUNTIME_ENV_FILE" PROLIFERATE_PUBLIC_HEALTHCHECK_URL)"
fi

wait_for_url "$HEALTHCHECK_URL"

if [[ -n "$PUBLIC_HEALTHCHECK_URL" ]]; then
  wait_for_url "$PUBLIC_HEALTHCHECK_URL"
fi

print_setup_instructions
