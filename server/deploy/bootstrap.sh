#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=server/deploy/common.sh
. "$SCRIPT_DIR/common.sh"
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

# Validate the resolved config before touching containers, so a dangerous
# partial config (e.g. E2B_API_KEY without E2B_TEMPLATE_NAME, which crash-loops
# the api) fails here instead of after we have replaced a running stack.
"$SCRIPT_DIR/preflight.sh" "$RUNTIME_ENV_FILE"

"$SCRIPT_DIR/registry-login.sh"
"$SCRIPT_DIR/install-runtime.sh"

COMPOSE_ARGS=(--env-file "$RUNTIME_ENV_FILE" -f "$SCRIPT_DIR/docker-compose.production.yml")

# Optional compose override, used by the self-host smoke (smoke/run-smoke.sh)
# to remap host ports while exercising this exact bootstrap path.
if [[ -n "${PROLIFERATE_COMPOSE_OVERRIDE_FILE:-}" ]]; then
  COMPOSE_ARGS+=(-f "$PROLIFERATE_COMPOSE_OVERRIDE_FILE")
fi

# Enabled optional services (e.g. the agent-gateway LiteLLM profile) are turned
# on through one mechanism: a capability flag in the resolved env selects a
# compose profile. Every lifecycle command passes the same --profile args so
# bootstrap/update stay consistent.
PROFILE_ARGS=()
while IFS= read -r _profile_token; do
  [[ -n "$_profile_token" ]] && PROFILE_ARGS+=("$_profile_token")
done < <(proliferate_profile_args "$RUNTIME_ENV_FILE")

PROFILE_SERVICES=()
while IFS= read -r _profile_service; do
  [[ -n "$_profile_service" ]] && PROFILE_SERVICES+=("$_profile_service")
done < <(proliferate_profile_services "$RUNTIME_ENV_FILE")

docker compose "${COMPOSE_ARGS[@]}" up -d db
docker compose "${COMPOSE_ARGS[@]}" run --rm migrate
docker compose "${COMPOSE_ARGS[@]}" up -d api caddy

# Bring up any enabled optional-profile services (agent-gateway litellm +
# litellm-db, cloud-workspaces redis) and WAIT for their healthchecks before
# continuing. No-op for a base install with no optional capabilities enabled.
# --wait matters here specifically for litellm: the API mints per-user
# gateway virtual keys against it lazily at signup, so litellm must already
# be healthy by the time wait-for-health.sh below hands the operator the
# claim URL, not merely "started". Explicitly scoped to PROFILE_SERVICES (not
# a bare `up -d --wait` across the whole compose file): otherwise it would
# also try to reconcile the one-shot `migrate` job, which always exits after
# running and would make --wait report a false failure.
if ((${#PROFILE_SERVICES[@]})); then
  docker compose "${COMPOSE_ARGS[@]}" "${PROFILE_ARGS[@]}" up -d --wait --wait-timeout "${PROLIFERATE_PROFILE_WAIT_TIMEOUT_SECONDS:-300}" "${PROFILE_SERVICES[@]}"
fi

# Waits for /health, then prints the first-run setup token and claim URL when
# the instance is still unclaimed.
"$SCRIPT_DIR/wait-for-health.sh"
