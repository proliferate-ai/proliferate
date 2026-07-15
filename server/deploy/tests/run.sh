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

env_e2b_partial="$SCRATCH/e2b-partial.env"
printf 'E2B_API_KEY=k\nE2B_TEMPLATE_NAME=\n' >"$env_e2b_partial"
[[ -z "$(proliferate_enabled_profiles "$env_e2b_partial")" ]] && ok "E2B key without template -> no cloud-workspaces profile" || no "half-configured E2B should not enable the profile"

env_e2b_complete="$SCRATCH/e2b-complete.env"
printf 'E2B_API_KEY=k\nE2B_TEMPLATE_NAME=t/x:production\n' >"$env_e2b_complete"
[[ "$(proliferate_enabled_profiles "$env_e2b_complete")" == "cloud-workspaces" ]] && ok "complete E2B pair -> cloud-workspaces profile" || no "complete E2B pair -> expected cloud-workspaces"

env_both="$SCRATCH/both.env"
printf 'AGENT_GATEWAY_ENABLED=true\nE2B_API_KEY=k\nE2B_TEMPLATE_NAME=t/x:production\n' >"$env_both"
[[ "$(proliferate_enabled_profiles "$env_both")" == "agent-gateway cloud-workspaces" ]] && ok "gateway + cloud both on -> both profiles" || no "expected both profiles: got '$(proliferate_enabled_profiles "$env_both")'"

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

# -- gateway: enabled but no provider key -> BLOCK (litellm would have no
# models to serve). Master key pair + PG password + public URL all present so
# only the missing-provider-key case is under test.
printf 'SITE_ADDRESS=api.example.com\nAGENT_GATEWAY_ENABLED=true\nLITELLM_MASTER_KEY=a\nAGENT_GATEWAY_LITELLM_MASTER_KEY=a\nLITELLM_POSTGRES_PASSWORD=p\nAGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL=https://api.example.com/llm\n' >"$t"
pf "$t" && no "gateway with no provider key should BLOCK" || ok "gateway with no provider key blocks"

# -- gateway: fully consistent config (matching keys + a provider key) -> pass.
printf 'SITE_ADDRESS=api.example.com\nAGENT_GATEWAY_ENABLED=true\nLITELLM_MASTER_KEY=a\nAGENT_GATEWAY_LITELLM_MASTER_KEY=a\nLITELLM_POSTGRES_PASSWORD=p\nAGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL=https://api.example.com/llm\nANTHROPIC_API_KEY=sk-ant-x\n' >"$t"
pf "$t" && ok "fully consistent gateway config passes" || no "fully consistent gateway config should pass"

# -- cloud workspaces: complete E2B pair with no REDBEAT_REDIS_URL -> warns,
# does not block (materialization degrades to a 503, it does not crash-loop).
printf 'SITE_ADDRESS=api.example.com\nE2B_API_KEY=k\nE2B_TEMPLATE_NAME=t/x:production\nREDBEAT_REDIS_URL=\n' >"$t"
pfout="$("$DEPLOY_DIR/preflight.sh" "$t" 2>&1 || true)"
echo "$pfout" | grep -q "REDBEAT_REDIS_URL is empty" && ok "cloud workspaces with empty REDBEAT_REDIS_URL warns" || no "expected a REDBEAT_REDIS_URL warning"
pf "$t" && ok "empty REDBEAT_REDIS_URL does not block" || no "empty REDBEAT_REDIS_URL should not block"

# -- SSO: enabled but missing client secret and no endpoint source -> BLOCK.
printf 'SITE_ADDRESS=api.example.com\nSSO_ENABLED=true\nSSO_OIDC_CLIENT_ID=abc\n' >"$t"
pf "$t" && no "incomplete SSO config should BLOCK" || ok "incomplete SSO config blocks"

# -- SSO: complete public-client config (token endpoint auth method "none"
# needs no client secret) with an admin floor set -> pass, no lockout warning.
printf 'SITE_ADDRESS=api.example.com\nSSO_ENABLED=true\nSSO_OIDC_CLIENT_ID=abc\nSSO_OIDC_ISSUER_URL=https://idp.example.com\nSSO_OIDC_TOKEN_ENDPOINT_AUTH_METHOD=none\nADMIN_EMAILS=admin@example.com\n' >"$t"
pf "$t" && ok "complete public-client SSO config passes" || no "complete public-client SSO config should pass"

# -- SSO: complete config, default JIT policy, no ADMIN_EMAILS floor -> warns
# about a first-user lockout but does not block.
printf 'SITE_ADDRESS=api.example.com\nSSO_ENABLED=true\nSSO_OIDC_CLIENT_ID=abc\nSSO_OIDC_CLIENT_SECRET=shh\nSSO_OIDC_ISSUER_URL=https://idp.example.com\n' >"$t"
pfout="$("$DEPLOY_DIR/preflight.sh" "$t" 2>&1 || true)"
echo "$pfout" | grep -q "No SSO sign-in can create the first user" && ok "SSO first-user-lockout warns" || no "expected a first-user-lockout warning"
pf "$t" && ok "SSO first-user-lockout warning does not block" || no "SSO first-user-lockout warning should not block"

# -- GitHub OAuth: one of client id / secret set -> warns, does not block.
printf 'SITE_ADDRESS=api.example.com\nGITHUB_OAUTH_CLIENT_ID=abc\n' >"$t"
pfout="$("$DEPLOY_DIR/preflight.sh" "$t" 2>&1 || true)"
echo "$pfout" | grep -q "GitHub sign-in stays unavailable" && ok "GitHub OAuth partial config warns" || no "expected a GitHub OAuth partial-config warning"
pf "$t" && ok "GitHub OAuth partial config does not block" || no "GitHub OAuth partial config should not block"

# -- per-section OK lines must not be suppressed by an UNRELATED earlier
# error: missing SITE_ADDRESS still blocks the run, but a fully consistent
# gateway and a complete SSO config must still print their confirmations so
# the operator can tell which sections actually validated.
printf 'AGENT_GATEWAY_ENABLED=true\nLITELLM_MASTER_KEY=a\nAGENT_GATEWAY_LITELLM_MASTER_KEY=a\nLITELLM_POSTGRES_PASSWORD=p\nAGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL=https://api.example.com/llm\nANTHROPIC_API_KEY=sk-ant-x\nSSO_ENABLED=true\nSSO_OIDC_CLIENT_ID=abc\nSSO_OIDC_CLIENT_SECRET=shh\nSSO_OIDC_ISSUER_URL=https://idp.example.com\nADMIN_EMAILS=admin@example.com\n' >"$t"
pfout="$("$DEPLOY_DIR/preflight.sh" "$t" 2>&1 || true)"
echo "$pfout" | grep -q "Agent gateway config is internally consistent" && ok "gateway OK line survives an unrelated error" || no "gateway OK line suppressed by an unrelated error"
echo "$pfout" | grep -q "SSO OIDC config is complete" && ok "SSO OK line survives an unrelated error" || no "SSO OK line suppressed by an unrelated error"
pf "$t" && no "missing SITE_ADDRESS should still BLOCK" || ok "unrelated error still blocks the run"

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
for want in proliferate-deploy/bootstrap.sh proliferate-deploy/update.sh proliferate-deploy/common.sh proliferate-deploy/preflight.sh proliferate-deploy/doctor.sh proliferate-deploy/install.sh proliferate-deploy/docker-compose.production.yml proliferate-deploy/Caddyfile proliferate-deploy/.env.production.example proliferate-deploy/README.md proliferate-deploy/VERSION; do
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
group "10. Compose + Caddy shape (agent-gateway / cloud-workspaces add-ons)"
# ---------------------------------------------------------------------------
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.production.yml"
CADDYFILE="$DEPLOY_DIR/Caddyfile"

grep -q '^  redis:' "$COMPOSE_FILE" && ok "compose defines a redis service" || no "compose missing a redis service"
grep -A3 '^  redis:' "$COMPOSE_FILE" | grep -q 'profiles: \["cloud-workspaces"\]' \
  && ok "redis is behind the cloud-workspaces profile" || no "redis should be profiles: [\"cloud-workspaces\"]"
grep -A10 '^  redis:' "$COMPOSE_FILE" | grep -q 'redis-cli' \
  && ok "redis has a healthcheck" || no "redis missing a healthcheck"

grep -q '^  litellm:' "$COMPOSE_FILE" && ok "compose defines a litellm service" || no "compose missing a litellm service"
grep -A5 '^  litellm:' "$COMPOSE_FILE" | grep -q 'profiles: \["agent-gateway"\]' \
  && ok "litellm is behind the agent-gateway profile" || no "litellm should be profiles: [\"agent-gateway\"]"
grep -A20 '^  litellm:' "$COMPOSE_FILE" | grep -q 'health/liveliness' \
  && ok "litellm has a healthcheck" || no "litellm missing a healthcheck"

grep -q 'GITHUB_APP_PRIVATE_KEY_HOST_PATH' "$COMPOSE_FILE" \
  && ok "api mounts the GitHub App secrets directory" || no "api missing the GitHub App secrets mount"

# The /llm handle_path must come before the default handle so Caddy's
# first-match-wins evaluation routes /llm/* to litellm instead of the api.
llm_line="$(grep -n 'handle_path /llm' "$CADDYFILE" | head -1 | cut -d: -f1)"
default_line="$(grep -n 'handle {' "$CADDYFILE" | head -1 | cut -d: -f1)"
[[ -n "$llm_line" ]] && ok "Caddyfile has a /llm route" || no "Caddyfile missing the /llm route"
[[ -n "$default_line" ]] && ok "Caddyfile has a default handle route" || no "Caddyfile missing the default handle route"
if [[ -n "$llm_line" && -n "$default_line" ]]; then
  [[ "$llm_line" -lt "$default_line" ]] && ok "/llm route precedes the default route" || no "/llm route must precede the default route (first match wins)"
fi
grep -q 'reverse_proxy litellm:4000' "$CADDYFILE" && ok "/llm proxies to litellm:4000" || no "/llm route does not proxy to litellm:4000"
grep -q 'reverse_proxy api:8000' "$CADDYFILE" && ok "default route still proxies to api:8000" || no "default route does not proxy to api:8000"

# common.sh profile mechanism agrees with the compose file's profile names.
grep -q '"cloud-workspaces"' "$DEPLOY_DIR/common.sh" && ok "common.sh knows the cloud-workspaces profile name" || no "common.sh missing the cloud-workspaces profile name"

# ---------------------------------------------------------------------------
printf '\n== Summary ==\n  %d passed, %d failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
