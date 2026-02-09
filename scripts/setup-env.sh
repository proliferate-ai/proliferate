#!/usr/bin/env bash
# setup-env.sh — Generate a .env file with random secrets for self-hosting.
#
# Usage:
#   ./scripts/setup-env.sh          # Creates .env from .env.example
#   ./scripts/setup-env.sh --force  # Overwrites existing .env

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

ENV_EXAMPLE="$ROOT_DIR/.env.example"
ENV_FILE="$ROOT_DIR/.env"

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

generate_hex() {
  local length="${1:-32}"
  if command -v openssl &>/dev/null; then
    openssl rand -hex "$length"
  else
    head -c "$length" /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c "$((length * 2))"
  fi
}

replace_env() {
  local key="$1" value="$2"
  # Match KEY= or KEY=<anything> (no quotes or with quotes) and replace the value.
  # Uses | as sed delimiter to avoid conflicts with base64/hex chars.
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
    rm -f "$ENV_FILE.bak"
  fi
}

# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

if [ ! -f "$ENV_EXAMPLE" ]; then
  echo "Error: .env.example not found at $ENV_EXAMPLE"
  exit 1
fi

if [ -f "$ENV_FILE" ] && [ "${1:-}" != "--force" ]; then
  echo ".env already exists. Use --force to overwrite."
  exit 0
fi

cp "$ENV_EXAMPLE" "$ENV_FILE"
echo "Created .env from .env.example"
echo ""

# Generate secrets
SECRETS_GENERATED=()

for key in BETTER_AUTH_SECRET SERVICE_TO_SERVICE_AUTH_TOKEN GATEWAY_JWT_SECRET GITHUB_APP_WEBHOOK_SECRET; do
  value=$(generate_hex 32)
  replace_env "$key" "$value"
  SECRETS_GENERATED+=("$key")
done

# USER_SECRETS_ENCRYPTION_KEY needs 64 hex chars (32 bytes)
key="USER_SECRETS_ENCRYPTION_KEY"
value=$(generate_hex 32)
replace_env "$key" "$value"
SECRETS_GENERATED+=("$key")

echo "Generated random values for:"
for s in "${SECRETS_GENERATED[@]}"; do
  echo "  - $s"
done

echo ""
echo "Next steps:"
echo "  1. Set ANTHROPIC_API_KEY in .env (from console.anthropic.com)"
echo "  2. Set up a sandbox provider (Modal or E2B) — see README Step 3"
echo "  3. Create a GitHub App and set NEXT_PUBLIC_GITHUB_APP_SLUG — see README Step 2"
echo "     The slug must match your GitHub App's URL name exactly."
echo "  4. Run: docker compose up -d"
