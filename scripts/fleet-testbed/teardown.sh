#!/usr/bin/env bash
# Terminate fleet concurrency testbed resources.
#
# Safety: nothing is ever selected by the project tag alone. The VPC is resolved
# by tag AND exact CIDR AND IsDefault=false (see lib.sh resolve_testbed_vpc),
# the caller's account is asserted, and every delete below is additionally
# filtered on the tag as well as VPC membership. This account also runs
# production, and production lives in the default VPC, so one predicate is not
# enough and neither is one predicate applied twice.
#
# Usage:
#   ./teardown.sh              terminate instances, leave everything else
#   ./teardown.sh --network    also delete the VPC, its dependencies, and the
#                              GitHub token in SSM
#   ./teardown.sh --all        also delete the IAM role, instance profile, and
#                              key pair, including the local private key

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh" || { echo "fatal: cannot source ${SCRIPT_DIR}/lib.sh" >&2; exit 1; }

DELETE_NETWORK="0"
DELETE_IDENTITY="0"
while [ $# -gt 0 ]; do
  case "$1" in
    --network) DELETE_NETWORK="1"; shift ;;
    --all) DELETE_NETWORK="1"; DELETE_IDENTITY="1"; shift ;;
    -h|--help) sed -n '2,16p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

require_expected_account

FAILURES=0
fail() {
  FAILURES=$((FAILURES + 1))
  log "FAILED: $*"
}

with_retry() {
  # Deletes right after a termination routinely fail while the ENI drains, so a
  # first failure is not yet a failure. The last attempt is not silenced, so the
  # operator sees the real AWS error rather than a bare exit code.
  local desc="$1"; shift
  local attempt
  for attempt in 1 2 3 4 5; do
    if "$@" >/dev/null 2>&1; then
      return 0
    fi
    log "${desc}: not ready (attempt ${attempt}/6), waiting 10s for dependencies to drain"
    sleep 10
  done
  "$@" >/dev/null
}

# Resolved into this shell, not through $(...), so a failing describe aborts
# instead of reading as "no testbed VPC" -- which would make --network a silent
# no-op over a live instance and let --all delete the key pair out from under
# one. Empty genuinely means the VPC does not exist, which is not an error:
# there is then nothing this script is allowed to select, so instance and
# network teardown are skipped rather than falling back to a looser predicate.
resolve_testbed_vpc
VPC_ID="$TESTBED_VPC_ID"

if [ -z "$VPC_ID" ]; then
  log "no testbed VPC (tag ${TAG_KEY}=${TAG_VALUE}, CIDR ${VPC_CIDR}, non-default); skipping instances and network"
  # Only the VPC-scoped work is skipped. The SSM token and the IAM/key-pair
  # resources outlive the VPC, so their blocks below must stay reachable.
  if [ "$DELETE_NETWORK" != "1" ] && [ "$DELETE_IDENTITY" != "1" ]; then
    log "nothing to do"
    exit 0
  fi
fi

if [ -n "$VPC_ID" ]; then
  log "testbed VPC ${VPC_ID} (${VPC_CIDR}) in account ${ACCOUNT_ID}"

  INSTANCE_IDS=$(aws ec2 describe-instances \
    --filters "Name=tag:${TAG_KEY},Values=${TAG_VALUE}" \
              "Name=vpc-id,Values=${VPC_ID}" \
              "Name=instance-state-name,Values=pending,running,stopping,stopped" \
    --query 'Reservations[].Instances[].InstanceId' --output text)

  if [ -z "$INSTANCE_IDS" ]; then
    log "no testbed instances to terminate"
  else
    log "terminating: ${INSTANCE_IDS}"
    # shellcheck disable=SC2086
    aws ec2 terminate-instances --instance-ids $INSTANCE_IDS >/dev/null
    # shellcheck disable=SC2086
    aws ec2 wait instance-terminated --instance-ids $INSTANCE_IDS
    log "terminated"
  fi

  if [ "$DELETE_NETWORK" = "1" ]; then
    log "deleting network for ${VPC_ID}"

    # Every one of these was created with tag_spec, so the tag filter costs
    # nothing and removes the single-mistake path where a wrong VPC id enumerates
    # somebody else's networking. Verified against provision.sh: vpc,
    # internet-gateway, subnet, route-table, and security-group all carry it.
    # Resolved into variables first, so a failing describe aborts under `set -e`
    # instead of quietly yielding an empty list that looks like "nothing to do".
    SG_IDS=$(aws ec2 describe-security-groups \
      --filters "Name=vpc-id,Values=${VPC_ID}" "Name=tag:${TAG_KEY},Values=${TAG_VALUE}" \
      --query "SecurityGroups[?GroupName!='default'].GroupId" --output text)
    SUBNET_IDS=$(aws ec2 describe-subnets \
      --filters "Name=vpc-id,Values=${VPC_ID}" "Name=tag:${TAG_KEY},Values=${TAG_VALUE}" \
      --query 'Subnets[].SubnetId' --output text)
    RT_IDS=$(aws ec2 describe-route-tables \
      --filters "Name=vpc-id,Values=${VPC_ID}" "Name=tag:${TAG_KEY},Values=${TAG_VALUE}" \
      --query 'RouteTables[?length(Associations[?Main==`true`])==`0`].RouteTableId' --output text)
    IGW_IDS=$(aws ec2 describe-internet-gateways \
      --filters "Name=attachment.vpc-id,Values=${VPC_ID}" "Name=tag:${TAG_KEY},Values=${TAG_VALUE}" \
      --query 'InternetGateways[].InternetGatewayId' --output text)

    # shellcheck disable=SC2086
    for sg in $SG_IDS; do
      with_retry "delete security group ${sg}" \
        aws ec2 delete-security-group --group-id "$sg" || fail "delete security group ${sg}"
    done

    # shellcheck disable=SC2086
    for subnet in $SUBNET_IDS; do
      with_retry "delete subnet ${subnet}" \
        aws ec2 delete-subnet --subnet-id "$subnet" || fail "delete subnet ${subnet}"
    done

    # shellcheck disable=SC2086
    for rt in $RT_IDS; do
      with_retry "delete route table ${rt}" \
        aws ec2 delete-route-table --route-table-id "$rt" || fail "delete route table ${rt}"
    done

    # shellcheck disable=SC2086
    for igw in $IGW_IDS; do
      with_retry "detach internet gateway ${igw}" \
        aws ec2 detach-internet-gateway --internet-gateway-id "$igw" --vpc-id "$VPC_ID" \
        || fail "detach internet gateway ${igw}"
      with_retry "delete internet gateway ${igw}" \
        aws ec2 delete-internet-gateway --internet-gateway-id "$igw" \
        || fail "delete internet gateway ${igw}"
    done

    with_retry "delete VPC ${VPC_ID}" aws ec2 delete-vpc --vpc-id "$VPC_ID" \
      || fail "delete VPC ${VPC_ID}"

    if [ "$FAILURES" -eq 0 ]; then
      log "network deleted"
    fi
  fi
fi

# Outside the VPC guard on purpose: the token outlives the network, and leaving
# a live GitHub credential in the production account is the failure mode this
# whole lane is trying not to create.
if [ "$DELETE_NETWORK" = "1" ]; then
  if aws ssm get-parameter --name "${SSM_PREFIX}/github-token" >/dev/null 2>&1; then
    log "deleting SSM parameter ${SSM_PREFIX}/github-token"
    aws ssm delete-parameter --name "${SSM_PREFIX}/github-token" >/dev/null \
      || fail "delete SSM parameter ${SSM_PREFIX}/github-token"
  else
    log "no SSM token parameter to delete"
  fi
fi

if [ "$DELETE_IDENTITY" = "1" ]; then
  log "deleting IAM role, instance profile, and key pair"

  if aws iam get-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null 2>&1; then
    if aws iam get-instance-profile --instance-profile-name "$PROFILE_NAME" \
        --query "InstanceProfile.Roles[?RoleName=='${ROLE_NAME}'].RoleName" --output text \
        | grep -q "$ROLE_NAME"; then
      aws iam remove-role-from-instance-profile \
        --instance-profile-name "$PROFILE_NAME" --role-name "$ROLE_NAME" \
        || fail "remove role from instance profile ${PROFILE_NAME}"
    fi
    aws iam delete-instance-profile --instance-profile-name "$PROFILE_NAME" \
      || fail "delete instance profile ${PROFILE_NAME}"
  fi

  if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
    if aws iam get-role-policy --role-name "$ROLE_NAME" --policy-name testbed-access >/dev/null 2>&1; then
      aws iam delete-role-policy --role-name "$ROLE_NAME" --policy-name testbed-access \
        || fail "delete inline policy on ${ROLE_NAME}"
    fi
    aws iam delete-role --role-name "$ROLE_NAME" || fail "delete role ${ROLE_NAME}"
  fi

  # Deleting the key pair while something is still running with it is
  # unrecoverable: there is no second way onto the box. Checked account-wide on
  # the key name rather than within the VPC, because by this point the VPC may
  # already be gone.
  KEY_USERS=$(aws ec2 describe-instances \
    --filters "Name=key-name,Values=${KEY_NAME}" \
              "Name=instance-state-name,Values=pending,running,stopping,stopped" \
    --query 'Reservations[].Instances[].InstanceId' --output text)
  if [ -n "$KEY_USERS" ]; then
    fail "refusing to delete key pair ${KEY_NAME}: still in use by ${KEY_USERS}"
  else
    if aws ec2 describe-key-pairs --key-names "$KEY_NAME" >/dev/null 2>&1; then
      aws ec2 delete-key-pair --key-name "$KEY_NAME" >/dev/null \
        || fail "delete key pair ${KEY_NAME}"
    fi
    # Deleted together with the AWS side, so the next provision does not trip
    # the both-sides guard on a private key whose pair no longer exists.
    if [ -e "$KEY_PATH" ]; then
      log "removing local private key ${KEY_PATH}"
      rm -f "$KEY_PATH" || fail "remove ${KEY_PATH}"
    fi
  fi
fi

if [ "$FAILURES" -ne 0 ]; then
  die "${FAILURES} teardown step(s) failed; resources may remain. Re-run after resolving the errors above."
fi

log "teardown complete"
