#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=server/deploy/common.sh
. "$SCRIPT_DIR/common.sh"
STATIC_ENV_FILE="$SCRIPT_DIR/.env.static"
LEGACY_ENV_FILE="$SCRIPT_DIR/.env"
RUNTIME_ENV_FILE="$SCRIPT_DIR/.env.runtime"
EXAMPLE_ENV_FILE="$SCRIPT_DIR/.env.production.example"
BOOTSTRAP_PROGRESS_FILE="$SCRIPT_DIR/.bootstrap-progress.log"

# This file is the deployment layer's host-local progress record. Reinitialize
# it before any validation or material work so one invocation can never inherit
# another invocation's markers. Reject links/non-files before writing because
# CloudFormation runs this script as root.
bootstrap_progress_init() {
  if [[ -L "$BOOTSTRAP_PROGRESS_FILE" || ( -e "$BOOTSTRAP_PROGRESS_FILE" && ! -f "$BOOTSTRAP_PROGRESS_FILE" ) ]]; then
    printf 'Refusing unsafe bootstrap progress path: %s\n' "$BOOTSTRAP_PROGRESS_FILE" >&2
    return 1
  fi
  (umask 077 && : >"$BOOTSTRAP_PROGRESS_FILE")
  chmod 0600 "$BOOTSTRAP_PROGRESS_FILE"
}

# Fixed, secret-free progress markers consumed by the bounded CloudFormation
# failure diagnostic. Keep both token allowlists in sync; never place command
# output, paths, hostnames, or environment values in this protocol.
bootstrap_substep_marker() {
  local substep="$1"
  local status="$2"
  local marker
  case "$substep" in
    ensure-secrets|preflight|registry-login|runtime-install|db-up|migrate|api-caddy-up|optional-profiles|health-wait) ;;
    *) return 2 ;;
  esac
  case "$status" in
    started|completed) ;;
    *) return 2 ;;
  esac
  marker="__PROLIFERATE_BOOTSTRAP_SUBSTEP__:${substep}:${status}"
  # Append and close the owned file before writing ordinary operator stdout.
  # This guarantees that a later process termination cannot lose an append
  # that already returned; it does not claim power-loss or filesystem-failure
  # immunity, nor recovery if termination interrupts this append itself.
  printf '%s\n' "$marker" >>"$BOOTSTRAP_PROGRESS_FILE"
  printf '%s\n' "$marker"
}

bootstrap_progress_init

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

bootstrap_substep_marker ensure-secrets started
"$SCRIPT_DIR/ensure-secrets.sh"
bootstrap_substep_marker ensure-secrets completed

# Validate the resolved config before touching containers, so a dangerous
# partial config (e.g. E2B_API_KEY without E2B_TEMPLATE_NAME, which crash-loops
# the api) fails here instead of after we have replaced a running stack.
bootstrap_substep_marker preflight started
"$SCRIPT_DIR/preflight.sh" "$RUNTIME_ENV_FILE"
bootstrap_substep_marker preflight completed

bootstrap_substep_marker registry-login started
"$SCRIPT_DIR/registry-login.sh"
bootstrap_substep_marker registry-login completed
bootstrap_substep_marker runtime-install started
"$SCRIPT_DIR/install-runtime.sh"
bootstrap_substep_marker runtime-install completed

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

bootstrap_substep_marker db-up started
docker compose "${COMPOSE_ARGS[@]}" up -d db
bootstrap_substep_marker db-up completed
bootstrap_substep_marker migrate started
docker compose "${COMPOSE_ARGS[@]}" run --rm migrate
bootstrap_substep_marker migrate completed
bootstrap_substep_marker api-caddy-up started
docker compose "${COMPOSE_ARGS[@]}" up -d api caddy
bootstrap_substep_marker api-caddy-up completed

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
bootstrap_substep_marker optional-profiles started
if ((${#PROFILE_SERVICES[@]})); then
  docker compose "${COMPOSE_ARGS[@]}" "${PROFILE_ARGS[@]}" up -d --wait --wait-timeout "${PROLIFERATE_PROFILE_WAIT_TIMEOUT_SECONDS:-300}" "${PROFILE_SERVICES[@]}"
fi
bootstrap_substep_marker optional-profiles completed

# Waits for /health, then prints the first-run setup token and claim URL when
# the instance is still unclaimed.
bootstrap_substep_marker health-wait started
"$SCRIPT_DIR/wait-for-health.sh"
bootstrap_substep_marker health-wait completed
