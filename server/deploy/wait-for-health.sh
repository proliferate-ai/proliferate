#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HEALTHCHECK_URL="${PROLIFERATE_HEALTHCHECK_URL:-http://127.0.0.1:8000/health}"
PUBLIC_HEALTHCHECK_URL="${PROLIFERATE_PUBLIC_HEALTHCHECK_URL:-}"
MAX_ATTEMPTS="${PROLIFERATE_HEALTHCHECK_ATTEMPTS:-60}"
SLEEP_SECONDS="${PROLIFERATE_HEALTHCHECK_SLEEP_SECONDS:-2}"
COMPOSE_FILE="${PROLIFERATE_COMPOSE_FILE:-$SCRIPT_DIR/docker-compose.production.yml}"
SETUP_TOKEN_PATH="${PROLIFERATE_SETUP_TOKEN_PATH:-/var/lib/proliferate/setup/setup-token}"

warn() {
  echo "WARNING: $*" >&2
}

# Resolve the compose env file explicitly so this script also works standalone
# (bootstrap.sh exports PROLIFERATE_ENV_FILE, but an operator re-running the
# health gate by hand does not). Prefer the generated runtime env, then the
# operator's static env next to this script.
resolve_runtime_env_file() {
  if [[ -n "${PROLIFERATE_ENV_FILE:-}" ]]; then
    printf '%s' "$PROLIFERATE_ENV_FILE"
    return 0
  fi

  local candidate
  for candidate in "$SCRIPT_DIR/.env.runtime" "$SCRIPT_DIR/.env.static" "$SCRIPT_DIR/.env"; do
    if [[ -f "$candidate" ]]; then
      printf '%s' "$candidate"
      return 0
    fi
  done

  printf '%s' "$SCRIPT_DIR/.env.runtime"
}

RUNTIME_ENV_FILE="$(resolve_runtime_env_file)"

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

# Compose a browser URL from SITE_ADDRESS. Operators may set SITE_ADDRESS with
# or without a scheme (Caddy accepts both); Caddy serves https unless the
# operator configured an explicit http:// site.
site_url_from_address() {
  local address="$1"
  local path="$2"
  local scheme="https"
  local host="$address"

  if [[ "$host" == http://* ]]; then
    scheme="http"
    host="${host#http://}"
  elif [[ "$host" == https://* ]]; then
    host="${host#https://}"
  fi
  host="${host%/}"

  printf '%s://%s%s' "$scheme" "$host" "$path"
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
  # with the claim URL. Prints nothing once the instance is claimed or in
  # hosted mode, and warns loudly when it cannot check at all.
  local token=""
  local site_address=""
  local api_container=""
  local claim_url=""

  if ! command -v docker >/dev/null 2>&1; then
    warn "docker not found; cannot check whether first-run setup is pending."
    return 0
  fi
  if [[ ! -f "$COMPOSE_FILE" ]]; then
    warn "Compose file not found at $COMPOSE_FILE; cannot check whether \
first-run setup is pending. Point PROLIFERATE_COMPOSE_FILE at your \
docker-compose.production.yml."
    return 0
  fi
  if [[ ! -f "$RUNTIME_ENV_FILE" ]]; then
    warn "Env file not found at $RUNTIME_ENV_FILE; cannot check whether \
first-run setup is pending. Run bootstrap.sh first, or point \
PROLIFERATE_ENV_FILE at the generated .env.runtime."
    return 0
  fi

  api_container="$(docker compose --env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE" \
    ps -q api 2>/dev/null || true)"
  if [[ -z "$api_container" ]]; then
    warn "No running api container found for $COMPOSE_FILE (env file: \
$RUNTIME_ENV_FILE); cannot check whether first-run setup is pending. Start \
the stack with bootstrap.sh, and run this script next to the deploy files it \
was started from."
    return 0
  fi

  if ! docker compose --env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE" \
    exec -T api test -f "$SETUP_TOKEN_PATH" >/dev/null 2>&1; then
    # No token file: the instance is already claimed (or running hosted mode).
    return 0
  fi

  token="$(docker compose --env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE" \
    exec -T api cat "$SETUP_TOKEN_PATH" 2>/dev/null | tr -d '[:space:]' || true)"
  if [[ -z "$token" ]]; then
    warn "The setup token file exists at $SETUP_TOKEN_PATH inside the api \
container but could not be read. Try: docker compose --env-file \
$RUNTIME_ENV_FILE -f $COMPOSE_FILE exec api cat $SETUP_TOKEN_PATH"
    return 0
  fi

  site_address="$(read_env_value "$RUNTIME_ENV_FILE" SITE_ADDRESS)"
  if [[ -n "$site_address" ]]; then
    claim_url="$(site_url_from_address "$site_address" /setup)"
  else
    claim_url="https://<your-host>/setup"
  fi

  echo ""
  echo "First-run setup is pending. Claim this instance in a browser:"
  echo ""
  echo "  Setup token: $token"
  echo "  Claim URL:   $claim_url"
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
