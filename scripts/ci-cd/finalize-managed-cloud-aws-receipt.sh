#!/usr/bin/env bash
set -euo pipefail

receipt="${RELEASE_E2E_CLOUD_AWS_RECEIPT_PATH:?AWS cleanup receipt path is required}"
shell_pid="${BASHPID:-$$}"
export RELEASE_E2E_CLOUD_AWS_FINALIZER_TEMP_PATH="${receipt}.${shell_pid}.finalize.tmp"

cleanup_finalizer_temp() {
  rm -f -- "${RELEASE_E2E_CLOUD_AWS_FINALIZER_TEMP_PATH}"
}
trap cleanup_finalizer_temp EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "${script_dir}/finalize-managed-cloud-aws-receipt.mjs" \
  "${receipt}" "${RELEASE_E2E_CLOUD_AWS_FINALIZER_TEMP_PATH}"
