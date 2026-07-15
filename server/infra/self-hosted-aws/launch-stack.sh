#!/usr/bin/env bash
#
# Launch (or update) the Proliferate self-hosted control plane on AWS with one
# real command. Resolves a server-v* release, downloads and checksum-verifies
# the published CloudFormation template from that release, validates it, and
# runs `aws cloudformation deploy`. No monorepo clone required.
#
# INSPECT FIRST (recommended):
#   curl -fsSLO https://raw.githubusercontent.com/proliferate-ai/proliferate/main/server/infra/self-hosted-aws/launch-stack.sh
#   less launch-stack.sh
#   bash launch-stack.sh --eval
#
# EVALUATION (no domain; sslip.io host from the Elastic IP, real TLS):
#   bash launch-stack.sh --eval
#
# REAL DOMAIN:
#   bash launch-stack.sh --site-address api.company.com \
#     --github-oauth-client-id XXX --github-oauth-client-secret YYY
#
# Requires: aws CLI (configured), curl, sha256sum, tar.

set -euo pipefail

REPO_SLUG="${PROLIFERATE_REPO:-proliferate-ai/proliferate}"
RELEASE_API="${PROLIFERATE_RELEASE_API:-https://api.github.com/repos/${REPO_SLUG}/releases}"
DOWNLOAD_BASE="${PROLIFERATE_RELEASE_DOWNLOAD_BASE:-https://github.com/${REPO_SLUG}/releases/download}"

STACK_NAME="proliferate-self-hosted"
VERSION=""
SITE_ADDRESS=""
EVAL_MODE=0
INSTANCE_TYPE="t4g.small"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"
GH_CLIENT_ID=""
GH_CLIENT_SECRET=""
E2B_API_KEY=""
E2B_TEMPLATE_NAME=""
DRY_RUN=0
declare -a EXTRA_PARAMS=()

usage() {
  cat <<'USAGE'
Proliferate self-hosted AWS launch

Usage: launch-stack.sh [options]

Options:
  --stack-name NAME              CloudFormation stack name (default: proliferate-self-hosted).
  --version X.Y.Z                Server release to launch (default: newest server-v*).
  --site-address HOST            Public hostname (required unless --eval).
  --eval                         No domain; sslip.io host from the Elastic IP.
  --instance-type TYPE           t4g.small | t4g.medium | t4g.large (default: t4g.small).
  --region REGION                AWS region (default: from your AWS config).
  --github-oauth-client-id ID    GitHub OAuth client id (optional).
  --github-oauth-client-secret S GitHub OAuth client secret (optional).
  --e2b-api-key KEY              E2B API key (optional; requires --e2b-template-name).
  --e2b-template-name REF        E2B template ref (optional; requires --e2b-api-key).
  --param Key=Value              Pass an extra template parameter (repeatable).
  --dry-run                      Resolve + validate the template, do not deploy.
  -h, --help                     Show this help.
USAGE
}

die() {
  echo "launch-stack: $*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stack-name) STACK_NAME="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --site-address) SITE_ADDRESS="$2"; shift 2 ;;
    --eval | --evaluation) EVAL_MODE=1; shift ;;
    --instance-type) INSTANCE_TYPE="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    --github-oauth-client-id) GH_CLIENT_ID="$2"; shift 2 ;;
    --github-oauth-client-secret) GH_CLIENT_SECRET="$2"; shift 2 ;;
    --e2b-api-key) E2B_API_KEY="$2"; shift 2 ;;
    --e2b-template-name) E2B_TEMPLATE_NAME="$2"; shift 2 ;;
    --param) EXTRA_PARAMS+=("$2"); shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) die "unknown option: $1 (use --help)" ;;
  esac
done

command -v aws >/dev/null 2>&1 || die "the AWS CLI is required and must be configured."
for tool in curl sha256sum tar; do
  command -v "$tool" >/dev/null 2>&1 || die "'$tool' is required."
done

if [[ "$EVAL_MODE" -eq 1 && -n "$SITE_ADDRESS" ]]; then
  die "--eval and --site-address are mutually exclusive."
fi
if [[ "$EVAL_MODE" -eq 0 && -z "$SITE_ADDRESS" ]]; then
  die "pass --site-address HOST, or --eval for an sslip.io evaluation host."
fi
if { [[ -n "$E2B_API_KEY" && -z "$E2B_TEMPLATE_NAME" ]] || [[ -z "$E2B_API_KEY" && -n "$E2B_TEMPLATE_NAME" ]]; }; then
  die "--e2b-api-key and --e2b-template-name must be set together (or both omitted)."
fi

REGION_ARGS=()
[[ -n "$REGION" ]] && REGION_ARGS=(--region "$REGION")

# max_version / latest_server_version: same server-v* resolution as install.sh;
# never GitHub's generic /releases/latest.
max_version() {
  awk '{ split($0,a,"."); maj=a[1]+0; min=a[2]+0; pat=a[3]; sub(/[^0-9].*/,"",pat); pat=pat+0;
         key=maj*1000000+min*1000+pat; if (best=="" || key>best){best=key; bestline=$0} }
       END { if (bestline!="") print bestline }'
}
latest_server_version() {
  local json version
  json="$(curl -fsSL -H 'Accept: application/vnd.github+json' "${RELEASE_API}?per_page=100" 2>/dev/null)" || return 1
  version="$(printf '%s\n' "$json" \
    | grep -oE '"tag_name":[[:space:]]*"server-v[0-9][0-9A-Za-z.-]*"' \
    | sed -E 's/.*"server-v([0-9][0-9A-Za-z.-]*)".*/\1/' | max_version)"
  [[ -n "$version" ]] || return 1
  printf '%s' "$version"
}

if [[ -n "$VERSION" ]]; then
  VERSION="${VERSION#server-v}"; VERSION="${VERSION#v}"
else
  echo "==> Resolving newest server-v* release"
  VERSION="$(latest_server_version || true)"
  [[ -n "$VERSION" ]] || die "could not resolve a server-v* release. Pass --version X.Y.Z."
fi
echo "    Using server-v$VERSION"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
base="${DOWNLOAD_BASE}/server-v${VERSION}"

echo "==> Downloading + verifying the CloudFormation template"
curl -fsSL "$base/proliferate-self-hosted-aws-template.yaml" -o "$TMP/template.yaml" \
  || die "failed to download the template from $base/proliferate-self-hosted-aws-template.yaml"
curl -fsSL "$base/self-hosted-assets.SHA256SUMS" -o "$TMP/self-hosted-assets.SHA256SUMS" \
  || die "failed to download the checksum file."
( cd "$TMP" && sha256sum -c --ignore-missing self-hosted-assets.SHA256SUMS ) \
  || die "checksum verification FAILED for proliferate-self-hosted-aws-template.yaml."
echo "    Checksum OK"

echo "==> Validating the template"
aws cloudformation validate-template "${REGION_ARGS[@]}" \
  --template-body "file://$TMP/template.yaml" >/dev/null \
  || die "aws cloudformation validate-template rejected the template."
echo "    Template valid"

PARAMS=("ReleaseVersion=$VERSION" "InstanceType=$INSTANCE_TYPE")
if [[ "$EVAL_MODE" -eq 1 ]]; then
  PARAMS+=("UseSslipFallback=true")
else
  PARAMS+=("SiteAddress=$SITE_ADDRESS")
fi
[[ -n "$GH_CLIENT_ID" ]] && PARAMS+=("GitHubOAuthClientId=$GH_CLIENT_ID")
[[ -n "$GH_CLIENT_SECRET" ]] && PARAMS+=("GitHubOAuthClientSecret=$GH_CLIENT_SECRET")
[[ -n "$E2B_API_KEY" ]] && PARAMS+=("E2BApiKey=$E2B_API_KEY")
[[ -n "$E2B_TEMPLATE_NAME" ]] && PARAMS+=("E2BTemplateName=$E2B_TEMPLATE_NAME")
if ((${#EXTRA_PARAMS[@]})); then
  PARAMS+=("${EXTRA_PARAMS[@]}")
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "==> Dry run. Would deploy stack '$STACK_NAME' with parameters:"
  printf '      %s\n' "${PARAMS[@]}"
  exit 0
fi

echo "==> Deploying stack '$STACK_NAME' (this creates AWS resources and may take several minutes)"
aws cloudformation deploy "${REGION_ARGS[@]}" \
  --stack-name "$STACK_NAME" \
  --template-file "$TMP/template.yaml" \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides "${PARAMS[@]}"

echo "==> Stack outputs"
aws cloudformation describe-stacks "${REGION_ARGS[@]}" \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs[].{Key:OutputKey,Value:OutputValue}' \
  --output table || true

cat <<'EOF'

Next:
  1. Open the SetupClaimUrl output in a browser.
  2. Read the one-time setup token with the ReadSetupTokenCommand output.
  3. Create the admin account, then point the desktop app at the BaseUrl.
EOF
