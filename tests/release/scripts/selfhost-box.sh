#!/usr/bin/env bash
#
# Provision (and tear down) a fresh, throwaway self-hosted Proliferate control
# plane on EC2 the way an operator does — the production compose bundle
# (server/deploy/**) on a stock Ubuntu box, single-org, sslip.io hostname with
# real Caddy-issued TLS. Used by the T3-SH-1 (cold boot to second user) and
# T4-SH-1 (operator update motion) release-e2e scenarios so each can stand up
# and destroy its own instance, gated behind the RELEASE_E2E_SELFHOST_PROVISION
# opt-in (cost control) in the scenarios themselves.
#
# This mirrors how the standing alpha box was created (hand-run bootstrap.sh on
# Ubuntu 24.04, sslip fallback) rather than the AWS CloudFormation one-click, so
# the deploy bundle under test is the exact one from this checkout — no reliance
# on a published server-v* release asset. The base install pulls only the public
# GHCR server image (:<tag>), postgres, and caddy; the optional runtime-binary
# and gateway add-ons are left off (their own scenarios cover them).
#
# Never touches proliferate-prod*: it creates its own dedicated, clearly tagged
# security group + key pair in the default VPC and deletes them on teardown.
#
# Usage:
#   selfhost-box.sh provision [--tag <image-tag>]
#       Prints a single JSON line to stdout:
#       {"instanceId":"i-..","sgId":"sg-..","keyName":"..","keyPath":"/tmp/..",
#        "publicIp":"..","url":"https://<ip>.sslip.io","sshUser":"ubuntu"}
#       All human-readable progress goes to stderr so stdout stays parseable.
#   selfhost-box.sh terminate --instance-id i-.. --sg-id sg-.. --key-name .. [--key-path ..]
#
# Environment:
#   RELEASE_E2E_SELFHOST_REGION         AWS region (default us-east-1).
#   RELEASE_E2E_SELFHOST_INSTANCE_TYPE  EC2 instance type (default t3.small).
#   RELEASE_E2E_SELFHOST_IMAGE_TAG      Server image tag when --tag is omitted
#                                       (default stable).
#
# Requirements on the host running this: aws CLI (with credentials able to
# run-instances / create the SG + key pair in the default VPC), ssh, scp, curl.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/../../../server/deploy" && pwd)"

REGION="${RELEASE_E2E_SELFHOST_REGION:-us-east-1}"
INSTANCE_TYPE="${RELEASE_E2E_SELFHOST_INSTANCE_TYPE:-t3.small}"
SERVER_IMAGE_REPO="ghcr.io/proliferate-ai/proliferate-server"
SG_DELETE_ATTEMPTS="${SELFHOST_BOX_SG_DELETE_ATTEMPTS:-12}"
RETRY_SLEEP_SECONDS="${SELFHOST_BOX_RETRY_SLEEP_SECONDS:-5}"

[[ "$SG_DELETE_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || {
  printf '[selfhost-box] ERROR: SELFHOST_BOX_SG_DELETE_ATTEMPTS must be a positive integer.\n' >&2
  exit 1
}
[[ "$RETRY_SLEEP_SECONDS" =~ ^[0-9]+$ ]] || {
  printf '[selfhost-box] ERROR: SELFHOST_BOX_RETRY_SLEEP_SECONDS must be a non-negative integer.\n' >&2
  exit 1
}

log() { printf '[selfhost-box] %s\n' "$*" >&2; }
fail() { printf '[selfhost-box] ERROR: %s\n' "$*" >&2; exit 1; }

# Provider stderr is deliberately suppressed. It can contain credential-shaped
# request context, while the operation + non-secret resource identifiers below
# are sufficient to recover a leaked test resource.
aws_quiet() { aws "$@" 2>/dev/null; }

cleanup_resources() {
  local instance_id="$1" sg_id="$2" sg_name="$3" key_name="$4" key_path="$5"
  local -a failures=()

  if [[ -n "$instance_id" ]]; then
    log "terminating instance $instance_id"
    if ! aws_quiet ec2 terminate-instances --region "$REGION" --instance-ids "$instance_id" >/dev/null; then
      failures+=("terminate-instances(instance=$instance_id)")
    fi
    if ! aws_quiet ec2 wait instance-terminated --region "$REGION" --instance-ids "$instance_id"; then
      failures+=("wait-instance-terminated(instance=$instance_id)")
    fi
  fi

  if [[ -n "$sg_id" || -n "$sg_name" ]]; then
    local sg_label sg_deleted=0 attempt
    local -a sg_args
    if [[ -n "$sg_id" ]]; then
      sg_label="$sg_id"
      sg_args=(--group-id "$sg_id")
    else
      sg_label="name:$sg_name"
      sg_args=(--group-name "$sg_name")
    fi
    log "deleting security group $sg_label"
    # ENI detach after termination can lag. Exhaustion is a cleanup failure,
    # never a successful teardown.
    for ((attempt = 1; attempt <= SG_DELETE_ATTEMPTS; attempt += 1)); do
      if aws_quiet ec2 delete-security-group --region "$REGION" "${sg_args[@]}" >/dev/null; then
        sg_deleted=1
        break
      fi
      if ((attempt < SG_DELETE_ATTEMPTS)); then
        sleep "$RETRY_SLEEP_SECONDS"
      fi
    done
    if ((sg_deleted == 0)); then
      failures+=("delete-security-group(security-group=$sg_label, exhausted=$SG_DELETE_ATTEMPTS)")
    fi
  fi

  if [[ -n "$key_name" ]]; then
    log "deleting key pair $key_name"
    if ! aws_quiet ec2 delete-key-pair --region "$REGION" --key-name "$key_name" >/dev/null; then
      failures+=("delete-key-pair(key-pair=$key_name)")
    fi
  fi
  if [[ -n "$key_path" && -e "$key_path" ]] && ! rm -f "$key_path"; then
    failures+=("remove-private-key-file(path=$key_path)")
  fi

  if ((${#failures[@]} > 0)); then
    local failure
    for failure in "${failures[@]}"; do
      log "cleanup failure: $failure"
    done
    return 1
  fi
}

PROVISION_ACTIVE=0
PROVISION_INSTANCE_ID=""
PROVISION_INSTANCE_CLIENT_TOKEN=""
PROVISION_SG_ID=""
PROVISION_SG_NAME=""
PROVISION_KEY_NAME=""
PROVISION_KEY_PATH=""
PROVISION_USER_DATA_FILE=""

cleanup_partial_provision() {
  ((PROVISION_ACTIVE == 1)) || return 0
  PROVISION_ACTIVE=0
  local cleanup_failed=0
  if [[ -z "$PROVISION_INSTANCE_ID" && -n "$PROVISION_INSTANCE_CLIENT_TOKEN" ]]; then
    local recovered_instance_id=""
    log "resolving partial instance by client token $PROVISION_INSTANCE_CLIENT_TOKEN"
    if recovered_instance_id="$(aws_quiet ec2 describe-instances \
      --region "$REGION" \
      --filters "Name=client-token,Values=$PROVISION_INSTANCE_CLIENT_TOKEN" \
      --query 'Reservations[0].Instances[0].InstanceId' \
      --output text)"; then
      if [[ -n "$recovered_instance_id" && "$recovered_instance_id" != "None" ]]; then
        PROVISION_INSTANCE_ID="$recovered_instance_id"
      fi
    else
      log "cleanup failure: resolve-instance(client-token=$PROVISION_INSTANCE_CLIENT_TOKEN)"
      cleanup_failed=1
    fi
  fi
  log "provision failed; cleaning partial resources instance=${PROVISION_INSTANCE_ID:-none} security-group=${PROVISION_SG_ID:-${PROVISION_SG_NAME:-none}} key-pair=${PROVISION_KEY_NAME:-none}"
  cleanup_resources \
    "$PROVISION_INSTANCE_ID" \
    "$PROVISION_SG_ID" \
    "$PROVISION_SG_NAME" \
    "$PROVISION_KEY_NAME" \
    "$PROVISION_KEY_PATH" || cleanup_failed=1
  if [[ -n "$PROVISION_USER_DATA_FILE" && -e "$PROVISION_USER_DATA_FILE" ]] && ! rm -f "$PROVISION_USER_DATA_FILE"; then
    log "cleanup failure: remove-user-data-file(path=$PROVISION_USER_DATA_FILE)"
    cleanup_failed=1
  fi
  if ((cleanup_failed == 1)); then
    log "partial resource cleanup failed after provision failure"
    return 1
  fi
  log "partial resource cleanup complete after provision failure"
}

provision_error_trap() {
  local status="$1"
  trap - ERR
  if ! cleanup_partial_provision; then
    log "provision remains failed with partial-resource cleanup risk"
  fi
  return "$status"
}

provision_exit_trap() {
  local status="$1" cleanup_failed=0
  trap - ERR EXIT INT TERM
  cleanup_partial_provision || cleanup_failed=1
  if ((status == 0 && cleanup_failed == 1)); then
    status=1
  fi
  exit "$status"
}

command -v aws >/dev/null 2>&1 || fail "aws CLI is required."

provision() {
  PROVISION_ACTIVE=1
  trap 'provision_error_trap "$?"' ERR
  trap 'provision_exit_trap "$?"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  local image_tag="${RELEASE_E2E_SELFHOST_IMAGE_TAG:-stable}"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --tag) image_tag="$2"; shift 2 ;;
      *) fail "unknown provision arg: $1" ;;
    esac
  done

  local suffix ami runner_ip key_name key_path sg_id instance_id instance_client_token public_ip url
  suffix="$(date +%s)-${RANDOM}"
  key_name="selfhost-e2e-${suffix}"
  key_path="${TMPDIR:-/tmp}/${key_name}.pem"
  instance_client_token="selfhost-e2e-${suffix}"

  log "resolving latest Ubuntu 24.04 amd64 AMI in ${REGION}"
  ami="$(aws_quiet ssm get-parameters --region "$REGION" \
    --names /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
    --query 'Parameters[0].Value' --output text)"
  [[ -n "$ami" && "$ami" != "None" ]] || fail "could not resolve Ubuntu 24.04 AMI"
  log "AMI: $ami"

  runner_ip="$(curl -fsS https://checkip.amazonaws.com | tr -d '[:space:]')"
  [[ -n "$runner_ip" ]] || fail "could not resolve this host's public IP for the SSH ingress rule"
  log "authorizing SSH from ${runner_ip}/32"

  log "creating key pair ${key_name}"
  # Record ownership before the mutating call. If the CLI loses its response
  # after AWS created the resource, EXIT cleanup still attempts deletion by
  # the unique requested name.
  PROVISION_KEY_NAME="$key_name"
  PROVISION_KEY_PATH="$key_path"
  aws_quiet ec2 create-key-pair --region "$REGION" --key-name "$key_name" \
    --query 'KeyMaterial' --output text >"$key_path"
  [[ -s "$key_path" ]] || fail "create-key-pair returned empty key material for $key_name"
  chmod 600 "$key_path"

  log "creating security group"
  PROVISION_SG_NAME="$key_name"
  sg_id="$(aws_quiet ec2 create-security-group --region "$REGION" \
    --group-name "$key_name" \
    --description "Proliferate self-host e2e test (throwaway)" \
    --tag-specifications 'ResourceType=security-group,Tags=[{Key=Purpose,Value=self-hosting-e2e-test},{Key=Name,Value=selfhost-e2e}]' \
    --query 'GroupId' --output text)"
  [[ -n "$sg_id" && "$sg_id" != "None" ]] || fail "create-security-group returned no id for $key_name"
  PROVISION_SG_ID="$sg_id"
  PROVISION_SG_NAME=""
  aws_quiet ec2 authorize-security-group-ingress --region "$REGION" --group-id "$sg_id" \
    --ip-permissions \
    "IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}]" \
    "IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}]" \
    "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=${runner_ip}/32}]" >/dev/null

  local user_data_file
  user_data_file="$(mktemp "${TMPDIR:-/tmp}/selfhost-userdata.XXXXXX")"
  PROVISION_USER_DATA_FILE="$user_data_file"
  cat >"$user_data_file" <<'EOF'
#!/bin/bash
set -eux
export DEBIAN_FRONTEND=noninteractive
for i in $(seq 1 30); do apt-get update && break || sleep 5; done
apt-get install -y docker.io curl
if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y docker-compose-v2 || true
fi
if ! docker compose version >/dev/null 2>&1; then
  arch="$(uname -m)"; case "$arch" in aarch64|arm64) ca=aarch64;; *) ca=x86_64;; esac
  mkdir -p /usr/local/lib/docker/cli-plugins
  curl -fsSL "https://github.com/docker/compose/releases/download/v2.39.4/docker-compose-linux-${ca}" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
  chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi
systemctl enable --now docker
usermod -aG docker ubuntu
touch /var/lib/cloud/selfhost-ready
EOF

  log "launching ${INSTANCE_TYPE} instance"
  PROVISION_INSTANCE_CLIENT_TOKEN="$instance_client_token"
  instance_id="$(aws_quiet ec2 run-instances --region "$REGION" \
    --image-id "$ami" --instance-type "$INSTANCE_TYPE" \
    --client-token "$instance_client_token" \
    --key-name "$key_name" --security-group-ids "$sg_id" \
    --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=20,VolumeType=gp3,DeleteOnTermination=true}' \
    --user-data "file://${user_data_file}" \
    --tag-specifications 'ResourceType=instance,Tags=[{Key=Purpose,Value=self-hosting-e2e-test},{Key=Name,Value=selfhost-e2e}]' \
    --query 'Instances[0].InstanceId' --output text)"
  [[ -n "$instance_id" && "$instance_id" != "None" ]] || fail "run-instances returned no instance id"
  PROVISION_INSTANCE_ID="$instance_id"
  rm -f "$user_data_file"
  PROVISION_USER_DATA_FILE=""
  log "instance: $instance_id"

  log "waiting for instance-running"
  aws_quiet ec2 wait instance-running --region "$REGION" --instance-ids "$instance_id"
  public_ip="$(aws_quiet ec2 describe-instances --region "$REGION" --instance-ids "$instance_id" \
    --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)"
  [[ -n "$public_ip" && "$public_ip" != "None" ]] || fail "instance has no public IP"
  url="https://${public_ip}.sslip.io"
  log "public IP: $public_ip  url: $url"

  log "waiting for status-ok"
  aws_quiet ec2 wait instance-status-ok --region "$REGION" --instance-ids "$instance_id"

  local ssh_opts=(-i "$key_path" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10)
  log "waiting for SSH + cloud-init (docker install)"
  local ok=""
  for _ in $(seq 1 40); do
    if ssh "${ssh_opts[@]}" "ubuntu@${public_ip}" 'test -f /var/lib/cloud/selfhost-ready && docker compose version' >/dev/null 2>&1; then
      ok=1; break
    fi
    sleep 10
  done
  [[ -n "$ok" ]] || fail "SSH / docker never came up on $instance_id"

  log "copying deploy bundle"
  tar -C "$DEPLOY_DIR/.." -czf - deploy | ssh "${ssh_opts[@]}" "ubuntu@${public_ip}" 'mkdir -p ~/proliferate && tar -C ~/proliferate -xzf -'

  log "writing .env.static (sslip fallback, self_managed telemetry, image tag ${image_tag})"
  # The unquoted heredoc intentionally expands the locally selected image
  # repository/tag before sending the static environment over SSH.
  # shellcheck disable=SC2087
  ssh "${ssh_opts[@]}" "ubuntu@${public_ip}" "cat > ~/proliferate/deploy/.env.static" <<EOF
PROLIFERATE_USE_SSLIP_FALLBACK=true
PROLIFERATE_TELEMETRY_MODE=self_managed
PROLIFERATE_ANONYMOUS_TELEMETRY_DISABLED=true
PROLIFERATE_SERVER_IMAGE=${SERVER_IMAGE_REPO}
PROLIFERATE_SERVER_IMAGE_TAG=${image_tag}
PROLIFERATE_HOST_BIN_DIR=/opt/proliferate/bin
POSTGRES_DB=proliferate
POSTGRES_USER=proliferate
CORS_ALLOW_ORIGINS=http://localhost:1420,http://127.0.0.1:1420,http://tauri.localhost,tauri://localhost
EOF

  log "running bootstrap.sh on the box (secrets, migrate, boot, health + TLS gate)"
  ssh "${ssh_opts[@]}" "ubuntu@${public_ip}" \
    'sudo mkdir -p /opt/proliferate/bin && cd ~/proliferate/deploy && sudo ./bootstrap.sh' >&2

  log "waiting for public HTTPS /health at $url"
  local healthy=""
  for _ in $(seq 1 30); do
    if curl -fsS "${url}/health" >/dev/null 2>&1; then healthy=1; break; fi
    sleep 5
  done
  [[ -n "$healthy" ]] || fail "public /health never came up at $url (Caddy TLS issuance may have failed)"
  log "healthy"

  printf '{"instanceId":"%s","sgId":"%s","keyName":"%s","keyPath":"%s","publicIp":"%s","url":"%s","sshUser":"ubuntu"}\n' \
    "$instance_id" "$sg_id" "$key_name" "$key_path" "$public_ip" "$url"
  # Ownership transfers to the caller only after the machine-readable handoff
  # reaches stdout successfully. A broken pipe before this point still cleans.
  PROVISION_ACTIVE=0
  trap - ERR EXIT INT TERM
}

terminate() {
  local instance_id="" sg_id="" key_name="" key_path=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --instance-id) instance_id="$2"; shift 2 ;;
      --sg-id) sg_id="$2"; shift 2 ;;
      --key-name) key_name="$2"; shift 2 ;;
      --key-path) key_path="$2"; shift 2 ;;
      *) fail "unknown terminate arg: $1" ;;
    esac
  done

  if cleanup_resources "$instance_id" "$sg_id" "" "$key_name" "$key_path"; then
    log "teardown complete for instance=${instance_id:-none} security-group=${sg_id:-none} key-pair=${key_name:-none}"
    return 0
  fi
  log "teardown failed for instance=${instance_id:-none} security-group=${sg_id:-none} key-pair=${key_name:-none}"
  return 1
}

case "${1:-}" in
  provision) shift; provision "$@" ;;
  terminate) shift; terminate "$@" ;;
  *) fail "usage: selfhost-box.sh {provision|terminate} [args]" ;;
esac
