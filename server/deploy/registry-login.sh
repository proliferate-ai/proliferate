#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${PROLIFERATE_ENV_FILE:-$SCRIPT_DIR/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Generate the runtime env via bootstrap/update first." >&2
  exit 1
fi

read_env_value() {
  local key="$1"
  local line

  line="$(grep -m1 "^${key}=" "$ENV_FILE" || true)"
  if [[ -z "$line" ]]; then
    return 0
  fi

  printf '%s' "${line#*=}"
}

IMAGE_REPOSITORY="$(read_env_value PROLIFERATE_SERVER_IMAGE)"
if [[ -z "$IMAGE_REPOSITORY" ]]; then
  IMAGE_REPOSITORY="ghcr.io/proliferate-ai/proliferate-server"
fi
REGISTRY_HOST="${IMAGE_REPOSITORY%%/*}"

if [[ ! "$REGISTRY_HOST" =~ \.dkr\.ecr\.[^.]+\.amazonaws\.com$ ]]; then
  exit 0
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required to authenticate to private ECR registries." >&2
  exit 1
fi

AWS_REGION_VALUE="$(read_env_value AWS_REGION)"
if [[ -z "$AWS_REGION_VALUE" ]]; then
  echo "AWS_REGION must be set when pulling Proliferate images from private ECR." >&2
  exit 1
fi

aws ecr get-login-password --region "$AWS_REGION_VALUE" \
  | docker login --username AWS --password-stdin "$REGISTRY_HOST"
