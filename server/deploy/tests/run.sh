#!/usr/bin/env bash
#
# Deploy-layer test suite for the self-hosted installer, preflight, doctor,
# profile mechanism, release packaging, and the AWS template.
#
# No Docker or network required. Uses file:// "releases" and fake uname/docker
# binaries on PATH so the installer's real control flow runs on any dev box or
# CI runner. Requires: bash, curl, tar, sha256sum, awk, sed, shellcheck
# (for the lint stage). Set PROLIFERATE_TEST_AWS=1 to also run
# `aws cloudformation validate-template` against the AWS template.
#
# Usage: server/deploy/tests/run.sh

set -uo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$TESTS_DIR/.." && pwd)"
REPO_ROOT="$(cd "$DEPLOY_DIR/../.." && pwd)"
AWS_DIR="$REPO_ROOT/server/infra/self-hosted-aws"
AWS_TEMPLATE="$AWS_DIR/template.yaml"

PASS=0
FAIL=0
ok() {
  PASS=$((PASS + 1))
  printf '  ok    %s\n' "$*"
}
no() {
  FAIL=$((FAIL + 1))
  printf '  FAIL  %s\n' "$*"
}
group() { printf '\n== %s ==\n' "$*"; }

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/proliferate-deploy-tests.XXXXXX")"
cleanup() { rm -rf "$SCRATCH"; }
trap cleanup EXIT

# --- fixtures ----------------------------------------------------------------

# fake_bin_dir: a PATH dir with uname (Linux/x86_64) and docker (all ok) stubs
# so the installer's host checks pass on a non-Linux dev box.
FAKE_BIN=""
make_fake_bin() {
  FAKE_BIN="$SCRATCH/fakebin"
  mkdir -p "$FAKE_BIN"
  cat >"$FAKE_BIN/uname" <<'EOF'
#!/bin/sh
case "$1" in -s) echo Linux ;; -m) echo x86_64 ;; *) echo Linux ;; esac
EOF
  cat >"$FAKE_BIN/docker" <<'EOF'
#!/bin/sh
exit 0
EOF
  chmod +x "$FAKE_BIN/uname" "$FAKE_BIN/docker"
}

# make_release <releases-root> <version>: build a file:// "release" carrying a
# real deploy bundle + checksums, plus a releases.json that also lists
# non-server tags (to prove server-v* selection ignores them).
make_release() {
  local relroot="$1" version="$2"
  local dl="$relroot/download/server-v$version"
  mkdir -p "$dl"
  local staging="$SCRATCH/stage-$version"
  mkdir -p "$staging/proliferate-deploy"
  cp -R "$DEPLOY_DIR/." "$staging/proliferate-deploy/"
  rm -rf "$staging/proliferate-deploy/smoke" "$staging/proliferate-deploy/tests"
  printf '%s\n' "$version" >"$staging/proliferate-deploy/VERSION"
  tar czf "$dl/proliferate-deploy.tar.gz" -C "$staging" proliferate-deploy
  ( cd "$dl" && sha256sum proliferate-deploy.tar.gz >self-hosted-assets.SHA256SUMS )
  cat >"$relroot/releases.json" <<EOF
[{"tag_name":"runtime-v9.9.9"},{"tag_name":"desktop-v9.9.9"},{"tag_name":"proliferate-v9.9.9"},{"tag_name":"server-v0.0.9"},{"tag_name":"server-v$version"}]
EOF
  rm -rf "$staging"
}

run_installer() {
  # run_installer <install-root> <releases-root> <version> [extra args...]
  local root="$1" relroot="$2" version="$3"
  shift 3
  PATH="$FAKE_BIN:$PATH" \
    PROLIFERATE_INSTALL_ROOT="$root" \
    PROLIFERATE_RELEASE_API="file://$relroot/releases.json" \
    PROLIFERATE_RELEASE_DOWNLOAD_BASE="file://$relroot/download" \
    bash "$DEPLOY_DIR/install.sh" "$@"
}

# ---------------------------------------------------------------------------
group "1. Lint (bash -n + shellcheck)"
# ---------------------------------------------------------------------------
lint_targets=(
  "$DEPLOY_DIR/common.sh"
  "$DEPLOY_DIR/preflight.sh"
  "$DEPLOY_DIR/install.sh"
  "$DEPLOY_DIR/doctor.sh"
  "$DEPLOY_DIR/bootstrap.sh"
  "$DEPLOY_DIR/update.sh"
  "$DEPLOY_DIR/ensure-secrets.sh"
  "$DEPLOY_DIR/install-runtime.sh"
  "$DEPLOY_DIR/registry-login.sh"
  "$DEPLOY_DIR/wait-for-health.sh"
  "$AWS_DIR/launch-stack.sh"
)
for f in "${lint_targets[@]}"; do
  if bash -n "$f" 2>/dev/null; then ok "bash -n $(basename "$f")"; else no "bash -n $(basename "$f")"; fi
done
if command -v shellcheck >/dev/null 2>&1; then
  if shellcheck -x --severity=warning "${lint_targets[@]}" >/dev/null 2>&1; then
    ok "shellcheck (severity>=warning) clean"
  else
    no "shellcheck found warnings/errors"
    shellcheck -x --severity=warning "${lint_targets[@]}" 2>&1 | sed 's/^/      /' | head -30
  fi
else
  printf '  skip  shellcheck not installed\n'
fi

# ---------------------------------------------------------------------------
group "2. Profile mechanism + version sort (common.sh)"
# ---------------------------------------------------------------------------
# shellcheck source=server/deploy/common.sh
. "$DEPLOY_DIR/common.sh"

env_off="$SCRATCH/off.env"
printf 'AGENT_GATEWAY_ENABLED=false\n' >"$env_off"
[[ -z "$(proliferate_enabled_profiles "$env_off")" ]] && ok "gateway off -> no profiles" || no "gateway off -> expected no profiles"

env_on="$SCRATCH/on.env"
printf 'AGENT_GATEWAY_ENABLED=true\n' >"$env_on"
[[ "$(proliferate_enabled_profiles "$env_on")" == "agent-gateway" ]] && ok "gateway on -> agent-gateway profile" || no "gateway on -> expected agent-gateway"

args="$(proliferate_profile_args "$env_on" | tr '\n' ' ')"
[[ "$args" == "--profile agent-gateway " ]] && ok "profile args formatted for gateway" || no "profile args wrong: '$args'"
[[ -z "$(proliferate_profile_args "$env_off")" ]] && ok "profile args empty when off" || no "profile args should be empty when off"

mv="$(printf '0.3.2\n0.3.18\n0.10.0\n2.0.0\n0.3.9\n' | proliferate_max_version)"
[[ "$mv" == "2.0.0" ]] && ok "max_version picks 2.0.0" || no "max_version wrong: $mv"
mv2="$(printf '0.3.2\n0.3.18\n0.3.9\n' | proliferate_max_version)"
[[ "$mv2" == "0.3.18" ]] && ok "max_version numeric (0.3.18 > 0.3.9)" || no "max_version numeric wrong: $mv2"

# ---------------------------------------------------------------------------
group "3. Preflight (partial-config guard)"
# ---------------------------------------------------------------------------
pf() { "$DEPLOY_DIR/preflight.sh" "$1" >/dev/null 2>&1; }
t="$SCRATCH/pf.env"

printf 'SITE_ADDRESS=api.example.com\nE2B_API_KEY=\nE2B_TEMPLATE_NAME=\n' >"$t"
pf "$t" && ok "valid base config passes" || no "valid base config should pass"

printf 'SITE_ADDRESS=api.example.com\nE2B_API_KEY=k\nE2B_TEMPLATE_NAME=\n' >"$t"
pf "$t" && no "E2B key without template should BLOCK" || ok "E2B key without template blocks (crash-loop guard)"

printf 'SITE_ADDRESS=api.example.com\nE2B_API_KEY=k\nE2B_TEMPLATE_NAME=t/x:production\n' >"$t"
pf "$t" && ok "complete E2B pair passes" || no "complete E2B pair should pass"

printf 'SITE_ADDRESS=api.example.com\nAGENT_GATEWAY_ENABLED=true\nLITELLM_MASTER_KEY=a\nAGENT_GATEWAY_LITELLM_MASTER_KEY=b\nLITELLM_POSTGRES_PASSWORD=p\n' >"$t"
pf "$t" && no "gateway master-key mismatch should BLOCK" || ok "gateway master-key mismatch blocks"

printf 'PROLIFERATE_USE_SSLIP_FALLBACK=false\n' >"$t"
pf "$t" && no "missing SITE_ADDRESS should BLOCK" || ok "missing SITE_ADDRESS blocks"

printf 'SITE_ADDRESS=api.example.com\nTYPOKEY_XYZ=1\n' >"$t"
# Capture to a var (not `| grep -q`): grep -q closes the pipe on first match,
# which SIGPIPEs preflight and, under `set -o pipefail`, would fail the pipeline.
pfout="$("$DEPLOY_DIR/preflight.sh" "$t" 2>&1 || true)"
echo "$pfout" | grep -q "Unknown config key 'TYPOKEY_XYZ'" && ok "unknown key warns" || no "unknown key should warn"
pf "$t" && ok "unknown key is a warning, not a block" || no "unknown key should not block"

# ---------------------------------------------------------------------------
group "4. Installer: release selection + fetch + verify"
# ---------------------------------------------------------------------------
make_fake_bin
REL="$SCRATCH/rel"
make_release "$REL" "0.3.18"

# Dry run resolves the newest server-v* (0.3.18), NOT runtime/desktop/proliferate 9.9.9.
out="$(run_installer "$SCRATCH/inst-dry" "$REL" "0.3.18" --domain api.test --dry-run --yes 2>&1)"
echo "$out" | grep -q "server-v0.3.18" && ok "resolves newest server-v* (ignores runtime/desktop/proliferate tags)" || { no "release selection wrong"; echo "$out" | sed 's/^/      /'; }

# Real (--no-start) install: fetch + checksum verify + extract + configure.
INST="$SCRATCH/inst"
if run_installer "$INST" "$REL" "0.3.18" --domain api.test --no-start --yes >"$SCRATCH/inst.log" 2>&1; then
  ok "installer runs (fetch+verify+extract+configure, --no-start)"
else
  no "installer failed"
  sed 's/^/      /' "$SCRATCH/inst.log" | tail -20
fi
DD="$INST/server/deploy"
[[ -f "$DD/bootstrap.sh" && -f "$DD/common.sh" && -f "$DD/preflight.sh" && -f "$DD/doctor.sh" ]] && ok "bundle scripts installed to durable dir" || no "bundle scripts missing from $DD"
[[ -x "$DD/bootstrap.sh" ]] && ok "installed bootstrap.sh is executable" || no "installed bootstrap.sh not executable"
grep -q "^SITE_ADDRESS=api.test$" "$DD/.env.static" && ok ".env.static generated with SITE_ADDRESS" || no ".env.static SITE_ADDRESS wrong"
grep -q "^PROLIFERATE_SERVER_IMAGE_TAG=0.3.18$" "$DD/.env.static" && ok "image tag pinned to resolved version" || no "image tag not pinned"
[[ "$(cat "$DD/.installed-version")" == "0.3.18" ]] && ok "installed version recorded" || no "installed version not recorded"
# Secrets NOT written by the installer.
[[ -z "$(grep '^JWT_SECRET=' "$DD/.env.static" | cut -d= -f2)" ]] && ok "installer leaves secrets blank (bootstrap generates them)" || no "installer wrote a secret value"

# ---------------------------------------------------------------------------
group "5. Installer: idempotent rerun preserves operator config"
# ---------------------------------------------------------------------------
printf '\n# operator edit\nADMIN_EMAILS=boss@example.com\n' >>"$DD/.env.static"
if run_installer "$INST" "$REL" "0.3.18" --domain api.test --no-start --yes >"$SCRATCH/rerun.log" 2>&1; then
  ok "rerun succeeds"
else
  no "rerun failed"
  sed 's/^/      /' "$SCRATCH/rerun.log" | tail -20
fi
grep -q "^ADMIN_EMAILS=boss@example.com$" "$DD/.env.static" && ok "operator edit preserved on rerun" || no "rerun clobbered operator config"

# ---------------------------------------------------------------------------
group "6. Installer: checksum failure aborts before extraction"
# ---------------------------------------------------------------------------
BADREL="$SCRATCH/badrel"
make_release "$BADREL" "0.3.18"
# Corrupt the bundle so its sha no longer matches the published SHA256SUMS.
printf 'corruption' >>"$BADREL/download/server-v0.3.18/proliferate-deploy.tar.gz"
BADINST="$SCRATCH/badinst"
if run_installer "$BADINST" "$BADREL" "0.3.18" --domain api.test --no-start --yes >"$SCRATCH/bad.log" 2>&1; then
  no "installer should have FAILED on checksum mismatch"
else
  ok "installer aborts on checksum mismatch"
fi
[[ ! -f "$BADINST/server/deploy/bootstrap.sh" ]] && ok "no files extracted after checksum failure" || no "files were extracted despite checksum failure"
grep -qi "checksum" "$SCRATCH/bad.log" && ok "checksum failure is reported" || no "checksum failure not reported"

# ---------------------------------------------------------------------------
group "7. Installer: unsupported system + partial-config guard"
# ---------------------------------------------------------------------------
# Fake a non-Linux OS.
MACBIN="$SCRATCH/macbin"
mkdir -p "$MACBIN"
cat >"$MACBIN/uname" <<'EOF'
#!/bin/sh
case "$1" in -s) echo Darwin ;; -m) echo arm64 ;; *) echo Darwin ;; esac
EOF
cat >"$MACBIN/docker" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "$MACBIN/uname" "$MACBIN/docker"
if PATH="$MACBIN:$PATH" PROLIFERATE_INSTALL_ROOT="$SCRATCH/mac" \
  PROLIFERATE_RELEASE_API="file://$REL/releases.json" \
  PROLIFERATE_RELEASE_DOWNLOAD_BASE="file://$REL/download" \
  bash "$DEPLOY_DIR/install.sh" --domain api.test --no-start --yes >"$SCRATCH/mac.log" 2>&1; then
  no "installer should refuse a non-Linux OS"
else
  grep -qi "unsupported OS" "$SCRATCH/mac.log" && ok "installer refuses non-Linux OS" || no "wrong error for non-Linux OS"
fi

# Partial config on an EXISTING install: seed a bad .env.static, rerun -> the
# installer's preflight must block before starting.
PARTIAL="$SCRATCH/partial"
run_installer "$PARTIAL" "$REL" "0.3.18" --domain api.test --no-start --yes >/dev/null 2>&1
printf 'E2B_API_KEY=leaks-without-template\n' >>"$PARTIAL/server/deploy/.env.static"
if run_installer "$PARTIAL" "$REL" "0.3.18" --domain api.test --yes >"$SCRATCH/partial.log" 2>&1; then
  no "installer should block a partial E2B config before starting"
else
  grep -qi "preflight" "$SCRATCH/partial.log" && ok "installer blocks partial config before start" || no "partial config not blocked by preflight"
fi

# ---------------------------------------------------------------------------
group "8. Release bundle shape + checksum round-trip"
# ---------------------------------------------------------------------------
# Rebuild the bundle exactly like server-ci and assert its shape.
BUNDLE_ROOT="$SCRATCH/bundle"
mkdir -p "$BUNDLE_ROOT/proliferate-deploy"
cp -R "$DEPLOY_DIR/." "$BUNDLE_ROOT/proliferate-deploy/"
rm -rf "$BUNDLE_ROOT/proliferate-deploy/smoke" "$BUNDLE_ROOT/proliferate-deploy/tests"
printf '0.3.18\n' >"$BUNDLE_ROOT/proliferate-deploy/VERSION"
tar czf "$SCRATCH/proliferate-deploy.tar.gz" -C "$BUNDLE_ROOT" proliferate-deploy
members="$(tar tzf "$SCRATCH/proliferate-deploy.tar.gz")"
for want in proliferate-deploy/bootstrap.sh proliferate-deploy/update.sh proliferate-deploy/common.sh proliferate-deploy/preflight.sh proliferate-deploy/doctor.sh proliferate-deploy/install.sh proliferate-deploy/docker-compose.production.yml proliferate-deploy/Caddyfile proliferate-deploy/.env.production.example proliferate-deploy/VERSION; do
  echo "$members" | grep -qx "$want" && ok "bundle contains $(basename "$want")" || no "bundle missing $want"
done
echo "$members" | grep -q 'proliferate-deploy/smoke/' && no "bundle should NOT contain smoke/" || ok "bundle excludes smoke/"
echo "$members" | grep -q 'proliferate-deploy/tests/' && no "bundle should NOT contain tests/" || ok "bundle excludes tests/"
( cd "$SCRATCH" && sha256sum proliferate-deploy.tar.gz >sums && sha256sum -c --ignore-missing sums >/dev/null 2>&1 ) \
  && ok "checksum round-trips (sha256sum -c)" || no "checksum round-trip failed"

# Executable-bit invariant on the checked-in scripts (the bundle preserves the
# git mode, so this is what makes ./bootstrap.sh runnable after extraction).
for s in bootstrap.sh update.sh ensure-secrets.sh install-runtime.sh registry-login.sh wait-for-health.sh preflight.sh doctor.sh install.sh; do
  if [[ -x "$DEPLOY_DIR/$s" ]]; then ok "$s is executable"; else no "$s is NOT executable (git mode must be 0755)"; fi
done

# ---------------------------------------------------------------------------
group "9. AWS template"
# ---------------------------------------------------------------------------
bytes="$(wc -c <"$AWS_TEMPLATE")"
[[ "$bytes" -lt 51200 ]] && ok "template is $bytes bytes (< 51200 CFN inline limit)" || no "template too large for inline CFN: $bytes bytes"
grep -q "fetch_bundle:" "$AWS_TEMPLATE" && ok "template fetches the deploy bundle (no embedded script copies)" || no "template missing fetch_bundle"
grep -q "sha256sum -c --ignore-missing" "$AWS_TEMPLATE" && ok "template verifies the bundle checksum" || no "template missing checksum verification"
grep -q "docker-compose.production.yml:" "$AWS_TEMPLATE" && no "template still embeds docker-compose (drift)" || ok "template no longer embeds docker-compose"
grep -q "DeployBundleUrl" "$AWS_TEMPLATE" && ok "template exposes DeployBundleUrl override" || no "template missing DeployBundleUrl override"
if [[ "${PROLIFERATE_TEST_AWS:-0}" == "1" ]] && command -v aws >/dev/null 2>&1; then
  if aws cloudformation validate-template --template-body "file://$AWS_TEMPLATE" >/dev/null 2>&1; then
    ok "aws cloudformation validate-template passed"
  else
    no "aws cloudformation validate-template failed"
  fi
else
  printf '  skip  aws validate-template (set PROLIFERATE_TEST_AWS=1 with creds to run)\n'
fi

# ---------------------------------------------------------------------------
printf '\n== Summary ==\n  %d passed, %d failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
