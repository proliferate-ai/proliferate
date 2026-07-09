#!/usr/bin/env bash
#
# Self-host smoke: boots the production compose stack the same way an operator
# does (bootstrap.sh: generated secrets, migrate, health gate) with an
# http-only Caddy site address so no DNS or TLS issuance is needed, then walks
# the actual first-run operator journey through the production proxy path:
#
#   phase 1  health via Caddy and the API, migrations applied
#   phase 2  /meta version, setup-token claim at /setup, desktop password
#            login, invite, invited registration, and membership assertions
#
# Requirements: Docker with Compose v2.24.4+ (for the port overrides in
# smoke/docker-compose.smoke.yml) and curl. JSON assertions use python3 (from
# the host when present, otherwise from the api container), so nothing beyond
# Docker and curl is required on the host.
#
# Usage:
#   server/deploy/smoke/run-smoke.sh
#
# Environment:
#   PROLIFERATE_SMOKE_IMAGE       Prebuilt server image (repository:tag). When
#                                 unset, builds proliferate-server:smoke from
#                                 server/Dockerfile.
#   PROLIFERATE_SMOKE_HTTP_PORT   Host port for the http-only Caddy site
#                                 (default 8080).
#   PROLIFERATE_SMOKE_API_PORT    Host port mapped to the API container
#                                 (default 18000).
#   PROLIFERATE_SMOKE_KEEP_STACK  true|1 leaves the stack and work dir up for
#                                 inspection instead of tearing down.
#   SMOKE_PHASE                   1 runs only the boot/health assertions
#                                 (phase 1). Anything else (default) runs the
#                                 full claim/login/invite/register journey.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$DEPLOY_DIR/../.." && pwd)"

SMOKE_IMAGE="${PROLIFERATE_SMOKE_IMAGE:-}"
HTTP_PORT="${PROLIFERATE_SMOKE_HTTP_PORT:-8080}"
API_PORT="${PROLIFERATE_SMOKE_API_PORT:-18000}"
KEEP_STACK="${PROLIFERATE_SMOKE_KEEP_STACK:-false}"
SMOKE_PHASE="${SMOKE_PHASE:-full}"

# Journey fixtures. Passwords must satisfy the server's 12-character minimum.
SMOKE_ADMIN_EMAIL="smoke-admin@example.com"
SMOKE_INVITEE_EMAIL="smoke-invitee@example.com"
SMOKE_PASSWORD="proliferate-smoke-password-1"
SETUP_TOKEN_PATH="/var/lib/proliferate/setup/setup-token"

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-proliferate-smoke}"

log() { printf '[smoke] %s\n' "$*"; }

fail() {
  printf '[smoke] FAIL: %s\n' "$*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "Docker is required."
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required."
command -v curl >/dev/null 2>&1 || fail "curl is required."

# --- Server image -----------------------------------------------------------

if [[ -z "$SMOKE_IMAGE" ]]; then
  SMOKE_IMAGE="proliferate-server:smoke"
  log "PROLIFERATE_SMOKE_IMAGE not set; building $SMOKE_IMAGE from server/Dockerfile"
  docker build -f "$REPO_ROOT/server/Dockerfile" -t "$SMOKE_IMAGE" "$REPO_ROOT"
fi

IMAGE_REPOSITORY="${SMOKE_IMAGE%:*}"
IMAGE_TAG="${SMOKE_IMAGE##*:}"
if [[ "$IMAGE_TAG" == "$SMOKE_IMAGE" || "$IMAGE_TAG" == */* ]]; then
  fail "PROLIFERATE_SMOKE_IMAGE must be a repository:tag reference, got: $SMOKE_IMAGE"
fi

# --- Stage an operator-style install dir ------------------------------------
# The deploy bundle is copied to a scratch dir so generated env files never
# touch the checkout, mirroring an operator install of server/deploy/**.

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/proliferate-smoke.XXXXXX")"
STACK_DIR="$WORK_DIR/deploy"
BIN_DIR="$WORK_DIR/bin"

cp -R "$DEPLOY_DIR" "$STACK_DIR"
mkdir -p "$BIN_DIR"

# Drop any env state copied from a previously bootstrapped checkout.
find "$STACK_DIR" -maxdepth 1 -name ".env*" ! -name ".env.production.example" -exec rm -f {} +

OVERRIDE_FILE="$STACK_DIR/smoke/docker-compose.smoke.yml"
RUNTIME_ENV_FILE="$STACK_DIR/.env.runtime"

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

compose_stack() {
  docker compose \
    --env-file "$RUNTIME_ENV_FILE" \
    -f "$STACK_DIR/docker-compose.production.yml" \
    -f "$OVERRIDE_FILE" \
    "$@"
}

cleanup() {
  local exit_code=$?
  trap - EXIT

  if (( exit_code != 0 )); then
    log "Smoke failed; dumping stack logs."
    docker compose -p "$COMPOSE_PROJECT_NAME" logs --no-color --tail=200 >&2 || true
  fi

  if [[ "$KEEP_STACK" == "true" || "$KEEP_STACK" == "1" ]]; then
    log "PROLIFERATE_SMOKE_KEEP_STACK set; stack '$COMPOSE_PROJECT_NAME' and $WORK_DIR left in place."
  else
    docker compose -p "$COMPOSE_PROJECT_NAME" down --volumes --remove-orphans >/dev/null 2>&1 || true
    rm -rf "$WORK_DIR"
  fi

  exit "$exit_code"
}
trap cleanup EXIT

# Operator flow: .env.static is the reviewed copy of the example; the
# smoke-specific values ride the .env.local override channel ensure-secrets.sh
# already honors. The http:// site address keeps Caddy from provisioning
# certificates, so the stack boots without DNS while still proxying through
# the production Caddyfile.
cp "$STACK_DIR/.env.production.example" "$STACK_DIR/.env.static"
cat >"$STACK_DIR/.env.local" <<EOF
# Smoke overrides (generated by run-smoke.sh).
SITE_ADDRESS=http://localhost
PROLIFERATE_PUBLIC_HEALTHCHECK_URL=http://localhost:${HTTP_PORT}/health
PROLIFERATE_SERVER_IMAGE=${IMAGE_REPOSITORY}
PROLIFERATE_SERVER_IMAGE_TAG=${IMAGE_TAG}
PROLIFERATE_HOST_BIN_DIR=${BIN_DIR}
PROLIFERATE_SMOKE_HTTP_PORT=${HTTP_PORT}
PROLIFERATE_SMOKE_API_PORT=${API_PORT}
PROLIFERATE_ANONYMOUS_TELEMETRY_DISABLED=true
EOF

# --- Bootstrap (secrets, migrate, boot, health gate) -------------------------

log "Bootstrapping stack (project: $COMPOSE_PROJECT_NAME, image: $SMOKE_IMAGE)"
PROLIFERATE_COMPOSE_OVERRIDE_FILE="$OVERRIDE_FILE" \
  PROLIFERATE_HEALTHCHECK_URL="http://127.0.0.1:${API_PORT}/health" \
  "$STACK_DIR/bootstrap.sh"

# --- Assertion helpers --------------------------------------------------------

LAST_RESPONSE_BODY=""
LAST_RESPONSE_STATUS=""

assert_http_200() {
  local label="$1"
  local url="$2"
  local status
  local body_file="$WORK_DIR/response.body"

  status="$(curl -sS -o "$body_file" -w '%{http_code}' "$url" || true)"
  if [[ "$status" != "200" ]]; then
    fail "$label: expected HTTP 200 from $url, got ${status:-no response} $(cat "$body_file" 2>/dev/null || true)"
  fi
  LAST_RESPONSE_BODY="$(cat "$body_file")"
  log "PASS  $label: GET $url -> 200 $LAST_RESPONSE_BODY"
}

# http_call <method> <url> [curl args...]: captures status + body into
# LAST_RESPONSE_STATUS / LAST_RESPONSE_BODY without failing the script, so
# callers can assert and report the failing body.
http_call() {
  local method="$1"
  local url="$2"
  shift 2
  local body_file="$WORK_DIR/response.body"

  LAST_RESPONSE_STATUS="$(curl -sS -o "$body_file" -w '%{http_code}' \
    -X "$method" "$@" "$url" || true)"
  LAST_RESPONSE_BODY="$(cat "$body_file" 2>/dev/null || true)"
}

assert_status() {
  local label="$1"
  local expected="$2"

  if [[ "$LAST_RESPONSE_STATUS" != "$expected" ]]; then
    fail "$label: expected HTTP $expected, got ${LAST_RESPONSE_STATUS:-no response}; body: $LAST_RESPONSE_BODY"
  fi
  log "PASS  $label -> $expected"
}

# Run python3 for JSON assertions: host python3 when available, otherwise the
# interpreter inside the api container (the server image is python-based), so
# the host needs nothing beyond Docker and curl.
json_python() {
  if command -v python3 >/dev/null 2>&1; then
    python3 "$@"
  else
    compose_stack exec -T api python3 "$@"
  fi
}

# json_get <dot.path> reads JSON on stdin and prints the value at the path
# (scalars raw, booleans as true/false, objects/arrays as JSON, empty when the
# path is absent).
json_get() {
  json_python -c '
import json
import sys

try:
    value = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for part in sys.argv[1].split("."):
    if isinstance(value, list) and part.lstrip("-").isdigit():
        index = int(part)
        if -len(value) <= index < len(value):
            value = value[index]
        else:
            sys.exit(0)
    elif isinstance(value, dict) and part in value:
        value = value[part]
    else:
        sys.exit(0)
if value is None:
    sys.exit(0)
if isinstance(value, bool):
    print("true" if value else "false", end="")
elif isinstance(value, (dict, list)):
    print(json.dumps(value), end="")
else:
    print(value, end="")
' "$1"
}

assert_migrations_applied() {
  local db_user db_name versions

  db_user="$(read_env_value "$RUNTIME_ENV_FILE" POSTGRES_USER)"
  db_name="$(read_env_value "$RUNTIME_ENV_FILE" POSTGRES_DB)"
  versions="$(compose_stack exec -T db psql -U "${db_user:-proliferate}" \
    -d "${db_name:-proliferate}" -tAc "select count(*) from alembic_version")" \
    || fail "migrations: could not query alembic_version"
  if [[ ! "$versions" =~ ^[1-9] ]]; then
    fail "migrations: alembic_version is empty; migrate did not run"
  fi
  log "PASS  migrations applied (alembic_version populated)"
}

# Assert that <email> appears as an active member in the members response on
# stdin (LAST_RESPONSE_BODY from GET /v1/organizations/{id}/members).
assert_active_member() {
  local email="$1"

  json_python -c '
import json
import sys

email = sys.argv[1]
members = json.load(sys.stdin).get("members", [])
for member in members:
    if member.get("email") == email and member.get("status") == "active":
        sys.exit(0)
sys.exit(1)
' "$email" <<<"$LAST_RESPONSE_BODY" \
    || fail "no active membership for $email in members response: $LAST_RESPONSE_BODY"
  log "PASS  $email is an active member of the instance organization"
}

# Assert the authenticated user belongs to exactly one organization with an
# active membership, and echo that organization id.
assert_single_active_org() {
  local label="$1"
  local access_token="$2"
  local base_url="$3"
  local org_id membership_status second_org

  http_call GET "$base_url/v1/organizations" \
    -H "Authorization: Bearer $access_token"
  assert_status "GET /v1/organizations ($label)" 200

  org_id="$(json_get organizations.0.id <<<"$LAST_RESPONSE_BODY")"
  second_org="$(json_get organizations.1.id <<<"$LAST_RESPONSE_BODY")"
  membership_status="$(json_get organizations.0.membership.status <<<"$LAST_RESPONSE_BODY")"

  if [[ -z "$org_id" ]]; then
    fail "$label: expected membership in one organization, got none; body: $LAST_RESPONSE_BODY"
  fi
  if [[ -n "$second_org" ]]; then
    fail "$label: expected membership in exactly one organization, got more; body: $LAST_RESPONSE_BODY"
  fi
  if [[ "$membership_status" != "active" ]]; then
    fail "$label: expected an active membership, got '${membership_status:-<empty>}'; body: $LAST_RESPONSE_BODY"
  fi
  log "PASS  $label belongs to exactly one organization ($org_id, active)"
  SINGLE_ACTIVE_ORG_ID="$org_id"
}

# desktop_password_login <label> <email> <password> <base_url>: logs in and
# leaves the access token in DESKTOP_ACCESS_TOKEN.
desktop_password_login() {
  local label="$1"
  local email="$2"
  local password="$3"
  local base_url="$4"

  http_call POST "$base_url/auth/desktop/password/login" \
    -H 'Content-Type: application/json' \
    --data "$(printf '{"email":"%s","password":"%s"}' "$email" "$password")"
  assert_status "POST /auth/desktop/password/login ($label)" 200
  DESKTOP_ACCESS_TOKEN="$(json_get access_token <<<"$LAST_RESPONSE_BODY")"
  if [[ -z "$DESKTOP_ACCESS_TOKEN" ]]; then
    fail "$label login response carries no access_token: $LAST_RESPONSE_BODY"
  fi
}

# --- Phase 1: boot, migrate, health -------------------------------------------

phase_health() {
  assert_http_200 "health via Caddy (http-only)" "http://localhost:${HTTP_PORT}/health"
  if [[ "$LAST_RESPONSE_BODY" != *'"status":"ok"'* ]]; then
    fail "health body missing status ok: $LAST_RESPONSE_BODY"
  fi
  assert_http_200 "health direct from API" "http://127.0.0.1:${API_PORT}/health"
  assert_migrations_applied
}

# --- Phase 2: the first-run operator journey -----------------------------------
# Everything goes through the production proxy path (Caddy on $HTTP_PORT),
# exactly like an operator's browser and desktop app would.

phase_journey() {
  local base_url="http://localhost:${HTTP_PORT}"
  local server_version setup_token password_login_enabled
  local admin_token invitee_token org_id
  local invitation_status invitation_token register_payload registered_org

  # (a) /meta reports a real server version, not the old 0.1.0 hardcode.
  http_call GET "$base_url/meta"
  assert_status "GET /meta" 200
  server_version="$(json_get serverVersion <<<"$LAST_RESPONSE_BODY")"
  if [[ -z "$server_version" || "$server_version" == "0.1.0" ]]; then
    fail "GET /meta: expected a real serverVersion, got '${server_version:-<empty>}'; body: $LAST_RESPONSE_BODY"
  fi
  log "PASS  GET /meta serverVersion=$server_version"

  # (b) Read the first-run setup token from the setup_state volume.
  setup_token="$(compose_stack exec -T api cat "$SETUP_TOKEN_PATH" 2>/dev/null \
    | tr -d '[:space:]' || true)"
  if [[ -z "$setup_token" ]]; then
    fail "could not read the setup token from the api container at $SETUP_TOKEN_PATH"
  fi
  log "PASS  setup token read from the setup_state volume"

  # (c) Claim the instance through the server-rendered /setup form.
  http_call GET "$base_url/setup"
  assert_status "GET /setup (unclaimed)" 200
  http_call POST "$base_url/setup" \
    --data-urlencode "email=$SMOKE_ADMIN_EMAIL" \
    --data-urlencode "password=$SMOKE_PASSWORD" \
    --data-urlencode "setup_token=$setup_token"
  assert_status "POST /setup (claim)" 200
  if [[ "$LAST_RESPONSE_BODY" != *"You are all set"* ]]; then
    fail "claim response is not the setup success page: $LAST_RESPONSE_BODY"
  fi
  http_call GET "$base_url/setup"
  assert_status "GET /setup (after claim)" 404

  # (d) Desktop auth methods advertise password login; the claimed admin logs in.
  http_call GET "$base_url/auth/desktop/methods"
  assert_status "GET /auth/desktop/methods" 200
  password_login_enabled="$(json_get password_login <<<"$LAST_RESPONSE_BODY")"
  if [[ "$password_login_enabled" != "true" ]]; then
    fail "auth methods probe does not advertise password login: $LAST_RESPONSE_BODY"
  fi
  desktop_password_login "admin" "$SMOKE_ADMIN_EMAIL" "$SMOKE_PASSWORD" "$base_url"
  admin_token="$DESKTOP_ACCESS_TOKEN"

  # (e) The admin invites a second email into the instance organization.
  assert_single_active_org "admin" "$admin_token" "$base_url"
  org_id="$SINGLE_ACTIVE_ORG_ID"
  http_call POST "$base_url/v1/organizations/$org_id/invitations" \
    -H "Authorization: Bearer $admin_token" \
    -H 'Content-Type: application/json' \
    --data "$(printf '{"email":"%s","role":"member"}' "$SMOKE_INVITEE_EMAIL")"
  assert_status "POST /v1/organizations/$org_id/invitations" 201
  invitation_status="$(json_get status <<<"$LAST_RESPONSE_BODY")"
  if [[ "$invitation_status" != "pending" ]]; then
    fail "expected a pending invitation, got status '${invitation_status:-<empty>}'; body: $LAST_RESPONSE_BODY"
  fi
  # Registration requires proof of invitation: the invitation id doubles as
  # the registration token the inviting admin shares. Prefer an explicit token
  # field if a future response ever adds one, then fall back to the id.
  invitation_token="$(json_get token <<<"$LAST_RESPONSE_BODY")"
  if [[ -z "$invitation_token" ]]; then
    invitation_token="$(json_get invitationToken <<<"$LAST_RESPONSE_BODY")"
  fi
  if [[ -z "$invitation_token" ]]; then
    invitation_token="$(json_get registrationToken <<<"$LAST_RESPONSE_BODY")"
  fi
  if [[ -z "$invitation_token" ]]; then
    invitation_token="$(json_get id <<<"$LAST_RESPONSE_BODY")"
  fi
  if [[ -z "$invitation_token" ]]; then
    fail "invitation response carries no registration token or id: $LAST_RESPONSE_BODY"
  fi

  # (f) The invitee self-registers through invite-as-allowlist.
  register_payload="$(printf '{"email":"%s","password":"%s"}' \
    "$SMOKE_INVITEE_EMAIL" "$SMOKE_PASSWORD")"
  if [[ -n "$invitation_token" ]]; then
    # Send the token under both spellings; the API ignores unknown fields, so
    # this stays compatible with the pre-token registration payload too.
    register_payload="$(printf '{"email":"%s","password":"%s","invitationToken":"%s","invitation_token":"%s"}' \
      "$SMOKE_INVITEE_EMAIL" "$SMOKE_PASSWORD" "$invitation_token" "$invitation_token")"
    log "invitation response carries a registration token; sending it with registration"
  fi
  http_call POST "$base_url/auth/password/register" \
    -H 'Content-Type: application/json' \
    --data "$register_payload"
  assert_status "POST /auth/password/register (invitee)" 201
  registered_org="$(json_get organizationName <<<"$LAST_RESPONSE_BODY")"
  if [[ -z "$registered_org" ]]; then
    fail "registration response carries no organizationName: $LAST_RESPONSE_BODY"
  fi

  # (g) Both users are active members of exactly the one instance organization.
  desktop_password_login "invitee" "$SMOKE_INVITEE_EMAIL" "$SMOKE_PASSWORD" "$base_url"
  invitee_token="$DESKTOP_ACCESS_TOKEN"
  assert_single_active_org "invitee" "$invitee_token" "$base_url"
  if [[ "$SINGLE_ACTIVE_ORG_ID" != "$org_id" ]]; then
    fail "invitee joined organization $SINGLE_ACTIVE_ORG_ID instead of the instance organization $org_id"
  fi
  http_call GET "$base_url/v1/organizations/$org_id/members" \
    -H "Authorization: Bearer $admin_token"
  assert_status "GET /v1/organizations/$org_id/members" 200
  assert_active_member "$SMOKE_ADMIN_EMAIL"
  assert_active_member "$SMOKE_INVITEE_EMAIL"
}

phase_health

if [[ "$SMOKE_PHASE" == "1" ]]; then
  log "SMOKE_PHASE=1 set; skipping the claim/login/invite journey."
  log "SMOKE OK: production compose stack booted, migrated, and serves /health."
  exit 0
fi

phase_journey

log "SMOKE OK: boot, migrate, health, /meta, claim, login, invite, register, and membership checks all passed."
