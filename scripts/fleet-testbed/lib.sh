#!/usr/bin/env bash
# Shared configuration for the fleet concurrency testbed.
#
# Every resource this lane creates carries TAG_KEY=TAG_VALUE and lives inside a
# dedicated VPC. Teardown requires BOTH predicates to match, so no single
# mistake can select a production instance in the same account.

set -euo pipefail

export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"

TAG_KEY="Project"
TAG_VALUE="proliferate-fleet-testbed"
NAME_PREFIX="proliferate-fleet-testbed"

VPC_CIDR="10.42.0.0/16"
SUBNET_CIDR="10.42.1.0/24"

KEY_NAME="${NAME_PREFIX}"
KEY_PATH="${HOME}/.ssh/${NAME_PREFIX}.pem"
ROLE_NAME="${NAME_PREFIX}"
PROFILE_NAME="${NAME_PREFIX}"
SSM_PREFIX="/${NAME_PREFIX}"

# Architecture. The agent_process sidecar the runtime installs is pinned for
# linux_x64 only, so x86_64 is the default: on arm64 the install endpoint fails
# with AGENT_NO_PIN_FOR_PLATFORM and no session can run a turn.
ARCH="${ARCH:-x86_64}"
case "$ARCH" in
  x86_64) AMI_ARCH=amd64;  AWSCLI_ARCH=x86_64;  MUSL_ARCH=x86_64;  DEFAULT_TYPE=m7i.4xlarge ;;
  arm64)  AMI_ARCH=arm64;  AWSCLI_ARCH=aarch64; MUSL_ARCH=aarch64; DEFAULT_TYPE=m8g.4xlarge ;;
  *) echo "unsupported ARCH: $ARCH (want x86_64 or arm64)" >&2; exit 1 ;;
esac

# Ubuntu 24.04, resolved from Canonical's public SSM parameter so the AMI is
# never a stale literal.
AMI_SSM_PARAM="/aws/service/canonical/ubuntu/server/24.04/stable/current/${AMI_ARCH}/hvm/ebs-gp3/ami-id"

# Prebuilt runtime. Pinning the repo to this release's own commit keeps binary
# and source exactly in step, so no schema skew can be mistaken for a finding.
RELEASE_TAG="${RELEASE_TAG:-server-v0.4.20}"
RELEASE_COMMIT="${RELEASE_COMMIT:-be045d63dafc7a74838aa17f00dfb2f6a4e18ed7}"

# Branch carrying the dev-loop fixes the testbed needs (HEADLESS, dev-build).
# Cherry-picked onto RELEASE_COMMIT rather than checked out, so the tree stays
# at the release and binary and source cannot disagree.
FIX_BRANCH="${FIX_BRANCH:-perf/dev-loop-launch}"

# Deadman. The instance shuts itself down after this long and terminates,
# because run-instances sets instance-initiated-shutdown-behavior=terminate.
DEADMAN_HOURS="${DEADMAN_HOURS:-12}"

tag_spec() {
  # $1 = resource type
  echo "ResourceType=$1,Tags=[{Key=${TAG_KEY},Value=${TAG_VALUE}},{Key=Name,Value=${NAME_PREFIX}}]"
}

log() { printf '[fleet-testbed] %s\n' "$*" >&2; }

die() { printf '[fleet-testbed] ERROR: %s\n' "$*" >&2; exit 1; }

require_testbed_vpc() {
  # Resolves the dedicated VPC id, failing loudly rather than falling back to
  # the default VPC, which in this account holds production instances.
  local vpc_id
  vpc_id=$(aws ec2 describe-vpcs \
    --filters "Name=tag:${TAG_KEY},Values=${TAG_VALUE}" \
    --query 'Vpcs[0].VpcId' --output text)
  [ "$vpc_id" != "None" ] && [ -n "$vpc_id" ] || die "no testbed VPC found; run provision.sh first"
  echo "$vpc_id"
}
