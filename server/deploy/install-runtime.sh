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

TARGET_PATH="$(read_env_value CLOUD_RUNTIME_SOURCE_BINARY_PATH)"
WORKER_TARGET_PATH="$(read_env_value CLOUD_WORKER_SOURCE_BINARY_PATH)"
SUPERVISOR_TARGET_PATH="$(read_env_value CLOUD_SUPERVISOR_SOURCE_BINARY_PATH)"
RUNTIME_URL="$(read_env_value RUNTIME_BINARY_URL)"
RUNTIME_SHA256="$(read_env_value RUNTIME_BINARY_SHA256)"
RUNTIME_SHA256_URL="$(read_env_value RUNTIME_BINARY_SHA256_URL)"

if [[ -z "$TARGET_PATH" && -z "$WORKER_TARGET_PATH" && -z "$SUPERVISOR_TARGET_PATH" ]]; then
  exit 0
fi

needs_download=0
for requested_path in "$TARGET_PATH" "$WORKER_TARGET_PATH" "$SUPERVISOR_TARGET_PATH"; do
  if [[ -n "$requested_path" && ! -x "$requested_path" ]]; then
    needs_download=1
  fi
done

if [[ "$needs_download" == "0" && -z "$RUNTIME_URL" ]]; then
  exit 0
fi

if [[ -z "$RUNTIME_URL" ]]; then
  echo "Missing one or more runtime bundle binaries and RUNTIME_BINARY_URL is not set." >&2
  exit 1
fi

for requested_path in "$TARGET_PATH" "$WORKER_TARGET_PATH" "$SUPERVISOR_TARGET_PATH"; do
  if [[ -n "$requested_path" ]]; then
    mkdir -p "$(dirname "$requested_path")"
  fi
done

temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT

archive_path="$temp_dir/runtime.tar.gz"
curl -fsSL "$RUNTIME_URL" -o "$archive_path"

if [[ -z "$RUNTIME_SHA256" && -n "$RUNTIME_SHA256_URL" ]]; then
  checksum_path="$temp_dir/SHA256SUMS"
  runtime_filename="$(basename "$RUNTIME_URL")"
  curl -fsSL "$RUNTIME_SHA256_URL" -o "$checksum_path"
  RUNTIME_SHA256="$(
    awk -v filename="$runtime_filename" '$2 == filename { print $1; exit }' "$checksum_path"
  )"

  if [[ -z "$RUNTIME_SHA256" ]]; then
    echo "Checksum file $RUNTIME_SHA256_URL did not contain an entry for $runtime_filename." >&2
    exit 1
  fi
fi

if [[ -n "$RUNTIME_SHA256" ]]; then
  actual_sha256="$(sha256sum "$archive_path" | awk '{print $1}')"
  if [[ "$actual_sha256" != "$RUNTIME_SHA256" ]]; then
    echo "Runtime archive checksum mismatch for $RUNTIME_URL." >&2
    exit 1
  fi
fi

tar xzf "$archive_path" -C "$temp_dir"

if [[ ! -f "$temp_dir/anyharness" ]]; then
  echo "Downloaded runtime archive did not contain an anyharness binary." >&2
  exit 1
fi

install_binary_if_requested() {
  local binary_name="$1"
  local target_path="$2"

  if [[ -z "$target_path" ]]; then
    return 0
  fi
  if [[ ! -f "$temp_dir/$binary_name" ]]; then
    echo "Downloaded runtime archive did not contain a $binary_name binary." >&2
    exit 1
  fi
  install -m 0755 "$temp_dir/$binary_name" "$target_path"
}

install_binary_if_requested anyharness "$TARGET_PATH"
install_binary_if_requested proliferate-worker "$WORKER_TARGET_PATH"
install_binary_if_requested proliferate-supervisor "$SUPERVISOR_TARGET_PATH"
