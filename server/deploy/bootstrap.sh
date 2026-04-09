#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATIC_ENV_FILE="$SCRIPT_DIR/.env.static"
LEGACY_ENV_FILE="$SCRIPT_DIR/.env"
RUNTIME_ENV_FILE="$SCRIPT_DIR/.env.runtime"
EXAMPLE_ENV_FILE="$SCRIPT_DIR/.env.production.example"

if [[ -f "$STATIC_ENV_FILE" ]]; then
  ENV_FILE="$STATIC_ENV_FILE"
else
  ENV_FILE="$LEGACY_ENV_FILE"
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required." >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$EXAMPLE_ENV_FILE" "$STATIC_ENV_FILE"
  echo "Created $STATIC_ENV_FILE from $EXAMPLE_ENV_FILE."
  echo "Edit it, point DNS at your host, then rerun this script."
  exit 0
fi

export PROLIFERATE_STATIC_ENV_FILE="$ENV_FILE"
export PROLIFERATE_ENV_FILE="$RUNTIME_ENV_FILE"

"$SCRIPT_DIR/ensure-secrets.sh"
"$SCRIPT_DIR/registry-login.sh"
"$SCRIPT_DIR/install-runtime.sh"

docker compose --env-file "$RUNTIME_ENV_FILE" -f "$SCRIPT_DIR/docker-compose.production.yml" up -d db
docker compose --env-file "$RUNTIME_ENV_FILE" -f "$SCRIPT_DIR/docker-compose.production.yml" run --rm migrate
docker compose --env-file "$RUNTIME_ENV_FILE" -f "$SCRIPT_DIR/docker-compose.production.yml" up -d api caddy

"$SCRIPT_DIR/wait-for-health.sh"
