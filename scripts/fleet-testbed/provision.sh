#!/usr/bin/env bash
# Provision one fleet concurrency testbed instance.
#
# Usage:
#   ./provision.sh [--arch x86_64|arm64] [--type <instance-type>] [--disk 200]
#                  [--ref <git-ref>] [--with-rust] [--no-wait]
#
# Idempotent: network, key pair, IAM role, and the SSM token are created or
# refreshed on every run and reused. Everything is tagged and lives in a
# dedicated non-default VPC, so teardown can assert tag, CIDR, and non-default
# together before deleting anything in an account that also holds production.

set -euo pipefail

# --arch selects the AMI, the awscli build, and the musl artifact, so it has to
# be known before lib.sh derives them.
for _i in "$@"; do
  case "${_prev:-}" in --arch) ARCH="$_i" ;; esac
  _prev="$_i"
done
export ARCH="${ARCH:-x86_64}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh" || { echo "fatal: cannot source ${SCRIPT_DIR}/lib.sh" >&2; exit 1; }

INSTANCE_TYPE="$DEFAULT_TYPE"
DISK_GB="200"
REPO_REF="$RELEASE_COMMIT"
WITH_RUST="0"
WAIT_READY="1"

while [ $# -gt 0 ]; do
  case "$1" in
    --type) INSTANCE_TYPE="${2:-}"; shift 2 ;;
    --disk) DISK_GB="${2:-}"; shift 2 ;;
    --ref) REPO_REF="${2:-}"; shift 2 ;;
    --with-rust) WITH_RUST="1"; shift ;;
    --arch) shift 2 ;;
    --no-wait) WAIT_READY="0"; shift ;;
    *) die "unknown argument: $1" ;;
  esac
done

# Everything below is templated into a script that cloud-init runs as root, so
# validate before substituting rather than hoping a ref never contains a quote.
require_safe_ref "--ref" "$REPO_REF"
require_safe_ref "--type" "$INSTANCE_TYPE"
require_safe_ref "FIX_BRANCH" "$FIX_BRANCH"
require_safe_ref "RELEASE_TAG" "$RELEASE_TAG"
require_safe_ref "SSM_PREFIX" "$SSM_PREFIX"
require_safe_ref "AWS_DEFAULT_REGION" "$AWS_DEFAULT_REGION"
require_safe_ref "AWSCLI_ARCH" "$AWSCLI_ARCH"
require_safe_ref "MUSL_ARCH" "$MUSL_ARCH"
require_positive_int "--disk" "$DISK_GB"
require_positive_int "DEADMAN_HOURS" "$DEADMAN_HOURS"

# The whole safety design assumes production shares this account.
require_expected_account
log "account ${ACCOUNT_ID}, region ${AWS_DEFAULT_REGION}"

MY_IP="$(curl -fsS --max-time 10 https://checkip.amazonaws.com | tr -d '[:space:]')" \
  || die "could not reach checkip.amazonaws.com to determine the SSH allowlist address"
require_ipv4 "the caller's public IP" "$MY_IP"

# --- network -----------------------------------------------------------------

# Sets TESTBED_VPC_ID in this shell rather than through $(...), so a failing
# describe cannot masquerade as "no testbed VPC" and create a second one.
resolve_testbed_vpc
VPC_ID="$TESTBED_VPC_ID"

if [ -z "$VPC_ID" ]; then
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
  SUBNET_ID=$(aws ec2 describe-subnets \
    --filters "Name=vpc-id,Values=${VPC_ID}" "Name=tag:${TAG_KEY},Values=${TAG_VALUE}" \
    --query 'Subnets[0].SubnetId' --output text)
  [ -n "$SUBNET_ID" ] && [ "$SUBNET_ID" != "None" ] \
    || die "VPC ${VPC_ID} has no tagged testbed subnet; delete it with teardown.sh --network and re-provision"
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

# Replace the whole ingress rule set rather than adding to it. Authorizing on
# every run without revoking accumulates stale /32s until the 60-rule quota is
# hit, at which point new authorizes fail and the caller silently cannot SSH in.
#
# Every rule goes, not only the ones with FromPort and ToPort both exactly 22: a
# range rule, or an IpProtocol of -1, reaches port 22 without matching an
# exact-22 predicate. This security group exists solely to carry this lane's SSH
# rule, so its contents being a pure function of this script is the point. A
# port opened here by hand does not survive the next provision, deliberately.
EXISTING_INGRESS=$(aws ec2 describe-security-groups --group-ids "$SG_ID" \
  --query 'SecurityGroups[0].IpPermissions' --output json)
if [ "$(printf '%s' "$EXISTING_INGRESS" | tr -d '[:space:]')" != "[]" ]; then
  log "revoking every existing ingress rule on ${SG_ID}"
  aws ec2 revoke-security-group-ingress --group-id "$SG_ID" \
    --ip-permissions "$EXISTING_INGRESS" >/dev/null
fi
log "authorizing SSH from ${MY_IP}/32"
aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp \
  --port 22 --cidr "${MY_IP}/32" >/dev/null

# --- key pair ----------------------------------------------------------------

KEY_IN_AWS="0"
if aws ec2 describe-key-pairs --key-names "$KEY_NAME" >/dev/null 2>&1; then
  KEY_IN_AWS="1"
fi
KEY_ON_DISK="0"
if [ -s "$KEY_PATH" ]; then
  KEY_ON_DISK="1"
fi

if [ "$KEY_IN_AWS" = "1" ] && [ "$KEY_ON_DISK" = "0" ]; then
  die "key pair ${KEY_NAME} exists in AWS but ${KEY_PATH} is missing or empty; any instance launched with it would be unreachable. Restore the file, or delete the pair with: aws ec2 delete-key-pair --key-name ${KEY_NAME}"
elif [ "$KEY_IN_AWS" = "0" ] && [ "$KEY_ON_DISK" = "1" ]; then
  die "${KEY_PATH} exists but AWS has no key pair named ${KEY_NAME}; move the stale file aside before re-provisioning"
elif [ "$KEY_IN_AWS" = "0" ]; then
  log "creating key pair, private key at ${KEY_PATH}"
  mkdir -p "$(dirname "$KEY_PATH")"
  chmod 700 "$(dirname "$KEY_PATH")" 2>/dev/null || true
  # Write mode-600 from the first byte and only move into place on success, so a
  # failed create can never truncate a private key that is still live in AWS.
  KEY_TMP="${KEY_PATH}.tmp.$$"
  trap 'rm -f "$KEY_TMP"' EXIT
  (
    umask 077
    aws ec2 create-key-pair --key-name "$KEY_NAME" --key-type ed25519 \
      --tag-specifications "$(tag_spec key-pair)" \
      --query 'KeyMaterial' --output text > "$KEY_TMP"
  )
  [ -s "$KEY_TMP" ] || die "create-key-pair returned no key material"
  mv "$KEY_TMP" "$KEY_PATH"
  trap - EXIT
fi

# --- IAM role: SSM parameter read + Bedrock invoke ---------------------------

CREATED_IAM="0"
if ! aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  log "creating IAM role ${ROLE_NAME}"
  aws iam create-role --role-name "$ROLE_NAME" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
    --tags "Key=${TAG_KEY},Value=${TAG_VALUE}" >/dev/null
  CREATED_IAM="1"
fi

# Unconditional, and idempotent: gating these on get-role means a run that died
# between create-role and put-role-policy never self-repairs, and an edit to the
# policy below never reaches an existing deployment.
#
# Bedrock is scoped to the Anthropic Claude models the agent actually invokes,
# both as foundation models (a cross-region inference profile resolves to the
# destination region's foundation-model ARN) and as the region-prefixed
# inference profiles the catalog uses. It is not `Resource: "*"`, because this
# account's Bedrock is what production agent auth runs on and a testbed agent
# has no business reaching anything else in it.
aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name testbed-access \
  --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[
    {\"Effect\":\"Allow\",\"Action\":[\"ssm:GetParameter\"],\"Resource\":\"arn:aws:ssm:${AWS_DEFAULT_REGION}:${ACCOUNT_ID}:parameter${SSM_PREFIX}/*\"},
    {\"Effect\":\"Allow\",\"Action\":[\"kms:Decrypt\"],\"Resource\":\"*\",\"Condition\":{\"StringEquals\":{\"kms:ViaService\":\"ssm.${AWS_DEFAULT_REGION}.amazonaws.com\"}}},
    {\"Effect\":\"Allow\",\"Action\":[\"bedrock:InvokeModel\",\"bedrock:InvokeModelWithResponseStream\"],\"Resource\":[
      \"arn:aws:bedrock:*::foundation-model/anthropic.claude-*\",
      \"arn:aws:bedrock:*:${ACCOUNT_ID}:inference-profile/*anthropic.claude-*\"
    ]}
  ]}" >/dev/null

if ! aws iam get-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null 2>&1; then
  log "creating instance profile ${PROFILE_NAME}"
  aws iam create-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null
  CREATED_IAM="1"
fi

# Also unconditional. add-role-to-instance-profile returns LimitExceeded when the
# role is already attached, which is the only already-done case and is benign.
if ! aws iam add-role-to-instance-profile \
    --instance-profile-name "$PROFILE_NAME" --role-name "$ROLE_NAME" 2>/dev/null; then
  aws iam get-instance-profile --instance-profile-name "$PROFILE_NAME" \
    --query "InstanceProfile.Roles[?RoleName=='${ROLE_NAME}'].RoleName" --output text \
    | grep -q "$ROLE_NAME" \
    || die "could not attach role ${ROLE_NAME} to instance profile ${PROFILE_NAME}"
fi

if [ "$CREATED_IAM" = "1" ]; then
  log "waiting for instance profile to propagate"
  sleep 15
fi

# --- GitHub token in SSM (never in user-data) --------------------------------

# Written on every run, not only when absent. A revoked or rotated token left in
# SSM otherwise breaks every future clone with an authentication error that
# looks nothing like its cause.
log "refreshing GitHub token in SSM SecureString"
TOKEN_FILE="$(mktemp)"
chmod 600 "$TOKEN_FILE"
trap 'rm -f "$TOKEN_FILE"' EXIT
# Via a mode-600 temp file rather than an argv value, so the token never appears
# in the process table. Redirected rather than captured, so the value never
# becomes a variable in this shell and a failure inside the reader is fatal
# instead of yielding an empty token.
read_github_token > "$TOKEN_FILE"
[ -s "$TOKEN_FILE" ] || die "the configured GitHub token source produced nothing"
aws ssm put-parameter --name "${SSM_PREFIX}/github-token" \
  --type SecureString --value "file://${TOKEN_FILE}" --overwrite >/dev/null
rm -f "$TOKEN_FILE"
trap - EXIT

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

# Every placeholder, not a hand-maintained subset of them: an unsubstituted one
# reaches the instance as a literal and fails somewhere far from its cause.
LEFTOVER=$(printf '%s\n' "$USER_DATA" | grep -oE '__[A-Z][A-Z0-9_]*__' | sort -u | tr '\n' ' ' || true)
[ -z "$LEFTOVER" ] || die "user-data still contains unsubstituted placeholders: ${LEFTOVER}"

log "launching ${INSTANCE_TYPE} (${ARCH}) from ${AMI_ID} (ref ${REPO_REF}, rust=${WITH_RUST}, deadman ${DEADMAN_HOURS}h)"
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id "$AMI_ID" \
  --instance-type "$INSTANCE_TYPE" \
  --key-name "$KEY_NAME" \
  --subnet-id "$SUBNET_ID" \
  --security-group-ids "$SG_ID" \
  --iam-instance-profile "Name=${PROFILE_NAME}" \
  --instance-initiated-shutdown-behavior terminate \
  --metadata-options "HttpEndpoint=enabled,HttpTokens=required,HttpPutResponseHopLimit=1" \
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
setup log  ssh -i ${KEY_PATH} ubuntu@${PUBLIC_IP} 'sudo tail -f /var/log/fleet-testbed-setup.log'
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
  die "setup did not finish within 60 minutes; check 'sudo tail /var/log/fleet-testbed-setup.log' on ${PUBLIC_IP}"
fi
