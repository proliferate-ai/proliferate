#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATIC_ENV_FILE="${PROLIFERATE_STATIC_ENV_FILE:-$SCRIPT_DIR/.env.static}"
LOCAL_ENV_FILE="${PROLIFERATE_LOCAL_ENV_FILE:-$SCRIPT_DIR/.env.local}"
LEGACY_ENV_FILE="$SCRIPT_DIR/.env"
GENERATED_ENV_FILE="${PROLIFERATE_GENERATED_ENV_FILE:-$SCRIPT_DIR/.env.generated}"
RUNTIME_ENV_FILE="${PROLIFERATE_ENV_FILE:-$SCRIPT_DIR/.env.runtime}"

if [[ ! -f "$STATIC_ENV_FILE" && -f "$LEGACY_ENV_FILE" ]]; then
  STATIC_ENV_FILE="$LEGACY_ENV_FILE"
fi

if [[ ! -f "$STATIC_ENV_FILE" ]]; then
  echo "Missing static env file. Create $SCRIPT_DIR/.env.static (or legacy $LEGACY_ENV_FILE) first." >&2
  exit 1
fi

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

read_config_env_value() {
  local key="$1"
  local value

  value="$(read_env_value "$LOCAL_ENV_FILE" "$key")"
  if [[ -n "$value" ]]; then
    printf '%s' "$value"
    return 0
  fi

  read_env_value "$STATIC_ENV_FILE" "$key"
}

copy_unmanaged_env_values() {
  local source_file="$1"
  local override_file="${2:-}"
  local managed_pattern

  if [[ ! -f "$source_file" ]]; then
    return 0
  fi

  managed_pattern="^(POSTGRES_PASSWORD|DATABASE_URL|JWT_SECRET|CLOUD_SECRET_KEY|LITELLM_POSTGRES_PASSWORD|LITELLM_MASTER_KEY|SITE_ADDRESS|API_BASE_URL|PROLIFERATE_PUBLIC_HEALTHCHECK_URL|PROLIFERATE_USE_SSLIP_FALLBACK)$"

  if [[ -n "$override_file" && -f "$override_file" ]]; then
    awk -F= -v managed_pattern="$managed_pattern" '
      FNR == NR {
        if ($0 ~ /^[A-Za-z_][A-Za-z0-9_]*=/) {
          overrides[$1] = 1
        }
        next
      }
      $0 ~ /^[A-Za-z_][A-Za-z0-9_]*=/ {
        if ($1 ~ managed_pattern || $1 in overrides) {
          next
        }
      }
      { print }
    ' "$override_file" "$source_file"
    return 0
  fi

  awk -F= -v managed_pattern="$managed_pattern" '
    $0 ~ /^[A-Za-z_][A-Za-z0-9_]*=/ {
      if ($1 ~ managed_pattern) {
        next
      }
    }
    { print }
  ' "$source_file"
}

resolve_instance_public_ip() {
  local token=""
  local ip=""
  local attempt

  for attempt in $(seq 1 30); do
    token="$(curl -fsS --connect-timeout 1 --max-time 2 -X PUT \
      "http://169.254.169.254/latest/api/token" \
      -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" || true)"

    if [[ -n "$token" ]]; then
      ip="$(curl -fsS --connect-timeout 1 --max-time 2 \
        -H "X-aws-ec2-metadata-token: $token" \
        "http://169.254.169.254/latest/meta-data/public-ipv4" || true)"
    else
      ip="$(curl -fsS --connect-timeout 1 --max-time 2 \
        "http://169.254.169.254/latest/meta-data/public-ipv4" || true)"
    fi

    if [[ -n "$ip" ]]; then
      printf '%s' "$ip"
      return 0
    fi

    sleep 2
  done

  echo "Unable to resolve the instance public IPv4 for sslip fallback." >&2
  exit 1
}

# Compose a URL from SITE_ADDRESS. Operators may set SITE_ADDRESS with or
# without a scheme (Caddy accepts both); Caddy serves https unless the
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

random_hex() {
  local bytes="$1"

  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$bytes"
    return 0
  fi

  python3 - "$bytes" <<'PY'
import secrets
import sys

print(secrets.token_hex(int(sys.argv[1])))
PY
}

resolve_value() {
  local key="$1"
  local generated_value="$2"
  local static_value="$3"
  local random_bytes="$4"

  if [[ -n "$generated_value" ]]; then
    printf '%s' "$generated_value"
    return 0
  fi

  if [[ -n "$static_value" ]]; then
    printf '%s' "$static_value"
    return 0
  fi

  random_hex "$random_bytes"
}

POSTGRES_DB="$(read_config_env_value POSTGRES_DB)"
POSTGRES_USER="$(read_config_env_value POSTGRES_USER)"
POSTGRES_DB="${POSTGRES_DB:-proliferate}"
POSTGRES_USER="${POSTGRES_USER:-proliferate}"
SITE_ADDRESS="$(read_config_env_value SITE_ADDRESS)"
PUBLIC_HEALTHCHECK_URL="$(read_config_env_value PROLIFERATE_PUBLIC_HEALTHCHECK_URL)"
USE_SSLIP_FALLBACK="$(read_config_env_value PROLIFERATE_USE_SSLIP_FALLBACK)"

if [[ -z "$SITE_ADDRESS" && "$USE_SSLIP_FALLBACK" == "true" ]]; then
  SITE_ADDRESS="$(resolve_instance_public_ip).sslip.io"
fi

if [[ -z "$SITE_ADDRESS" ]]; then
  echo "SITE_ADDRESS must be set unless PROLIFERATE_USE_SSLIP_FALLBACK=true." >&2
  exit 1
fi

if [[ -z "$PUBLIC_HEALTHCHECK_URL" ]]; then
  PUBLIC_HEALTHCHECK_URL="$(site_url_from_address "$SITE_ADDRESS" /health)"
fi

# The server embeds API_BASE_URL in configuration it pushes to workspaces.
# Operators can set it explicitly; otherwise derive it from SITE_ADDRESS so
# the sslip fallback (where SITE_ADDRESS is resolved at runtime) works too.
API_BASE_URL="$(read_config_env_value API_BASE_URL)"
if [[ -z "$API_BASE_URL" ]]; then
  API_BASE_URL="$(site_url_from_address "$SITE_ADDRESS" "")"
fi

POSTGRES_PASSWORD="$(resolve_value \
  POSTGRES_PASSWORD \
  "$(read_env_value "$GENERATED_ENV_FILE" POSTGRES_PASSWORD)" \
  "$(read_config_env_value POSTGRES_PASSWORD)" \
  24)"
JWT_SECRET="$(resolve_value \
  JWT_SECRET \
  "$(read_env_value "$GENERATED_ENV_FILE" JWT_SECRET)" \
  "$(read_config_env_value JWT_SECRET)" \
  32)"
CLOUD_SECRET_KEY="$(resolve_value \
  CLOUD_SECRET_KEY \
  "$(read_env_value "$GENERATED_ENV_FILE" CLOUD_SECRET_KEY)" \
  "$(read_config_env_value CLOUD_SECRET_KEY)" \
  32)"
LITELLM_POSTGRES_PASSWORD="$(resolve_value \
  LITELLM_POSTGRES_PASSWORD \
  "$(read_env_value "$GENERATED_ENV_FILE" LITELLM_POSTGRES_PASSWORD)" \
  "$(read_config_env_value LITELLM_POSTGRES_PASSWORD)" \
  24)"
LITELLM_MASTER_KEY="$(resolve_value \
  LITELLM_MASTER_KEY \
  "$(read_env_value "$GENERATED_ENV_FILE" LITELLM_MASTER_KEY)" \
  "$(read_config_env_value LITELLM_MASTER_KEY)" \
  32)"
cat >"$GENERATED_ENV_FILE" <<EOF
# Generated on first bootstrap. Preserve this file to keep stack-managed secrets stable.
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
JWT_SECRET=$JWT_SECRET
CLOUD_SECRET_KEY=$CLOUD_SECRET_KEY
LITELLM_POSTGRES_PASSWORD=$LITELLM_POSTGRES_PASSWORD
LITELLM_MASTER_KEY=$LITELLM_MASTER_KEY
EOF

{
  printf '# Generated runtime env. Do not edit directly.\n'
  copy_unmanaged_env_values "$STATIC_ENV_FILE" "$LOCAL_ENV_FILE"
  copy_unmanaged_env_values "$LOCAL_ENV_FILE"
  printf 'SITE_ADDRESS=%s\n' "$SITE_ADDRESS"
  printf 'API_BASE_URL=%s\n' "$API_BASE_URL"
  printf 'PROLIFERATE_PUBLIC_HEALTHCHECK_URL=%s\n' "$PUBLIC_HEALTHCHECK_URL"
  printf 'POSTGRES_PASSWORD=%s\n' "$POSTGRES_PASSWORD"
  printf 'DATABASE_URL=postgresql+asyncpg://%s:%s@db:5432/%s\n' "$POSTGRES_USER" "$POSTGRES_PASSWORD" "$POSTGRES_DB"
  printf 'JWT_SECRET=%s\n' "$JWT_SECRET"
  printf 'CLOUD_SECRET_KEY=%s\n' "$CLOUD_SECRET_KEY"
  printf 'LITELLM_POSTGRES_PASSWORD=%s\n' "$LITELLM_POSTGRES_PASSWORD"
  printf 'LITELLM_MASTER_KEY=%s\n' "$LITELLM_MASTER_KEY"
} >"$RUNTIME_ENV_FILE"

chmod 600 "$GENERATED_ENV_FILE" "$RUNTIME_ENV_FILE"
