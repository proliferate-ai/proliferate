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
  rm -f "$staging/proliferate-deploy/.bootstrap-progress.log"
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

if bash "$TESTS_DIR/bootstrap-markers.sh"; then
  ok "bootstrap markers are ordered, durable across wrapper kill, and stop without completion on failure"
else
  no "bootstrap marker ordering/durability/failure contract regressed"
fi
if bash "$TESTS_DIR/health-wait-bounds.sh"; then
  ok "health checks bound each curl and retain exact local/public failure markers"
else
  no "health-check timeout/deadline contract regressed"
fi

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
group "6b. Installer: --bundle checksum requires the bundle line actually verified"
# ---------------------------------------------------------------------------
# `sha256sum -c --ignore-missing` exits 0 even when NO listed file was checked
# (e.g. a SUMS that only names a versioned filename), which used to let unverified
# bytes through silently. The installer must additionally require the bundle's own
# `proliferate-deploy.tar.gz: OK` line. Build a real local bundle and prove:
#   (a) a SUMS covering the real proliferate-deploy.tar.gz filename -> install passes;
#   (b) a SUMS naming only a versioned/other filename (bundle line absent) -> DIES.
BUNDLE_DIR="$SCRATCH/localbundle"
mkdir -p "$BUNDLE_DIR"
BSTAGE="$SCRATCH/bstage"
mkdir -p "$BSTAGE/proliferate-deploy"
cp -R "$DEPLOY_DIR/." "$BSTAGE/proliferate-deploy/"
rm -rf "$BSTAGE/proliferate-deploy/smoke" "$BSTAGE/proliferate-deploy/tests"
rm -f "$BSTAGE/proliferate-deploy/.bootstrap-progress.log"
printf '0.3.18\n' >"$BSTAGE/proliferate-deploy/VERSION"
tar czf "$BUNDLE_DIR/proliferate-deploy.tar.gz" -C "$BSTAGE" proliferate-deploy
rm -rf "$BSTAGE"

# (a) correct SUMS covering the REAL proliferate-deploy.tar.gz filename -> passes.
( cd "$BUNDLE_DIR" && sha256sum proliferate-deploy.tar.gz >self-hosted-assets.SHA256SUMS )
GOODBUNDLE="$SCRATCH/goodbundle"
if PATH="$FAKE_BIN:$PATH" PROLIFERATE_INSTALL_ROOT="$GOODBUNDLE" \
  bash "$DEPLOY_DIR/install.sh" --bundle "$BUNDLE_DIR/proliferate-deploy.tar.gz" \
  --domain api.test --no-start --yes >"$SCRATCH/goodbundle.log" 2>&1; then
  ok "--bundle install passes with a SUMS covering proliferate-deploy.tar.gz"
else
  no "--bundle install should pass with a correct SUMS"
  sed 's/^/      /' "$SCRATCH/goodbundle.log" | tail -20
fi

# (b) SUMS names only a versioned/other filename (bundle line ABSENT) -> die, do
# not extract. Uses the bundle's real hash so the ONLY difference is the filename.
realsha="$(cd "$BUNDLE_DIR" && sha256sum proliferate-deploy.tar.gz | cut -d' ' -f1)"
VERSIONED_SUMS="$BUNDLE_DIR/versioned.SHA256SUMS"
printf '%s  proliferate-deploy-0.3.18.tar.gz\n' "$realsha" >"$VERSIONED_SUMS"
BADBUNDLE="$SCRATCH/badbundle"
if PATH="$FAKE_BIN:$PATH" PROLIFERATE_INSTALL_ROOT="$BADBUNDLE" \
  bash "$DEPLOY_DIR/install.sh" --bundle "$BUNDLE_DIR/proliferate-deploy.tar.gz" \
  --bundle-sha256sums "$VERSIONED_SUMS" --domain api.test --no-start --yes >"$SCRATCH/badbundle.log" 2>&1; then
  no "--bundle install should DIE when the SUMS omits the bundle line (silent-pass guard)"
else
  ok "--bundle install dies when the SUMS omits the bundle line"
fi
# GNU coreutils exits non-zero itself when --ignore-missing verifies no files,
# while Darwin's sha256sum returns zero and reaches our explicit coverage guard.
# Both safe paths must name the bundle/checksum failure and refuse extraction.
grep -Eqi "did not cover proliferate-deploy.tar.gz|checksum verification FAILED for proliferate-deploy.tar.gz" "$SCRATCH/badbundle.log" \
  && ok "missing-bundle-line failure is reported" || no "missing-bundle-line failure not reported"
[[ ! -f "$BADBUNDLE/server/deploy/bootstrap.sh" ]] \
  && ok "no files extracted when the bundle line is absent" || no "files were extracted despite an unverified bundle"

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
group "7b. Installer: --cors-allow-origins extends the shipped defaults"
# ---------------------------------------------------------------------------
# Operator origins must EXTEND (merge + dedupe), never replace, the shipped
# localhost + Tauri desktop defaults. Install fresh with an operator origin plus
# one that overlaps a shipped default; assert the shipped defaults survive, the
# operator origin is added, and the overlap is deduped to a single entry.
CORSROOT="$SCRATCH/cors"
run_installer "$CORSROOT" "$REL" "0.3.18" --domain api.test --no-start --yes \
  --cors-allow-origins "https://app.corp.example,tauri://localhost" >/dev/null 2>&1
cors_line="$(grep -m1 '^CORS_ALLOW_ORIGINS=' "$CORSROOT/server/deploy/.env.static" | cut -d= -f2-)"
cors_items="$(printf '%s' "$cors_line" | tr ',' '\n')"
echo "$cors_items" | grep -qx "tauri://localhost" && ok "CORS merge keeps a shipped default (tauri://localhost)" || no "CORS merge dropped the shipped tauri default: $cors_line"
echo "$cors_items" | grep -qx "http://localhost:1420" && ok "CORS merge keeps another shipped default (localhost:1420)" || no "CORS merge dropped a shipped default: $cors_line"
echo "$cors_items" | grep -qx "https://app.corp.example" && ok "CORS merge adds the operator origin" || no "CORS merge missing the operator origin: $cors_line"
[[ "$(echo "$cors_items" | grep -cx "tauri://localhost")" -eq 1 ]] && ok "CORS merge dedupes the overlapping default" || no "CORS merge duplicated tauri://localhost: $cors_line"

# A wildcard is refused: the API pairs allow_origins with allow_credentials=true,
# so '*' would reflect any credentialed origin (open CORS on an authed API).
if run_installer "$SCRATCH/cors-wild" "$REL" "0.3.18" --domain api.test --no-start --yes \
  --cors-allow-origins "https://ok.example,*" >"$SCRATCH/cors-wild.log" 2>&1; then
  no "installer should refuse a wildcard CORS origin"
else
  grep -qi "cors-allow-origins must list explicit origins" "$SCRATCH/cors-wild.log" \
    && ok "installer refuses a wildcard CORS origin" || no "wrong error for wildcard CORS origin"
fi

# --cors-allow-origins on a RERUN (an .env.static already exists) is REJECTED,
# not silently ignored: it only merges on a fresh install, so accepting it on a
# rerun would be a misleading no-op (SHR-F03). CORSROOT was installed fresh above.
if run_installer "$CORSROOT" "$REL" "0.3.18" --domain api.test --no-start --yes \
  --cors-allow-origins "https://late.example" >"$SCRATCH/cors-rerun.log" 2>&1; then
  no "installer should reject --cors-allow-origins on a rerun"
else
  grep -qi "cors-allow-origins only applies on a fresh install" "$SCRATCH/cors-rerun.log" \
    && ok "installer rejects --cors-allow-origins on rerun" || no "wrong error for --cors-allow-origins on rerun"
fi
# The rejected rerun must NOT have mutated the preserved CORS config.
rerun_cors="$(grep -m1 '^CORS_ALLOW_ORIGINS=' "$CORSROOT/server/deploy/.env.static" | cut -d= -f2-)"
printf '%s' "$rerun_cors" | tr ',' '\n' | grep -qx "https://late.example" \
  && no "rerun reject must not add the new origin to the preserved config" \
  || ok "rerun reject leaves the preserved CORS config unchanged"

# ---------------------------------------------------------------------------
group "8. Release bundle shape + checksum round-trip"
# ---------------------------------------------------------------------------
# Rebuild the bundle exactly like server-ci and assert its shape.
BUNDLE_ROOT="$SCRATCH/bundle"
mkdir -p "$BUNDLE_ROOT/proliferate-deploy"
cp -R "$DEPLOY_DIR/." "$BUNDLE_ROOT/proliferate-deploy/"
rm -rf "$BUNDLE_ROOT/proliferate-deploy/smoke" "$BUNDLE_ROOT/proliferate-deploy/tests"
rm -f "$BUNDLE_ROOT/proliferate-deploy/.bootstrap-progress.log"
printf '0.3.18\n' >"$BUNDLE_ROOT/proliferate-deploy/VERSION"
tar czf "$SCRATCH/proliferate-deploy.tar.gz" -C "$BUNDLE_ROOT" proliferate-deploy
members="$(tar tzf "$SCRATCH/proliferate-deploy.tar.gz")"
for want in proliferate-deploy/bootstrap.sh proliferate-deploy/update.sh proliferate-deploy/common.sh proliferate-deploy/preflight.sh proliferate-deploy/doctor.sh proliferate-deploy/install.sh proliferate-deploy/docker-compose.production.yml proliferate-deploy/Caddyfile proliferate-deploy/.env.production.example proliferate-deploy/README.md proliferate-deploy/VERSION; do
  echo "$members" | grep -qx "$want" && ok "bundle contains $(basename "$want")" || no "bundle missing $want"
done
echo "$members" | grep -q 'proliferate-deploy/smoke/' && no "bundle should NOT contain smoke/" || ok "bundle excludes smoke/"
echo "$members" | grep -q 'proliferate-deploy/tests/' && no "bundle should NOT contain tests/" || ok "bundle excludes tests/"
echo "$members" | grep -q 'proliferate-deploy/.bootstrap-progress.log' && no "bundle should NOT contain host progress" || ok "bundle excludes host progress"
( cd "$SCRATCH" && sha256sum proliferate-deploy.tar.gz >sums && sha256sum -c --ignore-missing sums >/dev/null 2>&1 ) \
  && ok "checksum round-trips (sha256sum -c)" || no "checksum round-trip failed"

# The CloudFormation qualification transports unreleased runtime bytes through
# private-S3 presigned URLs. install-runtime must match the checksum against the
# URL path basename, not its X-Amz query string.
RUNTIME_FIXTURE_DIR="$SCRATCH/runtime-fixture"
RUNTIME_FIXTURE_ARCHIVE="$SCRATCH/anyharness-aarch64-unknown-linux-musl.tar.gz"
RUNTIME_FIXTURE_SUMS="$SCRATCH/runtime.SHA256SUMS"
RUNTIME_INSTALL_DIR="$SCRATCH/runtime-installed"
RUNTIME_ENV="$SCRATCH/runtime.env"
RUNTIME_FAKE_BIN="$SCRATCH/runtime-fake-bin"
mkdir -p "$RUNTIME_FIXTURE_DIR" "$RUNTIME_INSTALL_DIR" "$RUNTIME_FAKE_BIN"
for binary in anyharness proliferate-worker proliferate-supervisor; do
  printf '#!/bin/sh\nprintf "%s\\n"\n' "$binary" >"$RUNTIME_FIXTURE_DIR/$binary"
  chmod +x "$RUNTIME_FIXTURE_DIR/$binary"
done
tar czf "$RUNTIME_FIXTURE_ARCHIVE" -C "$RUNTIME_FIXTURE_DIR" anyharness proliferate-worker proliferate-supervisor
( cd "$SCRATCH" && sha256sum "$(basename "$RUNTIME_FIXTURE_ARCHIVE")" >"$RUNTIME_FIXTURE_SUMS" )
cat >"$RUNTIME_FAKE_BIN/curl" <<'EOF'
#!/bin/sh
set -eu
url=""
output=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
case "$url" in
  *anyharness-aarch64-unknown-linux-musl.tar.gz*) cp "$RUNTIME_FIXTURE_ARCHIVE" "$output" ;;
  *self-hosted-assets.SHA256SUMS*) cp "$RUNTIME_FIXTURE_SUMS" "$output" ;;
  *) exit 2 ;;
esac
EOF
chmod +x "$RUNTIME_FAKE_BIN/curl"
cat >"$RUNTIME_ENV" <<EOF
CLOUD_RUNTIME_SOURCE_BINARY_PATH=$RUNTIME_INSTALL_DIR/anyharness
CLOUD_WORKER_SOURCE_BINARY_PATH=$RUNTIME_INSTALL_DIR/proliferate-worker
CLOUD_SUPERVISOR_SOURCE_BINARY_PATH=$RUNTIME_INSTALL_DIR/proliferate-supervisor
RUNTIME_BINARY_URL=https://qualification-bucket.s3.us-east-2.amazonaws.com/qualification/run/anyharness-aarch64-unknown-linux-musl.tar.gz?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=test
RUNTIME_BINARY_SHA256_URL=https://qualification-bucket.s3.us-east-2.amazonaws.com/qualification/run/self-hosted-assets.SHA256SUMS?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=test
EOF
if PATH="$RUNTIME_FAKE_BIN:$PATH" \
  RUNTIME_FIXTURE_ARCHIVE="$RUNTIME_FIXTURE_ARCHIVE" \
  RUNTIME_FIXTURE_SUMS="$RUNTIME_FIXTURE_SUMS" \
  PROLIFERATE_ENV_FILE="$RUNTIME_ENV" \
  "$DEPLOY_DIR/install-runtime.sh" >"$SCRATCH/install-runtime.log" 2>&1; then
  runtime_install_complete=true
  for binary in anyharness proliferate-worker proliferate-supervisor; do
    [[ -x "$RUNTIME_INSTALL_DIR/$binary" ]] || runtime_install_complete=false
  done
  [[ "$runtime_install_complete" == "true" ]] \
    && ok "install-runtime verifies presigned runtime URL against the path basename" \
    || no "install-runtime did not install every presigned runtime binary"
else
  no "install-runtime should accept a checksum entry for a presigned runtime URL"
  sed 's/^/      /' "$SCRATCH/install-runtime.log"
fi

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
grep -Fq 'PROLIFERATE_HEALTHCHECK_DEADLINE_EPOCH_SECONDS="$(( $(date +%s) + 17 * 60 ))"' "$AWS_TEMPLATE" \
  && ok "template health deadline leaves one minute for cfn-init unwind and cfn-signal" \
  || no "template health gate must terminate inside the unchanged 18-minute cfn-init wrapper"

# Execute the template's exact UserData body with fake cfn tools. The failure
# path must preserve cfn-init's exit code and invoke cfn-signal with a bounded,
# secret-free reason; `bash -e` would exit before the signal and fail this test.
user_data="$SCRATCH/cfn-user-data.sh"
awk '
  /Fn::Base64: !Sub \|/ { in_user_data = 1; next }
  in_user_data && /^  ProliferateDnsRecord:/ { exit }
  in_user_data { sub(/^          /, ""); print }
' "$AWS_TEMPLATE" \
  | sed \
      -e 's|/opt/aws/bin/cfn-init|"$FAKE_CFN_BIN/cfn-init"|g' \
      -e 's|/opt/aws/bin/cfn-signal|"$FAKE_CFN_BIN/cfn-signal"|g' \
      -e 's|dnf install|"$FAKE_CFN_BIN/dnf" install|g' \
      -e 's|timeout --signal=TERM --kill-after=30s 18m|"$FAKE_CFN_BIN/timeout"|g' \
      -e 's|${AWS::StackName}|test-stack|g' \
      -e 's|${AWS::Region}|us-east-1|g' \
  >"$user_data"

FAKE_CFN_BIN="$SCRATCH/fake-cfn-bin"
mkdir -p "$FAKE_CFN_BIN"
cat >"$FAKE_CFN_BIN/dnf" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
cat >"$FAKE_CFN_BIN/cfn-init" <<'EOF'
#!/usr/bin/env bash
exit "${FAKE_CFN_INIT_EXIT:-0}"
EOF
cat >"$FAKE_CFN_BIN/timeout" <<'EOF'
#!/usr/bin/env bash
if [[ -n "${FAKE_TIMEOUT_EXIT:-}" ]]; then
  exit "$FAKE_TIMEOUT_EXIT"
fi
exec "$@"
EOF
cat >"$FAKE_CFN_BIN/cfn-signal" <<'EOF'
#!/usr/bin/env bash
{
  printf 'CALL\n'
  printf '%s\n' "$@"
} >>"$CFN_SIGNAL_ARGS_FILE"
EOF
chmod +x "$FAKE_CFN_BIN/dnf" "$FAKE_CFN_BIN/cfn-init" "$FAKE_CFN_BIN/timeout" "$FAKE_CFN_BIN/cfn-signal"

signal_args="$SCRATCH/cfn-signal.args"
FAKE_CFN_BIN="$FAKE_CFN_BIN" FAKE_CFN_INIT_EXIT=23 CFN_SIGNAL_ARGS_FILE="$signal_args" \
  bash "$user_data" >/dev/null 2>&1
user_data_status=$?
[[ "$user_data_status" -eq 23 ]] && ok "template UserData preserves failed cfn-init exit code" || no "template UserData returned $user_data_status instead of cfn-init exit 23"
grep -qx -- '-e' "$signal_args" \
  && grep -qx -- '23' "$signal_args" \
  && grep -qx -- 'cfn-init bootstrap failed with exit code 23; inspect .bootstrap-progress.log and cfn-init logs through SSM.' "$signal_args" \
  && ok "template UserData failure invokes cfn-signal with bounded diagnostics" \
  || no "template UserData failure did not invoke cfn-signal with the expected bounded reason"

timeout_signal_args="$SCRATCH/cfn-timeout-signal.args"
FAKE_CFN_BIN="$FAKE_CFN_BIN" FAKE_TIMEOUT_EXIT=124 CFN_SIGNAL_ARGS_FILE="$timeout_signal_args" \
  bash "$user_data" >/dev/null 2>&1
user_data_status=$?
[[ "$user_data_status" -eq 124 ]] && ok "template UserData bounds an overlong cfn-init before the CreationPolicy timeout" || no "template UserData returned $user_data_status instead of timeout exit 124"
grep -qx -- 'cfn-init bootstrap exceeded the 18-minute limit; inspect .bootstrap-progress.log and cfn-init logs through SSM.' "$timeout_signal_args" \
  && ok "template UserData timeout invokes cfn-signal with bounded diagnostics" \
  || no "template UserData timeout did not invoke cfn-signal with the expected bounded reason"

kill_timeout_signal_args="$SCRATCH/cfn-kill-timeout-signal.args"
FAKE_CFN_BIN="$FAKE_CFN_BIN" FAKE_TIMEOUT_EXIT=137 CFN_SIGNAL_ARGS_FILE="$kill_timeout_signal_args" \
  bash "$user_data" >/dev/null 2>&1
user_data_status=$?
[[ "$user_data_status" -eq 124 ]] && ok "template UserData normalizes kill-after exit 137 to timeout exit 124" || no "template UserData returned $user_data_status instead of normalized timeout exit 124"
grep -qx -- '124' "$kill_timeout_signal_args" \
  && grep -qx -- 'cfn-init bootstrap exceeded the 18-minute limit; inspect .bootstrap-progress.log and cfn-init logs through SSM.' "$kill_timeout_signal_args" \
  && ok "template UserData kill-after invokes cfn-signal with timeout diagnostics" \
  || no "template UserData kill-after did not invoke cfn-signal with normalized timeout diagnostics"

# On Linux, execute a short-duration rendering of the production GNU timeout
# semantics against a child that ignores TERM. An independent five-second KILL
# guard prevents the regression itself from hanging if the hard deadline ever
# regresses. Reaching exactly one cfn-signal proves the real TERM -> KILL path,
# not merely the synthetic status plumbing above.
if [[ "$(uname -s)" == "Linux" ]]; then
  if timeout --version 2>/dev/null | grep -q 'GNU coreutils'; then
    term_resistant_init="$FAKE_CFN_BIN/cfn-init-term-resistant"
    cat >"$term_resistant_init" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$$" >"$CFN_INIT_PID_FILE"
trap '' TERM
while :; do :; done
EOF
    chmod +x "$term_resistant_init"

    hard_deadline_user_data="$SCRATCH/cfn-hard-deadline-user-data.sh"
    awk '
      /Fn::Base64: !Sub \|/ { in_user_data = 1; next }
      in_user_data && /^  ProliferateDnsRecord:/ { exit }
      in_user_data { sub(/^          /, ""); print }
    ' "$AWS_TEMPLATE" \
      | sed \
          -e 's|/opt/aws/bin/cfn-init|"$FAKE_CFN_BIN/cfn-init-term-resistant"|g' \
          -e 's|/opt/aws/bin/cfn-signal|"$FAKE_CFN_BIN/cfn-signal"|g' \
          -e 's|dnf install|"$FAKE_CFN_BIN/dnf" install|g' \
          -e 's|timeout --signal=TERM --kill-after=30s 18m|timeout --signal=TERM --kill-after=0.2s 0.2s|g' \
          -e 's|${AWS::StackName}|test-stack|g' \
          -e 's|${AWS::Region}|us-east-1|g' \
      >"$hard_deadline_user_data"

    hard_deadline_signal_args="$SCRATCH/cfn-hard-deadline-signal.args"
    term_resistant_pid_file="$SCRATCH/cfn-term-resistant.pid"
    timeout --signal=KILL 5s env \
      FAKE_CFN_BIN="$FAKE_CFN_BIN" \
      CFN_INIT_PID_FILE="$term_resistant_pid_file" \
      CFN_SIGNAL_ARGS_FILE="$hard_deadline_signal_args" \
      bash "$hard_deadline_user_data" >/dev/null 2>&1
    hard_deadline_status=$?
    if [[ -f "$term_resistant_pid_file" ]]; then
      kill -KILL "$(cat "$term_resistant_pid_file")" 2>/dev/null || true
    fi
    signal_call_count="$(grep -c '^CALL$' "$hard_deadline_signal_args" 2>/dev/null || true)"
    [[ "$hard_deadline_status" -eq 124 ]] \
      && [[ "$signal_call_count" -eq 1 ]] \
      && grep -qx -- '124' "$hard_deadline_signal_args" \
      && grep -qx -- 'cfn-init bootstrap exceeded the 18-minute limit; inspect .bootstrap-progress.log and cfn-init logs through SSM.' "$hard_deadline_signal_args" \
      && ok "template UserData hard-kills a TERM-resistant cfn-init and signals one bounded timeout" \
      || no "template UserData did not hard-bound and signal the TERM-resistant cfn-init (status=$hard_deadline_status calls=$signal_call_count)"
  else
    no "Linux template regression requires GNU coreutils timeout"
  fi
else
  printf '  skip  GNU timeout TERM-resistant UserData regression (runs on Linux CI)\n'
fi

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

# Compose enables self-hosted Web by default: the server image ships a compiled
# Web distribution at /app/web-dist and WEB_DIST_DIR points at it (no new
# profile, no new public port). Caddy still exposes the single SITE_ADDRESS.
web_dist_line="$(grep -E '^\s*WEB_DIST_DIR:' "$COMPOSE_FILE" | head -1)"
[[ -n "$web_dist_line" ]] \
  && ok "compose sets WEB_DIST_DIR for the api service" || no "compose missing WEB_DIST_DIR (self-hosted Web not enabled)"
printf '%s' "$web_dist_line" | grep -q '/app/web-dist' \
  && ok "WEB_DIST_DIR points at the in-image Web distribution (/app/web-dist)" || no "WEB_DIST_DIR should point at /app/web-dist: $web_dist_line"
printf '%s' "$web_dist_line" | grep -q '\${WEB_DIST_DIR-/app/web-dist}' \
  && ok "an explicitly empty WEB_DIST_DIR preserves the API-only escape hatch" || no "WEB_DIST_DIR must default only when unset: $web_dist_line"

# ---------------------------------------------------------------------------
group "11. ensure-secrets: FRONTEND_BASE_URL / API_BASE_URL derivation"
# ---------------------------------------------------------------------------
# The deployment derives BOTH API_BASE_URL and FRONTEND_BASE_URL from
# SITE_ADDRESS so same-origin self-hosted Web needs no extra configuration.
# Explicit values win; explicit http://localhost stays HTTP.
es_run() {
  # es_run <static-file> : run ensure-secrets against an isolated env set and
  # echo the resulting .env.runtime path.
  local static="$1"
  local dir
  dir="$(dirname "$static")"
  PROLIFERATE_STATIC_ENV_FILE="$static" \
    PROLIFERATE_LOCAL_ENV_FILE="$dir/.env.local" \
    PROLIFERATE_GENERATED_ENV_FILE="$dir/.env.generated" \
    PROLIFERATE_ENV_FILE="$dir/.env.runtime" \
    "$DEPLOY_DIR/ensure-secrets.sh" >/dev/null 2>&1
  printf '%s' "$dir/.env.runtime"
}
es_val() { grep -m1 "^$2=" "$1" | cut -d= -f2-; }

ESDIR="$SCRATCH/es-derive"
mkdir -p "$ESDIR"
printf 'SITE_ADDRESS=proliferate.company.com\n' >"$ESDIR/.env.static"
RT="$(es_run "$ESDIR/.env.static")"
[[ "$(es_val "$RT" API_BASE_URL)" == "https://proliferate.company.com" ]] \
  && ok "API_BASE_URL derives https from SITE_ADDRESS" || no "API_BASE_URL derivation wrong: $(es_val "$RT" API_BASE_URL)"
[[ "$(es_val "$RT" FRONTEND_BASE_URL)" == "https://proliferate.company.com" ]] \
  && ok "FRONTEND_BASE_URL derives https from SITE_ADDRESS" || no "FRONTEND_BASE_URL derivation wrong: $(es_val "$RT" FRONTEND_BASE_URL)"

# Repeating the same FRONTEND_BASE_URL origin is accepted (including a harmless
# trailing slash) and does not disturb the derived API_BASE_URL.
ESDIR2="$SCRATCH/es-explicit-frontend"
mkdir -p "$ESDIR2"
printf 'SITE_ADDRESS=proliferate.company.com\nFRONTEND_BASE_URL=https://proliferate.company.com/\n' >"$ESDIR2/.env.static"
RT2="$(es_run "$ESDIR2/.env.static")"
[[ "$(es_val "$RT2" FRONTEND_BASE_URL)" == "https://proliferate.company.com/" ]] \
  && ok "same-origin FRONTEND_BASE_URL is preserved" || no "same-origin FRONTEND_BASE_URL not honored: $(es_val "$RT2" FRONTEND_BASE_URL)"
[[ "$(es_val "$RT2" API_BASE_URL)" == "https://proliferate.company.com" ]] \
  && ok "same-origin FRONTEND_BASE_URL leaves API_BASE_URL derived" || no "API_BASE_URL wrongly affected: $(es_val "$RT2" API_BASE_URL)"
pf "$RT2" && ok "same-origin explicit frontend passes preflight" || no "same-origin explicit frontend should pass preflight"

# A different explicit API or frontend origin is retained in the generated file
# so preflight can report the operator's exact error, then blocks deployment.
ESDIR3="$SCRATCH/es-explicit-api"
mkdir -p "$ESDIR3"
printf 'SITE_ADDRESS=proliferate.company.com\nAPI_BASE_URL=https://api.example.net\n' >"$ESDIR3/.env.static"
RT3="$(es_run "$ESDIR3/.env.static")"
[[ "$(es_val "$RT3" API_BASE_URL)" == "https://api.example.net" ]] \
  && ok "mismatched API_BASE_URL remains visible to preflight" || no "explicit API_BASE_URL not retained: $(es_val "$RT3" API_BASE_URL)"
[[ "$(es_val "$RT3" FRONTEND_BASE_URL)" == "https://proliferate.company.com" ]] \
  && ok "mismatched API_BASE_URL leaves FRONTEND_BASE_URL derived" || no "FRONTEND_BASE_URL wrongly affected: $(es_val "$RT3" FRONTEND_BASE_URL)"
pf "$RT3" && no "mismatched API_BASE_URL should BLOCK" || ok "mismatched API_BASE_URL blocks"

ESDIR5="$SCRATCH/es-mismatched-frontend"
mkdir -p "$ESDIR5"
printf 'SITE_ADDRESS=proliferate.company.com\nFRONTEND_BASE_URL=https://app.example.net\n' >"$ESDIR5/.env.static"
RT5="$(es_run "$ESDIR5/.env.static")"
pf "$RT5" && no "mismatched FRONTEND_BASE_URL should BLOCK" || ok "mismatched FRONTEND_BASE_URL blocks"

# An explicit http://localhost SITE_ADDRESS stays HTTP for both.
ESDIR4="$SCRATCH/es-localhost"
mkdir -p "$ESDIR4"
printf 'SITE_ADDRESS=http://localhost\n' >"$ESDIR4/.env.static"
RT4="$(es_run "$ESDIR4/.env.static")"
[[ "$(es_val "$RT4" API_BASE_URL)" == "http://localhost" ]] \
  && ok "http://localhost SITE_ADDRESS keeps http API_BASE_URL" || no "localhost API_BASE_URL wrong: $(es_val "$RT4" API_BASE_URL)"
[[ "$(es_val "$RT4" FRONTEND_BASE_URL)" == "http://localhost" ]] \
  && ok "http://localhost SITE_ADDRESS keeps http FRONTEND_BASE_URL" || no "localhost FRONTEND_BASE_URL wrong: $(es_val "$RT4" FRONTEND_BASE_URL)"

# ---------------------------------------------------------------------------
printf '\n== Summary ==\n  %d passed, %d failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
