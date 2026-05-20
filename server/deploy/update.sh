#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.production.yml"
STATIC_ENV_FILE="$SCRIPT_DIR/.env.static"
LEGACY_ENV_FILE="$SCRIPT_DIR/.env"
RUNTIME_ENV_FILE="$SCRIPT_DIR/.env.runtime"

if [[ -f "$STATIC_ENV_FILE" ]]; then
  ENV_FILE="$STATIC_ENV_FILE"
else
  ENV_FILE="$LEGACY_ENV_FILE"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy .env.production.example to .env.static and set your values first." >&2
  exit 1
fi

export PROLIFERATE_STATIC_ENV_FILE="$ENV_FILE"
export PROLIFERATE_ENV_FILE="$RUNTIME_ENV_FILE"

"$SCRIPT_DIR/ensure-secrets.sh"
"$SCRIPT_DIR/registry-login.sh"
"$SCRIPT_DIR/install-runtime.sh"

COMPOSE_ARGS=(--env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE")
if grep -Eiq '^AGENT_GATEWAY_ENABLED=(true|1|yes)$' "$RUNTIME_ENV_FILE"; then
  COMPOSE_ARGS+=(--profile agent-gateway)
else
  docker compose --env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE" --profile agent-gateway stop litellm litellm-db || true
  docker compose --env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE" --profile agent-gateway rm -f litellm litellm-db || true
fi

docker compose "${COMPOSE_ARGS[@]}" pull
docker compose "${COMPOSE_ARGS[@]}" run --rm migrate
docker compose "${COMPOSE_ARGS[@]}" up -d

"$SCRIPT_DIR/wait-for-health.sh"
