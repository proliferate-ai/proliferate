#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=server/deploy/common.sh
. "$SCRIPT_DIR/common.sh"
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

# Validate the resolved config before pulling images or replacing the running
# stack. A dangerous partial config fails here, leaving the healthy instance
# untouched.
"$SCRIPT_DIR/preflight.sh" "$RUNTIME_ENV_FILE"

"$SCRIPT_DIR/registry-login.sh"
"$SCRIPT_DIR/install-runtime.sh"

COMPOSE_ARGS=(--env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE")

# Update every service enabled through the deployment contract, including
# optional-profile services (agent-gateway litellm + litellm-db, cloud-workspaces
# redis) when the capability flag is on. Same one mechanism bootstrap.sh uses.
PROFILE_ARGS=()
while IFS= read -r _profile_token; do
  [[ -n "$_profile_token" ]] && PROFILE_ARGS+=("$_profile_token")
done < <(proliferate_profile_args "$RUNTIME_ENV_FILE")

PROFILE_SERVICES=()
while IFS= read -r _profile_service; do
  [[ -n "$_profile_service" ]] && PROFILE_SERVICES+=("$_profile_service")
done < <(proliferate_profile_services "$RUNTIME_ENV_FILE")

docker compose "${COMPOSE_ARGS[@]}" ${PROFILE_ARGS[@]+"${PROFILE_ARGS[@]}"} pull
docker compose "${COMPOSE_ARGS[@]}" run --rm migrate
docker compose "${COMPOSE_ARGS[@]}" up -d db api caddy
# --wait, scoped explicitly to the profiled services: an enabled optional
# service (litellm, redis) must be healthy before this script hands back
# control, not merely "started". Deliberately NOT a bare `up -d --wait`
# across the whole compose file — that would also try to reconcile the
# one-shot `migrate` job above, which always exits after running and would
# make --wait report a false failure.
if ((${#PROFILE_SERVICES[@]})); then
  docker compose "${COMPOSE_ARGS[@]}" "${PROFILE_ARGS[@]}" up -d --wait --wait-timeout "${PROLIFERATE_PROFILE_WAIT_TIMEOUT_SECONDS:-300}" "${PROFILE_SERVICES[@]}"
fi

"$SCRIPT_DIR/wait-for-health.sh"
