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

log() { printf '[selfhost-box] %s\n' "$*" >&2; }
fail() { printf '[selfhost-box] ERROR: %s\n' "$*" >&2; exit 1; }

command -v aws >/dev/null 2>&1 || fail "aws CLI is required."

provision() {
  local image_tag="${RELEASE_E2E_SELFHOST_IMAGE_TAG:-stable}"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --tag) image_tag="$2"; shift 2 ;;
      *) fail "unknown provision arg: $1" ;;
    esac
  done

  local suffix ami runner_ip key_name key_path sg_id instance_id public_ip url
  suffix="$(date +%s)-${RANDOM}"
  key_name="selfhost-e2e-${suffix}"
  key_path="${TMPDIR:-/tmp}/${key_name}.pem"

  log "resolving latest Ubuntu 24.04 amd64 AMI in ${REGION}"
  ami="$(aws ssm get-parameters --region "$REGION" \
    --names /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
    --query 'Parameters[0].Value' --output text)"
  [[ -n "$ami" && "$ami" != "None" ]] || fail "could not resolve Ubuntu 24.04 AMI"
  log "AMI: $ami"

  runner_ip="$(curl -fsS https://checkip.amazonaws.com | tr -d '[:space:]')"
  [[ -n "$runner_ip" ]] || fail "could not resolve this host's public IP for the SSH ingress rule"
  log "authorizing SSH from ${runner_ip}/32"

  log "creating key pair ${key_name}"
  aws ec2 create-key-pair --region "$REGION" --key-name "$key_name" \
    --query 'KeyMaterial' --output text >"$key_path"
  chmod 600 "$key_path"

  log "creating security group"
  sg_id="$(aws ec2 create-security-group --region "$REGION" \
    --group-name "$key_name" \
    --description "Proliferate self-host e2e test (throwaway)" \
    --tag-specifications 'ResourceType=security-group,Tags=[{Key=Purpose,Value=self-hosting-e2e-test},{Key=Name,Value=selfhost-e2e}]' \
    --query 'GroupId' --output text)"
  aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$sg_id" \
    --ip-permissions \
    "IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}]" \
    "IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}]" \
    "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=${runner_ip}/32}]" >/dev/null

  local user_data_file
  user_data_file="$(mktemp "${TMPDIR:-/tmp}/selfhost-userdata.XXXXXX")"
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
  instance_id="$(aws ec2 run-instances --region "$REGION" \
    --image-id "$ami" --instance-type "$INSTANCE_TYPE" \
    --key-name "$key_name" --security-group-ids "$sg_id" \
    --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=20,VolumeType=gp3,DeleteOnTermination=true}' \
    --user-data "file://${user_data_file}" \
    --tag-specifications 'ResourceType=instance,Tags=[{Key=Purpose,Value=self-hosting-e2e-test},{Key=Name,Value=selfhost-e2e}]' \
    --query 'Instances[0].InstanceId' --output text)"
  rm -f "$user_data_file"
  log "instance: $instance_id"

  log "waiting for instance-running"
  aws ec2 wait instance-running --region "$REGION" --instance-ids "$instance_id"
  public_ip="$(aws ec2 describe-instances --region "$REGION" --instance-ids "$instance_id" \
    --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)"
  [[ -n "$public_ip" && "$public_ip" != "None" ]] || fail "instance has no public IP"
  url="https://${public_ip}.sslip.io"
  log "public IP: $public_ip  url: $url"

  log "waiting for status-ok"
  aws ec2 wait instance-status-ok --region "$REGION" --instance-ids "$instance_id"

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

  if [[ -n "$instance_id" ]]; then
    log "terminating instance $instance_id"
    aws ec2 terminate-instances --region "$REGION" --instance-ids "$instance_id" >/dev/null 2>&1 || true
    aws ec2 wait instance-terminated --region "$REGION" --instance-ids "$instance_id" 2>/dev/null || true
  fi
  if [[ -n "$sg_id" ]]; then
    log "deleting security group $sg_id"
    # Retry: the ENI detach after termination can lag the delete a few seconds.
    for _ in $(seq 1 12); do
      if aws ec2 delete-security-group --region "$REGION" --group-id "$sg_id" >/dev/null 2>&1; then break; fi
      sleep 5
    done
  fi
  if [[ -n "$key_name" ]]; then
    log "deleting key pair $key_name"
    aws ec2 delete-key-pair --region "$REGION" --key-name "$key_name" >/dev/null 2>&1 || true
  fi
  [[ -n "$key_path" && -f "$key_path" ]] && rm -f "$key_path" || true
  log "teardown complete"
}

case "${1:-}" in
  provision) shift; provision "$@" ;;
  terminate) shift; terminate "$@" ;;
  *) fail "usage: selfhost-box.sh {provision|terminate} [args]" ;;
esac
