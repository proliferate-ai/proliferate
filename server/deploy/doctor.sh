#!/usr/bin/env bash
#
# Redacting diagnostics for a self-hosted Proliferate control plane.
#
# Run from the deploy directory (or point PROLIFERATE_DEPLOY_DIR at it):
#   sudo /opt/proliferate/server/deploy/doctor.sh
#
# Checks the host, configuration, compose services/profiles, local and public
# health/meta endpoints, DNS/TLS, published-version compatibility, and the
# shape of optional add-on config (Redis, gateway, GitHub, E2B) WITHOUT ever
# printing a secret value. Optional capabilities that are off or incomplete are
# reported as degraded (WARN), not as core failures.
#
# Exit status: 0 when the base control plane is healthy (warnings allowed),
# 1 when a core problem is found (stack down, config would prevent boot).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="${PROLIFERATE_DEPLOY_DIR:-$SCRIPT_DIR}"
# shellcheck source=server/deploy/common.sh
. "$DEPLOY_DIR/common.sh"

COMPOSE_FILE="$DEPLOY_DIR/docker-compose.production.yml"
STATIC_ENV_FILE="$DEPLOY_DIR/.env.static"
GENERATED_ENV_FILE="$DEPLOY_DIR/.env.generated"
RUNTIME_ENV_FILE="$DEPLOY_DIR/.env.runtime"
# Prefer the resolved runtime env; fall back to the static env for a
# pre-bootstrap doctor run.
ENV_FILE="$RUNTIME_ENV_FILE"
[[ -f "$ENV_FILE" ]] || ENV_FILE="$STATIC_ENV_FILE"

FAILS=0
WARNS=0

section() { printf '\n== %s ==\n' "$*"; }
pass() { printf '  [PASS] %s\n' "$*"; }
info() { printf '  [INFO] %s\n' "$*"; }
warn() {
  WARNS=$((WARNS + 1))
  printf '  [WARN] %s\n' "$*"
}
fail() {
  FAILS=$((FAILS + 1))
  printf '  [FAIL] %s\n' "$*"
}

get() { proliferate_read_env "$ENV_FILE" "$1"; }

# shape <KEY>: report whether a secret-bearing value is set, by length only.
shape() {
  local key="$1" value
  value="$(get "$key")"
  if [[ -n "$value" ]]; then
    printf 'set (%d chars)' "${#value}"
  else
    printf 'not set'
  fi
}

# host_from_site: bare hostname from SITE_ADDRESS (strip scheme/trailing slash).
host_from_site() {
  local h
  h="$(get SITE_ADDRESS)"
  h="${h#http://}"
  h="${h#https://}"
  printf '%s' "${h%/}"
}

# site_url <path>: browser URL from SITE_ADDRESS (https unless SITE_ADDRESS
# carries an explicit http:// scheme).
site_url() {
  local address scheme="https" host
  address="$(get SITE_ADDRESS)"
  host="$address"
  if [[ "$host" == http://* ]]; then
    scheme="http"
    host="${host#http://}"
  elif [[ "$host" == https://* ]]; then
    host="${host#https://}"
  fi
  host="${host%/}"
  printf '%s://%s%s' "$scheme" "$host" "$1"
}

compose() {
  docker compose --env-file "$RUNTIME_ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

# --- Host --------------------------------------------------------------------

section "Host"
os="$(uname -s)"
if [[ "$os" == "Linux" ]]; then pass "OS: Linux"; else warn "OS: $os (the control plane is supported on Linux)"; fi
arch="$(uname -m)"
case "$arch" in
  x86_64 | amd64 | aarch64 | arm64) pass "Architecture: $arch" ;;
  *) warn "Architecture: $arch (supported: x86_64, aarch64)" ;;
esac
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  pass "Docker daemon reachable"
else
  fail "Docker daemon not reachable. Start Docker or rerun with sudo."
fi
if docker compose version >/dev/null 2>&1; then
  pass "Docker Compose v2: $(docker compose version --short 2>/dev/null || echo present)"
else
  fail "Docker Compose v2 plugin missing."
fi
free_kb="$(df -Pk "$DEPLOY_DIR" 2>/dev/null | awk 'NR==2 {print $4}')"
if [[ -n "$free_kb" ]]; then
  if [[ "$free_kb" -lt 2097152 ]]; then
    warn "Low disk: $((free_kb / 1024)) MB free under $DEPLOY_DIR."
  else
    pass "Disk: $((free_kb / 1024)) MB free under $DEPLOY_DIR"
  fi
fi
if command -v ss >/dev/null 2>&1; then
  for port in 80 443; do
    if ss -ltn "sport = :$port" 2>/dev/null | awk 'NR>1{f=1} END{exit !f}'; then
      pass "Port $port has a listener (expected: Caddy)"
    else
      warn "Port $port has no listener; Caddy may not be running."
    fi
  done
fi

# --- Configuration -----------------------------------------------------------

section "Configuration"
if [[ -f "$STATIC_ENV_FILE" ]]; then
  pass "Operator config present: .env.static"
  perms="$(stat -c '%a' "$STATIC_ENV_FILE" 2>/dev/null || stat -f '%A' "$STATIC_ENV_FILE" 2>/dev/null || echo '?')"
  case "$perms" in
    600 | 400 | 640) info ".env.static permissions: $perms" ;;
    *) warn ".env.static is $perms; it holds config and possibly secrets — chmod 600 it." ;;
  esac
else
  warn "No .env.static yet. Run the installer or copy .env.production.example to .env.static."
fi
if [[ -f "$GENERATED_ENV_FILE" ]]; then
  perms="$(stat -c '%a' "$GENERATED_ENV_FILE" 2>/dev/null || stat -f '%A' "$GENERATED_ENV_FILE" 2>/dev/null || echo '?')"
  case "$perms" in
    600 | 400) pass "Generated secrets file locked down (.env.generated: $perms)" ;;
    *) warn ".env.generated is $perms; chmod 600 it (it holds JWT/DB/cloud secrets)." ;;
  esac
fi
# Reuse preflight for the config-shape verdict without aborting doctor.
if [[ -f "$DEPLOY_DIR/preflight.sh" && -f "$ENV_FILE" ]]; then
  if "$DEPLOY_DIR/preflight.sh" "$ENV_FILE" >/dev/null 2>&1; then
    pass "preflight: configuration valid"
  else
    fail "preflight found configuration errors. Run: $DEPLOY_DIR/preflight.sh $ENV_FILE"
  fi
fi

# --- Compose services & profiles --------------------------------------------

section "Compose services"
enabled_profiles="$(proliferate_enabled_profiles "$ENV_FILE")"
if [[ -n "$enabled_profiles" ]]; then
  info "Enabled optional profiles: $enabled_profiles"
else
  info "Enabled optional profiles: (none — base install)"
fi
if [[ -f "$RUNTIME_ENV_FILE" ]] && docker info >/dev/null 2>&1; then
  # Build profile args so profiled services (e.g. litellm) are visible in ps.
  PROFILE_ARGS=()
  while IFS= read -r tok; do [[ -n "$tok" ]] && PROFILE_ARGS+=("$tok"); done \
    < <(proliferate_profile_args "$ENV_FILE")
  for svc in caddy db api; do
    state="$(compose ps --format '{{.State}}' "$svc" 2>/dev/null | head -n1)"
    if [[ "$state" == "running" ]]; then
      pass "service $svc: running"
    else
      fail "service $svc: ${state:-not created}. Check: $DEPLOY_DIR/update.sh and docker compose logs $svc"
    fi
  done
else
  warn "Stack not started (no .env.runtime or Docker unreachable); skipping service state."
fi

# --- Endpoints ---------------------------------------------------------------

section "Endpoints"
local_health="http://127.0.0.1:8000/health"
if curl -fsS --max-time 5 "$local_health" >/dev/null 2>&1; then
  pass "local API /health: ok"
else
  fail "local API /health failed ($local_health). The api container may be down or restart-looping (check docker compose logs api)."
fi
meta_json="$(curl -fsS --max-time 5 http://127.0.0.1:8000/meta 2>/dev/null || true)"
running_version="$(printf '%s' "$meta_json" | grep -oE '"serverVersion":"[^"]*"' | sed -E 's/.*:"([^"]*)"/\1/')"
if [[ -n "$running_version" ]]; then
  pass "local API /meta serverVersion: $running_version"
else
  warn "could not read /meta serverVersion from the local API."
fi

site_host="$(host_from_site)"
if [[ -n "$site_host" ]]; then
  # DNS
  if command -v getent >/dev/null 2>&1; then
    if getent hosts "$site_host" >/dev/null 2>&1; then
      pass "DNS resolves: $site_host"
    else
      warn "DNS does not resolve $site_host yet (needed for public TLS)."
    fi
  fi
  # Public health over the advertised scheme (usually https).
  pub_health="$(site_url /health)"
  if curl -fsS --max-time 10 "$pub_health" >/dev/null 2>&1; then
    pass "public /health: ok ($pub_health)"
  else
    warn "public /health did not respond ($pub_health). DNS/TLS may still be provisioning, or a firewall blocks 80/443."
  fi
  # TLS certificate (only meaningful for https sites).
  if [[ "$pub_health" == https://* ]] && command -v openssl >/dev/null 2>&1; then
    enddate="$(echo | openssl s_client -connect "$site_host:443" -servername "$site_host" 2>/dev/null \
      | openssl x509 -noout -enddate 2>/dev/null | sed 's/notAfter=//')"
    if [[ -n "$enddate" ]]; then
      pass "TLS certificate present (expires: $enddate)"
    else
      warn "could not read a TLS certificate for $site_host (Let's Encrypt may still be issuing)."
    fi
  fi
else
  info "SITE_ADDRESS not set / sslip fallback resolved at runtime; skipping public checks."
fi

# --- Version compatibility ---------------------------------------------------

section "Version compatibility"
bundle_version=""
[[ -f "$DEPLOY_DIR/VERSION" ]] && bundle_version="$(tr -d '[:space:]' <"$DEPLOY_DIR/VERSION")"
[[ -n "$bundle_version" ]] && info "installed bundle VERSION: $bundle_version"
latest_version="$(proliferate_latest_server_version 2>/dev/null || true)"
if [[ -z "$latest_version" ]]; then
  warn "could not reach the release API to check for updates."
elif [[ -n "$running_version" ]]; then
  if [[ "$running_version" == "$latest_version" ]]; then
    pass "running the newest published server release (server-v$latest_version)"
  else
    highest="$(printf '%s\n%s\n' "$running_version" "$latest_version" | proliferate_max_version)"
    if [[ "$highest" == "$latest_version" ]]; then
      warn "update available: running $running_version, newest server-v$latest_version. Run: $DEPLOY_DIR/update.sh"
    else
      info "running $running_version, ahead of the newest published server-v$latest_version (pre-release or pinned)."
    fi
  fi
fi

# --- Redis (only when a capability requires it) ------------------------------

section "Redis"
# Cloud materialization uses a Redis lock. The bundled `redis` service comes
# up automatically under the cloud-workspaces profile whenever the E2B pair
# is complete (see common.sh), so only check when that capability is on.
if [[ -n "$(get E2B_API_KEY)" && -n "$(get E2B_TEMPLATE_NAME)" ]]; then
  redis_url="$(get REDBEAT_REDIS_URL)"
  if [[ -f "$RUNTIME_ENV_FILE" ]] && docker info >/dev/null 2>&1; then
    redis_state="$(compose --profile cloud-workspaces ps --format '{{.State}}' redis 2>/dev/null | head -n1)"
    if [[ "$redis_state" == "running" ]]; then
      pass "service redis: running (${redis_url:-redis://redis:6379/0})"
    else
      fail "service redis: ${redis_state:-not created}. Cloud materialization cannot acquire its lock without it. Check: $DEPLOY_DIR/update.sh and docker compose logs redis"
    fi
  else
    warn "Stack not started; cannot check the redis service state."
  fi
else
  info "cloud workspaces not configured; Redis not required."
fi

# --- Agent gateway (only when enabled) ---------------------------------------

section "Agent gateway"
if proliferate_is_truthy "$(get AGENT_GATEWAY_ENABLED)"; then
  info "AGENT_GATEWAY_ENABLED=true (profile: agent-gateway)"
  info "LITELLM_MASTER_KEY: $(shape LITELLM_MASTER_KEY); AGENT_GATEWAY_LITELLM_MASTER_KEY: $(shape AGENT_GATEWAY_LITELLM_MASTER_KEY)"
  if [[ -f "$RUNTIME_ENV_FILE" ]] && docker info >/dev/null 2>&1; then
    litellm_state="$(compose --profile agent-gateway ps --format '{{.State}}' litellm 2>/dev/null | head -n1)"
    litellm_health="$(compose --profile agent-gateway ps --format '{{.Health}}' litellm 2>/dev/null | head -n1)"
    if [[ "$litellm_state" == "running" && ( "$litellm_health" == "healthy" || -z "$litellm_health" ) ]]; then
      pass "service litellm: running (:4000 ${litellm_health:-no healthcheck reported}))"
    else
      fail "service litellm: ${litellm_state:-not created} (health: ${litellm_health:-unknown}). Start it: docker compose --env-file $RUNTIME_ENV_FILE -f $COMPOSE_FILE --profile agent-gateway up -d (bootstrap.sh/update.sh do this automatically). Check: docker compose logs litellm"
    fi
  fi
  pub_gw="$(get AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL)"
  if [[ -n "$pub_gw" ]]; then
    if curl -fsS --max-time 8 "${pub_gw%/}/health/liveliness" >/dev/null 2>&1 \
      || curl -fsS --max-time 8 "${pub_gw%/}/health" >/dev/null 2>&1; then
      pass "public gateway endpoint reachable via Caddy /llm ($pub_gw)"
    else
      warn "public gateway endpoint did not respond ($pub_gw). Confirm AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL points at .../llm and DNS/TLS for it are ready."
    fi
  else
    warn "AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL is not set; sandboxes cannot reach the gateway."
  fi
  if [[ -z "$(get ANTHROPIC_API_KEY)" && -z "$(get OPENAI_API_KEY)" && -z "$(get XAI_API_KEY)" ]]; then
    warn "No provider key (ANTHROPIC_API_KEY / OPENAI_API_KEY / XAI_API_KEY) is set for litellm; it has no model to serve."
  fi
else
  info "agent gateway disabled."
fi

# --- Deployment SSO (only when enabled) ---------------------------------------

section "Deployment SSO"
if proliferate_is_truthy "$(get SSO_ENABLED)"; then
  info "SSO_ENABLED=true; client id: $(shape SSO_OIDC_CLIENT_ID); client secret: $(shape SSO_OIDC_CLIENT_SECRET)"
  sso_jit="$(get SSO_JIT_POLICY)"
  if [[ "${sso_jit:-disabled}" == "disabled" && -z "$(get ADMIN_EMAILS)" ]]; then
    warn "SSO_JIT_POLICY=disabled (or unset) and ADMIN_EMAILS is empty: no SSO sign-in can create the first user. Set ADMIN_EMAILS (password sign-in) or SSO_JIT_POLICY=create_member."
  else
    pass "SSO first-user path is reachable (ADMIN_EMAILS set or SSO_JIT_POLICY auto-provisions)."
  fi
else
  info "SSO disabled."
fi

# --- Optional add-on config shape (redacted) ---------------------------------

section "Add-on configuration (redacted)"
info "GitHub OAuth client id: $(shape GITHUB_OAUTH_CLIENT_ID); secret: $(shape GITHUB_OAUTH_CLIENT_SECRET)"
if [[ -n "$(get GITHUB_APP_ID)" ]]; then
  info "GitHub App: id set; private key: $(shape GITHUB_APP_PRIVATE_KEY); private key path: $(get GITHUB_APP_PRIVATE_KEY_PATH); webhook secret: $(shape GITHUB_APP_WEBHOOK_SECRET)"
fi
e2b_key="$(get E2B_API_KEY)"
e2b_tmpl="$(get E2B_TEMPLATE_NAME)"
if [[ -n "$e2b_key" || -n "$e2b_tmpl" ]]; then
  # Template name is not a secret; showing it aids debugging.
  info "E2B: api key $(shape E2B_API_KEY); template ${e2b_tmpl:-<empty>}"
fi
if [[ -n "$(get RESEND_API_KEY)" ]]; then
  info "Resend: api key $(shape RESEND_API_KEY); from address $(get RESEND_FROM_EMAIL)"
else
  info "RESEND_API_KEY not set; invitation email delivery is 'skipped' (admins use the copy-link)."
fi

# --- Summary -----------------------------------------------------------------

section "Summary"
if [[ "$FAILS" -gt 0 ]]; then
  printf '  %d failure(s), %d warning(s). Control plane is NOT healthy.\n' "$FAILS" "$WARNS"
  exit 1
fi
printf '  0 failures, %d warning(s). Base control plane is healthy.\n' "$WARNS"
exit 0
