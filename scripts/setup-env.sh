#!/usr/bin/env bash
# setup-env.sh — Generate a .env file with random secrets for self-hosting.
#
# Usage:
#   ./scripts/setup-env.sh          # Creates .env or fills missing secrets
#   ./scripts/setup-env.sh --force  # Overwrites existing .env from scratch

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

ENV_EXAMPLE="$ROOT_DIR/.env.example"
ENV_FILE="$ROOT_DIR/.env"

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

generate_hex() {
  local bytes="${1:-32}"
  openssl rand -hex "$bytes"
}

# Returns true if the key is missing or has an empty value in the .env file.
is_empty() {
  local key="$1"
  local line
  line=$(grep "^${key}=" "$ENV_FILE" 2>/dev/null || true)
  if [ -z "$line" ]; then
    return 0 # key not present at all
  fi
  local value="${line#*=}"
  # Strip inline comments (e.g. "KEY=   # comment")
  value="${value%%#*}"
  # Trim whitespace
  value="$(printf '%s' "$value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  [ -z "$value" ]
}

replace_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
    rm -f "$ENV_FILE.bak"
  else
    # Key missing from file — append it
    echo "${key}=${value}" >> "$ENV_FILE"
  fi
}

# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

if [ ! -f "$ENV_EXAMPLE" ]; then
  echo "Error: .env.example not found at $ENV_EXAMPLE"
  exit 1
fi

if [ "${1:-}" = "--force" ] || [ ! -f "$ENV_FILE" ]; then
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  echo "Created .env from .env.example"
else
  echo ".env already exists — checking for missing secrets..."
fi
echo ""

# Generate secrets for any that are empty or missing
SECRET_KEYS=(BETTER_AUTH_SECRET SERVICE_TO_SERVICE_AUTH_TOKEN GATEWAY_JWT_SECRET GITHUB_APP_WEBHOOK_SECRET USER_SECRETS_ENCRYPTION_KEY)
SECRETS_GENERATED=()

for key in "${SECRET_KEYS[@]}"; do
  if is_empty "$key"; then
    value=$(generate_hex 32)
    replace_env "$key" "$value"
    SECRETS_GENERATED+=("$key")
  fi
done

if [ ${#SECRETS_GENERATED[@]} -eq 0 ]; then
  echo "All secrets are already set."
else
  echo "Generated random values for:"
  for s in "${SECRETS_GENERATED[@]}"; do
    echo "  - $s"
  done
fi

echo ""
echo "Next steps:"
echo "  1. Set ANTHROPIC_API_KEY in .env (from console.anthropic.com)"
echo "  2. Set up a sandbox provider (Modal or E2B) — see README Step 3"
echo "  3. Create a GitHub App and set NEXT_PUBLIC_GITHUB_APP_SLUG — see README Step 2"
echo "     The slug must match your GitHub App's URL name exactly."
echo "  4. Run: docker compose up -d"
