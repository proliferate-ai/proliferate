#!/usr/bin/env bash
# Provision one fleet concurrency testbed instance.
#
# Usage:
#   ./provision.sh [--arch x86_64|arm64] [--type <instance-type>] [--disk 200]
#                  [--ref <git-ref>] [--with-rust] [--no-wait]
#
# Idempotent: network, key pair, and IAM role are created once and reused.
# Everything is tagged and lives in a dedicated VPC so teardown can require two
# independent predicates before terminating anything.

# --arch selects the AMI, the awscli build, and the musl artifact, so it has to
# be known before lib.sh derives them.
for _i in "$@"; do
  case "${_prev:-}" in --arch) ARCH="$_i" ;; esac
  _prev="$_i"
done
export ARCH="${ARCH:-x86_64}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

INSTANCE_TYPE="$DEFAULT_TYPE"
DISK_GB="200"
REPO_REF="$RELEASE_COMMIT"
WITH_RUST="0"
WAIT_READY="1"

while [ $# -gt 0 ]; do
  case "$1" in
    --type) INSTANCE_TYPE="$2"; shift 2 ;;
    --disk) DISK_GB="$2"; shift 2 ;;
    --ref) REPO_REF="$2"; shift 2 ;;
    --with-rust) WITH_RUST="1"; shift ;;
    --arch) shift 2 ;;
    --no-wait) WAIT_READY="0"; shift ;;
    *) die "unknown argument: $1" ;;
  esac
done

MY_IP="$(curl -fsS --max-time 10 https://checkip.amazonaws.com | tr -d '[:space:]')"
[ -n "$MY_IP" ] || die "could not determine public IP for the SSH allowlist"

# --- network -----------------------------------------------------------------

VPC_ID=$(aws ec2 describe-vpcs --filters "Name=tag:${TAG_KEY},Values=${TAG_VALUE}" \
  --query 'Vpcs[0].VpcId' --output text)

if [ "$VPC_ID" = "None" ] || [ -z "$VPC_ID" ]; then
  log "creating dedicated VPC ${VPC_CIDR}"
  VPC_ID=$(aws ec2 create-vpc --cidr-block "$VPC_CIDR" \
    --tag-specifications "$(tag_spec vpc)" --query 'Vpc.VpcId' --output text)
  aws ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-hostnames

  IGW_ID=$(aws ec2 create-internet-gateway \
    --tag-specifications "$(tag_spec internet-gateway)" \
    --query 'InternetGateway.InternetGatewayId' --output text)
  aws ec2 attach-internet-gateway --vpc-id "$VPC_ID" --internet-gateway-id "$IGW_ID"

  SUBNET_ID=$(aws ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block "$SUBNET_CIDR" \
    --tag-specifications "$(tag_spec subnet)" --query 'Subnet.SubnetId' --output text)
  aws ec2 modify-subnet-attribute --subnet-id "$SUBNET_ID" --map-public-ip-on-launch

  RT_ID=$(aws ec2 create-route-table --vpc-id "$VPC_ID" \
    --tag-specifications "$(tag_spec route-table)" --query 'RouteTable.RouteTableId' --output text)
  aws ec2 create-route --route-table-id "$RT_ID" --destination-cidr-block 0.0.0.0/0 \
    --gateway-id "$IGW_ID" >/dev/null
  aws ec2 associate-route-table --route-table-id "$RT_ID" --subnet-id "$SUBNET_ID" >/dev/null
else
  log "reusing VPC ${VPC_ID}"
  SUBNET_ID=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=${VPC_ID}" \
    --query 'Subnets[0].SubnetId' --output text)
fi

SG_ID=$(aws ec2 describe-security-groups \
  --filters "Name=vpc-id,Values=${VPC_ID}" "Name=group-name,Values=${NAME_PREFIX}" \
  --query 'SecurityGroups[0].GroupId' --output text)

if [ "$SG_ID" = "None" ] || [ -z "$SG_ID" ]; then
  log "creating security group (SSH from ${MY_IP}/32 only)"
  SG_ID=$(aws ec2 create-security-group --group-name "$NAME_PREFIX" \
    --description "Fleet concurrency testbed" --vpc-id "$VPC_ID" \
    --tag-specifications "$(tag_spec security-group)" --query 'GroupId' --output text)
fi

# Refresh the SSH rule for the current IP; harmless when it already exists.
aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp \
  --port 22 --cidr "${MY_IP}/32" >/dev/null 2>&1 || true

# --- key pair ----------------------------------------------------------------

if ! aws ec2 describe-key-pairs --key-names "$KEY_NAME" >/dev/null 2>&1; then
  log "creating key pair, private key at ${KEY_PATH}"
  aws ec2 create-key-pair --key-name "$KEY_NAME" --key-type ed25519 \
    --tag-specifications "$(tag_spec key-pair)" \
    --query 'KeyMaterial' --output text > "$KEY_PATH"
  chmod 600 "$KEY_PATH"
fi

# --- IAM role: SSM parameter read + Bedrock invoke ---------------------------

if ! aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  log "creating IAM role ${ROLE_NAME}"
  aws iam create-role --role-name "$ROLE_NAME" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
    --tags "Key=${TAG_KEY},Value=${TAG_VALUE}" >/dev/null

  ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
  aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name testbed-access \
    --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[
      {\"Effect\":\"Allow\",\"Action\":[\"ssm:GetParameter\"],\"Resource\":\"arn:aws:ssm:${AWS_DEFAULT_REGION}:${ACCOUNT_ID}:parameter${SSM_PREFIX}/*\"},
      {\"Effect\":\"Allow\",\"Action\":[\"kms:Decrypt\"],\"Resource\":\"*\",\"Condition\":{\"StringEquals\":{\"kms:ViaService\":\"ssm.${AWS_DEFAULT_REGION}.amazonaws.com\"}}},
      {\"Effect\":\"Allow\",\"Action\":[\"bedrock:InvokeModel\",\"bedrock:InvokeModelWithResponseStream\"],\"Resource\":\"*\"},
      {\"Effect\":\"Allow\",\"Action\":[\"ec2:TerminateInstances\"],\"Resource\":\"*\",\"Condition\":{\"StringEquals\":{\"ec2:ResourceTag/${TAG_KEY}\":\"${TAG_VALUE}\"}}}
    ]}" >/dev/null

  aws iam create-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$PROFILE_NAME" --role-name "$ROLE_NAME"
  log "waiting for instance profile to propagate"
  sleep 15
fi

# --- GitHub token in SSM (never in user-data) --------------------------------

if ! aws ssm get-parameter --name "${SSM_PREFIX}/github-token" >/dev/null 2>&1; then
  log "storing GitHub token in SSM SecureString"
  # Via a mode-600 temp file rather than an argv value, so the token never
  # appears in the process table.
  TOKEN_FILE="$(mktemp)"
  chmod 600 "$TOKEN_FILE"
  trap 'rm -f "$TOKEN_FILE"' EXIT
  gh auth token > "$TOKEN_FILE"
  aws ssm put-parameter --name "${SSM_PREFIX}/github-token" \
    --type SecureString --value "file://${TOKEN_FILE}" --overwrite >/dev/null
  rm -f "$TOKEN_FILE"
  trap - EXIT
fi

# --- launch ------------------------------------------------------------------

AMI_ID=$(aws ssm get-parameter --name "$AMI_SSM_PARAM" --query 'Parameter.Value' --output text)

USER_DATA=$(sed \
  -e "s|__DEADMAN_HOURS__|${DEADMAN_HOURS}|g" \
  -e "s|__WITH_RUST__|${WITH_RUST}|g" \
  -e "s|__REPO_REF__|${REPO_REF}|g" \
  -e "s|__SSM_PREFIX__|${SSM_PREFIX}|g" \
  -e "s|__AWS_REGION__|${AWS_DEFAULT_REGION}|g" \
  -e "s|__AWSCLI_ARCH__|${AWSCLI_ARCH}|g" \
  -e "s|__MUSL_ARCH__|${MUSL_ARCH}|g" \
  -e "s|__RELEASE_TAG__|${RELEASE_TAG}|g" \
  -e "s|__FIX_BRANCH__|${FIX_BRANCH}|g" \
  "${SCRIPT_DIR}/user-data.sh")

log "launching ${INSTANCE_TYPE} (${ARCH}) from ${AMI_ID} (ref ${REPO_REF}, rust=${WITH_RUST}, deadman ${DEADMAN_HOURS}h)"
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id "$AMI_ID" \
  --instance-type "$INSTANCE_TYPE" \
  --key-name "$KEY_NAME" \
  --subnet-id "$SUBNET_ID" \
  --security-group-ids "$SG_ID" \
  --iam-instance-profile "Name=${PROFILE_NAME}" \
  --instance-initiated-shutdown-behavior terminate \
  --block-device-mappings "[{\"DeviceName\":\"/dev/sda1\",\"Ebs\":{\"VolumeSize\":${DISK_GB},\"VolumeType\":\"gp3\",\"DeleteOnTermination\":true}}]" \
  --tag-specifications "$(tag_spec instance)" "$(tag_spec volume)" \
  --user-data "$USER_DATA" \
  --query 'Instances[0].InstanceId' --output text)

log "waiting for ${INSTANCE_ID} to run"
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"

PUBLIC_IP=$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)

cat <<SUMMARY

instance   ${INSTANCE_ID}
type       ${INSTANCE_TYPE}
ip         ${PUBLIC_IP}
ssh        ssh -i ${KEY_PATH} ubuntu@${PUBLIC_IP}
setup log  ssh -i ${KEY_PATH} ubuntu@${PUBLIC_IP} 'tail -f /var/log/fleet-testbed-setup.log'
ready when /var/lib/fleet-testbed-ready exists
deadman    self-terminates after ${DEADMAN_HOURS}h
teardown   ${SCRIPT_DIR}/teardown.sh

SUMMARY

if [ "$WAIT_READY" = "1" ]; then
  log "waiting for setup to finish (clone, install, build, profile setup)"
  SSH="ssh -i ${KEY_PATH} -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 ubuntu@${PUBLIC_IP}"
  for _ in $(seq 1 120); do
    if $SSH 'test -f /var/lib/fleet-testbed-ready' 2>/dev/null; then
      log "ready"
      $SSH 'set -a; . /etc/environment; set +a; cd ~/proliferate; \
        echo "commit  $(git rev-parse --short HEAD)"; \
        echo "runtime $(~/bin/anyharness --version 2>&1 | head -1)"; \
        echo "claude  $(claude --version 2>&1 | head -1)"; \
        echo "cargo   $(command -v cargo || echo "not installed")"'
      exit 0
    fi
    sleep 30
  done
  die "setup did not finish within 60 minutes; check /var/log/fleet-testbed-setup.log"
fi
