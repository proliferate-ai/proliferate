#!/usr/bin/env bash
# Shared configuration for the fleet concurrency testbed.
#
# This account also runs production, and production lives in the DEFAULT VPC.
# Every resource this lane creates therefore carries TAG_KEY=TAG_VALUE and lives
# inside a dedicated non-default VPC whose CIDR nothing else uses. Selection for
# any destructive operation asserts all three: the tag, the CIDR, and
# IsDefault=false. See find_testbed_vpc.

# Every value defined below is consumed by the scripts that source this file,
# which a per-file unused-variable check cannot see.
# shellcheck disable=SC2034

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

# The account this lane is expected to run in. The safety story is "this account
# also holds production", so running the scripts anywhere else is a mistake
# worth stopping on. Override deliberately with FLEET_TESTBED_ACCOUNT_ID when
# someone is legitimately using a different account.
EXPECTED_ACCOUNT_ID="${FLEET_TESTBED_ACCOUNT_ID:-157466816238}"

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

require_expected_account() {
  # Everything below assumes production shares this account. Assert it, so the
  # tag/CIDR/default-VPC guards are being applied where they were designed.
  local account
  account=$(aws sts get-caller-identity --query Account --output text) \
    || die "could not read the caller identity; are AWS credentials configured?"
  [ -n "$account" ] && [ "$account" != "None" ] \
    || die "sts get-caller-identity returned no account"
  if [ "$account" != "$EXPECTED_ACCOUNT_ID" ]; then
    die "refusing to run in account ${account}; expected ${EXPECTED_ACCOUNT_ID}. Set FLEET_TESTBED_ACCOUNT_ID=${account} if that is deliberate."
  fi
  ACCOUNT_ID="$account"
}

require_safe_ref() {
  # $1 = label, $2 = value. Values templated into a root-executed user-data
  # script must not be able to close a quote or introduce shell metacharacters,
  # and sed would silently mangle `&` and the `|` delimiter besides. Git refs,
  # release tags, and commit shas all fit inside this class.
  local label="$1" value="$2"
  [ -n "$value" ] || die "${label} is empty"
  case "$value" in
    *[!A-Za-z0-9._/@+-]*) die "${label} contains characters that are unsafe to template into user-data: ${value}" ;;
  esac
  case "$value" in
    -*) die "${label} must not start with a dash: ${value}" ;;
  esac
}

require_positive_int() {
  local label="$1" value="$2"
  case "$value" in
    ''|*[!0-9]*) die "${label} must be a positive integer, got: ${value}" ;;
  esac
  [ "$value" -gt 0 ] || die "${label} must be greater than zero"
}

find_testbed_vpc() {
  # Echoes the testbed VPC id, or nothing when it does not exist yet. Three
  # independent predicates, not one applied twice: the project tag, an exact
  # match on the dedicated CIDR (EC2's `cidr` filter is an exact primary-CIDR
  # match), and IsDefault=false, because production lives in the default VPC.
  # Anything other than exactly one match is an error rather than a pick.
  local rows count vpc_id cidr is_default
  rows=$(aws ec2 describe-vpcs \
    --filters "Name=tag:${TAG_KEY},Values=${TAG_VALUE}" \
              "Name=cidr,Values=${VPC_CIDR}" \
              "Name=is-default,Values=false" \
    --query 'Vpcs[].[VpcId,CidrBlock,IsDefault]' --output text)

  rows=$(printf '%s\n' "$rows" | grep -v '^[[:space:]]*$' || true)
  [ -n "$rows" ] || return 0

  count=$(printf '%s\n' "$rows" | wc -l | tr -d '[:space:]')
  [ "$count" = "1" ] \
    || die "expected exactly one VPC tagged ${TAG_KEY}=${TAG_VALUE} with CIDR ${VPC_CIDR}, found ${count}; resolve by hand before running anything destructive"

  read -r vpc_id cidr is_default <<<"$rows"

  # Re-assert on the returned attributes rather than trusting the filters alone.
  case "$vpc_id" in vpc-*) ;; *) die "unexpected VPC id: ${vpc_id}" ;; esac
  [ "$cidr" = "$VPC_CIDR" ] || die "VPC ${vpc_id} has CIDR ${cidr}, expected ${VPC_CIDR}"
  case "$is_default" in
    [Ff]alse) ;;
    *) die "VPC ${vpc_id} reports IsDefault=${is_default}; the default VPC holds production and is never a teardown target" ;;
  esac

  echo "$vpc_id"
}
