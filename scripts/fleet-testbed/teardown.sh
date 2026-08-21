#!/usr/bin/env bash
# Terminate fleet concurrency testbed instances.
#
# Safety: an instance is only ever terminated when it matches BOTH the testbed
# tag AND membership of the dedicated testbed VPC. This account also runs
# production, so one predicate is not enough.
#
# Usage:
#   ./teardown.sh              terminate instances, leave network in place
#   ./teardown.sh --network    also delete the VPC and its dependencies

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

DELETE_NETWORK="0"
[ "${1:-}" = "--network" ] && DELETE_NETWORK="1"

VPC_ID="$(require_testbed_vpc)"

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
  for sg in $(aws ec2 describe-security-groups --filters "Name=vpc-id,Values=${VPC_ID}" \
      --query "SecurityGroups[?GroupName!='default'].GroupId" --output text); do
    aws ec2 delete-security-group --group-id "$sg" || true
  done
  for subnet in $(aws ec2 describe-subnets --filters "Name=vpc-id,Values=${VPC_ID}" \
      --query 'Subnets[].SubnetId' --output text); do
    aws ec2 delete-subnet --subnet-id "$subnet" || true
  done
  for rt in $(aws ec2 describe-route-tables --filters "Name=vpc-id,Values=${VPC_ID}" \
      --query 'RouteTables[?length(Associations[?Main==`true`])==`0`].RouteTableId' --output text); do
    aws ec2 delete-route-table --route-table-id "$rt" || true
  done
  for igw in $(aws ec2 describe-internet-gateways \
      --filters "Name=attachment.vpc-id,Values=${VPC_ID}" \
      --query 'InternetGateways[].InternetGatewayId' --output text); do
    aws ec2 detach-internet-gateway --internet-gateway-id "$igw" --vpc-id "$VPC_ID" || true
    aws ec2 delete-internet-gateway --internet-gateway-id "$igw" || true
  done
  aws ec2 delete-vpc --vpc-id "$VPC_ID" || true
  log "network deleted"
fi
