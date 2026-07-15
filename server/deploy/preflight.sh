#!/usr/bin/env bash
#
# Configuration preflight for the self-hosted control plane.
#
# Validates the resolved deploy configuration BEFORE bootstrap.sh/update.sh
# pull images or replace running containers, so a dangerous partial config
# fails fast instead of crash-looping the api container and taking a healthy
# instance offline. bootstrap.sh and update.sh call this right after
# ensure-secrets.sh generates .env.runtime and before any `docker compose`
# lifecycle command.
#
# Usage:
#   preflight.sh [ENV_FILE]
#
# ENV_FILE defaults to the generated .env.runtime next to this script, falling
# back to .env.static. Exit status:
#   0  no errors (warnings may have printed)
#   1  one or more errors; the caller must not replace a healthy stack
#
# Env:
#   PROLIFERATE_PREFLIGHT_STRICT=1  treat warnings as errors too.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=server/deploy/common.sh
. "$SCRIPT_DIR/common.sh"

EXAMPLE_ENV_FILE="$SCRIPT_DIR/.env.production.example"
STRICT="${PROLIFERATE_PREFLIGHT_STRICT:-0}"

# Resolve the file to validate: explicit arg, then the generated runtime env,
# then the operator's static env.
ENV_FILE="${1:-}"
if [[ -z "$ENV_FILE" ]]; then
  for candidate in "$SCRIPT_DIR/.env.runtime" "$SCRIPT_DIR/.env.static" "$SCRIPT_DIR/.env"; do
    if [[ -f "$candidate" ]]; then
      ENV_FILE="$candidate"
      break
    fi
  done
fi

if [[ -z "$ENV_FILE" || ! -f "$ENV_FILE" ]]; then
  echo "preflight: no env file to validate (looked for ${1:-.env.runtime/.env.static/.env})." >&2
  exit 1
fi

ERRORS=0
WARNINGS=0

err() {
  ERRORS=$((ERRORS + 1))
  printf 'preflight ERROR: %s\n' "$*" >&2
}

warn() {
  WARNINGS=$((WARNINGS + 1))
  printf 'preflight WARN:  %s\n' "$*" >&2
}

ok() {
  printf 'preflight OK:    %s\n' "$*"
}

get() {
  proliferate_read_env "$ENV_FILE" "$1"
}

# --- 1. Site address ---------------------------------------------------------

SITE_ADDRESS="$(get SITE_ADDRESS)"
USE_SSLIP="$(get PROLIFERATE_USE_SSLIP_FALLBACK)"
if [[ -z "$SITE_ADDRESS" ]] && ! proliferate_is_truthy "$USE_SSLIP"; then
  err "SITE_ADDRESS is empty and PROLIFERATE_USE_SSLIP_FALLBACK is not true. Set a public hostname (Caddy needs it to issue TLS) or enable the sslip evaluation fallback."
elif [[ "$SITE_ADDRESS" == "api.company.com" ]]; then
  warn "SITE_ADDRESS is still the placeholder 'api.company.com'. Set it to your real control-plane hostname before pointing DNS and desktops at it."
else
  ok "SITE_ADDRESS resolved."
fi

# --- 2. E2B pairing (the whole-instance crash-loop guard) --------------------
#
# server/proliferate/main.py::_validate_e2b_template_configuration() raises at
# FastAPI lifespan startup when E2B_API_KEY is set but E2B_TEMPLATE_NAME is
# empty, so a half-configured cloud add-on takes the ENTIRE control plane
# offline (api container restart-loops), not just cloud workspaces. Catch the
# pair here, before we ever restart the api container.

E2B_API_KEY="$(get E2B_API_KEY)"
E2B_TEMPLATE_NAME="$(get E2B_TEMPLATE_NAME)"
if [[ -n "$E2B_API_KEY" && -z "$E2B_TEMPLATE_NAME" ]]; then
  err "E2B_API_KEY is set but E2B_TEMPLATE_NAME is empty. The API validates this pair at startup and will refuse to boot (restart-looping the whole control plane). Set E2B_TEMPLATE_NAME (e.g. your-team/proliferate-runtime-cloud:production) or clear E2B_API_KEY to run without cloud workspaces."
elif [[ -z "$E2B_API_KEY" && -n "$E2B_TEMPLATE_NAME" ]]; then
  warn "E2B_TEMPLATE_NAME is set but E2B_API_KEY is empty. Cloud workspaces stay disabled until both are set."
elif [[ -n "$E2B_API_KEY" && -n "$E2B_TEMPLATE_NAME" ]]; then
  ok "E2B cloud-workspace config is a complete pair."
fi

# --- 3. Agent gateway pairing ------------------------------------------------
#
# The gateway needs its master key to match on both sides, a Postgres password
# for litellm-db, and a public URL sandboxes can reach. A half-configured
# gateway starts but cannot serve model traffic, so warn/error before bringing
# the profiled services up.

if proliferate_is_truthy "$(get AGENT_GATEWAY_ENABLED)"; then
  GATEWAY_ERRORS_BEFORE="$ERRORS"
  GATEWAY_MASTER="$(get AGENT_GATEWAY_LITELLM_MASTER_KEY)"
  LITELLM_MASTER="$(get LITELLM_MASTER_KEY)"
  LITELLM_PG_PW="$(get LITELLM_POSTGRES_PASSWORD)"
  GATEWAY_PUBLIC="$(get AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL)"

  if [[ -z "$LITELLM_MASTER" || -z "$GATEWAY_MASTER" ]]; then
    err "AGENT_GATEWAY_ENABLED=true but LITELLM_MASTER_KEY / AGENT_GATEWAY_LITELLM_MASTER_KEY are not both set. Generate one value (openssl rand -hex 32) and set both to it."
  elif [[ "$LITELLM_MASTER" != "$GATEWAY_MASTER" ]]; then
    err "AGENT_GATEWAY_LITELLM_MASTER_KEY does not equal LITELLM_MASTER_KEY. The control plane authenticates to LiteLLM with this key; they must be identical."
  fi
  if [[ -z "$LITELLM_PG_PW" ]]; then
    err "AGENT_GATEWAY_ENABLED=true but LITELLM_POSTGRES_PASSWORD is empty. The bundled litellm-db needs a password (openssl rand -hex 32)."
  fi
  if [[ -z "$GATEWAY_PUBLIC" ]]; then
    warn "AGENT_GATEWAY_ENABLED=true but AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL is empty. Sandboxes cannot reach the gateway until you set the public URL and expose it (see the model-gateway add-on docs)."
  fi
  if [[ -z "$(get ANTHROPIC_API_KEY)" && -z "$(get OPENAI_API_KEY)" && -z "$(get XAI_API_KEY)" ]]; then
    err "AGENT_GATEWAY_ENABLED=true but none of ANTHROPIC_API_KEY / OPENAI_API_KEY / XAI_API_KEY is set. LiteLLM has no provider credentials to serve models with; set at least one."
  fi
  if [[ "$ERRORS" -eq "$GATEWAY_ERRORS_BEFORE" ]]; then
    ok "Agent gateway config is internally consistent (profile: agent-gateway)."
  fi
fi

# --- 4. Redis for cloud materialization ---------------------------------------
#
# Cloud materialization takes a per-sandbox Redis lock (REDBEAT_REDIS_URL).
# The bundled `redis` service comes up automatically under the cloud-workspaces
# profile whenever the E2B pair (section 2) is complete, so this is a sanity
# check on an operator override rather than a "missing service" case.

if [[ -n "$E2B_API_KEY" && -n "$E2B_TEMPLATE_NAME" ]]; then
  REDIS_URL="$(get REDBEAT_REDIS_URL)"
  if [[ -z "$REDIS_URL" ]]; then
    warn "Cloud workspaces are configured (E2B_API_KEY + E2B_TEMPLATE_NAME) but REDBEAT_REDIS_URL is empty. Cloud materialization cannot acquire its lock without a Redis URL (it will fail requests with cloud_materialization_busy, not crash the instance); leave it at the bundled default (redis://redis:6379/0) or point it at a reachable Redis."
  elif [[ "$REDIS_URL" != *"redis://redis:"* && "$REDIS_URL" != *"@redis:"* ]]; then
    warn "REDBEAT_REDIS_URL ('$REDIS_URL') does not point at the bundled 'redis' service. The cloud-workspaces profile still starts the bundled redis container; confirm your override is reachable, or remove it to use the bundled one."
  else
    ok "Redis is configured for cloud materialization (profile: cloud-workspaces)."
  fi
fi

# --- 5. Deployment SSO (OIDC) completeness ------------------------------------
#
# A usable OIDC connection needs a client id, an issuer/discovery/static
# endpoint source, and a client secret (unless the token-endpoint auth method
# is "none", e.g. a public client). Mirrors
# auth.sso.deployment_config.deployment_sso_configuration_error() so preflight
# catches the same incompleteness before an operator discovers it at sign-in.

if proliferate_is_truthy "$(get SSO_ENABLED)"; then
  SSO_ERRORS_BEFORE="$ERRORS"
  SSO_CLIENT_ID="$(get SSO_OIDC_CLIENT_ID)"
  SSO_CLIENT_SECRET="$(get SSO_OIDC_CLIENT_SECRET)"
  SSO_AUTH_METHOD="$(get SSO_OIDC_TOKEN_ENDPOINT_AUTH_METHOD)"
  SSO_ISSUER="$(get SSO_OIDC_ISSUER_URL)"
  SSO_DISCOVERY="$(get SSO_OIDC_DISCOVERY_URL)"
  SSO_AUTHZ_EP="$(get SSO_OIDC_AUTHORIZATION_ENDPOINT)"
  SSO_TOKEN_EP="$(get SSO_OIDC_TOKEN_ENDPOINT)"
  SSO_JWKS_EP="$(get SSO_OIDC_JWKS_URI)"
  SSO_JIT="$(get SSO_JIT_POLICY)"
  ADMIN_EMAILS_VAL="$(get ADMIN_EMAILS)"

  if [[ -z "$SSO_CLIENT_ID" ]]; then
    err "SSO_ENABLED=true but SSO_OIDC_CLIENT_ID is empty."
  fi
  if [[ -z "$SSO_CLIENT_SECRET" && "$SSO_AUTH_METHOD" != "none" ]]; then
    err "SSO_ENABLED=true but SSO_OIDC_CLIENT_SECRET is empty (required unless SSO_OIDC_TOKEN_ENDPOINT_AUTH_METHOD=none)."
  fi
  if [[ -z "$SSO_ISSUER" && -z "$SSO_DISCOVERY" \
        && ! ( -n "$SSO_AUTHZ_EP" && -n "$SSO_TOKEN_EP" && -n "$SSO_JWKS_EP" ) ]]; then
    err "SSO_ENABLED=true but no endpoint source is set. Set SSO_OIDC_ISSUER_URL or SSO_OIDC_DISCOVERY_URL, or all of SSO_OIDC_AUTHORIZATION_ENDPOINT/SSO_OIDC_TOKEN_ENDPOINT/SSO_OIDC_JWKS_URI."
  fi
  # First-user lockout: a disabled JIT policy rejects every unknown user, so
  # with no ADMIN_EMAILS floor and (by definition, at first boot) no
  # pre-provisioned user, nobody can complete a first SSO login.
  if [[ "${SSO_JIT:-disabled}" == "disabled" && -z "$ADMIN_EMAILS_VAL" ]]; then
    warn "SSO_ENABLED=true with SSO_JIT_POLICY=disabled (the default) and ADMIN_EMAILS empty. No SSO sign-in can create the first user; either set ADMIN_EMAILS so an admin can sign in with password first, or set SSO_JIT_POLICY=create_member."
  fi
  if [[ "$ERRORS" -eq "$SSO_ERRORS_BEFORE" ]]; then
    ok "SSO OIDC config is complete."
  fi
fi

# --- 6. GitHub sign-in (OAuth) partial config ---------------------------------

GITHUB_OAUTH_ID="$(get GITHUB_OAUTH_CLIENT_ID)"
GITHUB_OAUTH_SECRET="$(get GITHUB_OAUTH_CLIENT_SECRET)"
if [[ -n "$GITHUB_OAUTH_ID" && -z "$GITHUB_OAUTH_SECRET" ]]; then
  warn "GITHUB_OAUTH_CLIENT_ID is set but GITHUB_OAUTH_CLIENT_SECRET is empty. GitHub sign-in stays unavailable until both are set."
elif [[ -z "$GITHUB_OAUTH_ID" && -n "$GITHUB_OAUTH_SECRET" ]]; then
  warn "GITHUB_OAUTH_CLIENT_SECRET is set but GITHUB_OAUTH_CLIENT_ID is empty. GitHub sign-in stays unavailable until both are set."
elif [[ -n "$GITHUB_OAUTH_ID" && -n "$GITHUB_OAUTH_SECRET" ]]; then
  ok "GitHub OAuth sign-in config is a complete pair."
fi

# --- 7. GitHub App (cloud repo access) partial config -------------------------
#
# Distinct credential set from GitHub OAuth sign-in above. Not required for
# the base install or for cloud workspaces themselves (E2B is what gates
# workspace creation); flagged here only so a half-entered App config does not
# silently fail to authorize repos later.

GITHUB_APP_ID_VAL="$(get GITHUB_APP_ID)"
if [[ -n "$GITHUB_APP_ID_VAL" ]]; then
  GITHUB_APP_CLIENT_ID_VAL="$(get GITHUB_APP_CLIENT_ID)"
  GITHUB_APP_CLIENT_SECRET_VAL="$(get GITHUB_APP_CLIENT_SECRET)"
  GITHUB_APP_WEBHOOK_SECRET_VAL="$(get GITHUB_APP_WEBHOOK_SECRET)"
  GITHUB_APP_KEY_INLINE="$(get GITHUB_APP_PRIVATE_KEY)"
  GITHUB_APP_KEY_PATH="$(get GITHUB_APP_PRIVATE_KEY_PATH)"
  if [[ -z "$GITHUB_APP_CLIENT_ID_VAL" || -z "$GITHUB_APP_CLIENT_SECRET_VAL" || -z "$GITHUB_APP_WEBHOOK_SECRET_VAL" ]]; then
    warn "GITHUB_APP_ID is set but one of GITHUB_APP_CLIENT_ID / GITHUB_APP_CLIENT_SECRET / GITHUB_APP_WEBHOOK_SECRET is empty. Set all of them together to use the GitHub App."
  fi
  if [[ -z "$GITHUB_APP_KEY_INLINE" && -z "$GITHUB_APP_KEY_PATH" ]]; then
    warn "GITHUB_APP_ID is set but neither GITHUB_APP_PRIVATE_KEY nor GITHUB_APP_PRIVATE_KEY_PATH is set. The App needs its private key to authenticate."
  elif [[ -n "$GITHUB_APP_KEY_INLINE" && -n "$GITHUB_APP_KEY_PATH" ]]; then
    warn "Both GITHUB_APP_PRIVATE_KEY and GITHUB_APP_PRIVATE_KEY_PATH are set; only one form is needed (inline takes precedence)."
  fi
fi

# --- 8. Runtime binaries for cloud workspaces --------------------------------
#
# install-runtime.sh fails when a CLOUD_*_SOURCE_BINARY_PATH points at a missing
# file and no RUNTIME_BINARY_URL is set to fetch it. Surface that here rather
# than as a mid-bootstrap failure.

RUNTIME_URL="$(get RUNTIME_BINARY_URL)"
for var in CLOUD_RUNTIME_SOURCE_BINARY_PATH CLOUD_WORKER_SOURCE_BINARY_PATH CLOUD_SUPERVISOR_SOURCE_BINARY_PATH; do
  path="$(get "$var")"
  if [[ -n "$path" && ! -x "$path" && -z "$RUNTIME_URL" ]]; then
    err "$var=$path but that file is missing/not executable and RUNTIME_BINARY_URL is not set. Place the Linux runtime bundle on the host or set RUNTIME_BINARY_URL so install-runtime.sh can fetch it."
  fi
done

# --- 9. Unknown / likely-typo keys -------------------------------------------
#
# Compare the operator's env keys against the shipped example schema plus the
# small set of generated/managed keys the scripts add. An unknown key is
# usually a typo (a real setting that silently does nothing), so warn.

known_keys_file="$(mktemp)"
trap 'rm -f "$known_keys_file"' EXIT
{
  if [[ -f "$EXAMPLE_ENV_FILE" ]]; then
    grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' "$EXAMPLE_ENV_FILE" | sed 's/=$//'
  fi
  # Keys the deploy scripts / AWS stack manage, or advanced overrides
  # documented in env-vars.yaml, that are not in the shipped example.
  cat <<'MANAGED'
DATABASE_URL
API_BASE_URL
PROLIFERATE_USE_SSLIP_FALLBACK
LITELLM_POSTGRES_DB
LITELLM_POSTGRES_USER
PROLIFERATE_LITELLM_IMAGE
PROLIFERATE_LITELLM_IMAGE_TAG
SSO_OIDC_AUTHORIZATION_ENDPOINT
SSO_OIDC_TOKEN_ENDPOINT
SSO_OIDC_JWKS_URI
SSO_OIDC_USERINFO_ENDPOINT
SSO_OIDC_TOKEN_ENDPOINT_AUTH_METHOD
SSO_OIDC_CALLBACK_BASE_URL
SSO_PROTOCOL
SSO_DISPLAY_NAME
SSO_LOGIN_POLICY
SSO_OIDC_SCOPES
MANAGED
} | sort -u >"$known_keys_file"

while IFS= read -r key; do
  [[ -n "$key" ]] || continue
  if ! grep -qxF "$key" "$known_keys_file"; then
    warn "Unknown config key '$key' in $(basename "$ENV_FILE"). If this is not an advanced override from env-vars.yaml, it may be a typo (the server ignores unknown keys)."
  fi
done < <(grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" | sed 's/=$//' | sort -u)

# --- 10. Duplicate keys -------------------------------------------------------

dupes="$(grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" | sed 's/=$//' | sort | uniq -d || true)"
if [[ -n "$dupes" ]]; then
  while IFS= read -r key; do
    [[ -n "$key" ]] || continue
    warn "Duplicate key '$key' in $(basename "$ENV_FILE"). Only the first value is read; remove the extras."
  done <<<"$dupes"
fi

# --- Summary -----------------------------------------------------------------

if [[ "$STRICT" == "1" && "$WARNINGS" -gt 0 ]]; then
  ERRORS=$((ERRORS + WARNINGS))
fi

if [[ "$ERRORS" -gt 0 ]]; then
  printf 'preflight: %d error(s), %d warning(s). Refusing to continue.\n' "$ERRORS" "$WARNINGS" >&2
  exit 1
fi

printf 'preflight: passed (%d warning(s)).\n' "$WARNINGS"
exit 0
