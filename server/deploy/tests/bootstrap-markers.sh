#!/usr/bin/env bash

# Offline contract test for bootstrap.sh's fixed diagnostic marker protocol.
# It executes the real script with fake helpers/docker: no Docker daemon,
# network, credentials, or provider resources are used.

set -euo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$TESTS_DIR/.." && pwd)"
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/proliferate-bootstrap-markers.XXXXXX")"
trap 'rm -rf "$SCRATCH"' EXIT

FIXTURE="$SCRATCH/deploy"
FAKE_BIN="$SCRATCH/bin"
mkdir -p "$FIXTURE" "$FAKE_BIN"
cp "$DEPLOY_DIR/bootstrap.sh" "$DEPLOY_DIR/common.sh" "$FIXTURE/"
printf 'AGENT_GATEWAY_ENABLED=false\nE2B_API_KEY=\nE2B_TEMPLATE_NAME=\n' >"$FIXTURE/.env.static"
cp "$FIXTURE/.env.static" "$FIXTURE/.env.runtime"

cat >"$FIXTURE/helper" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$(basename "$0" .sh)" >>"$BOOTSTRAP_OPS"
EOF
chmod +x "$FIXTURE/helper"
for helper in ensure-secrets preflight registry-login install-runtime wait-for-health; do
  ln -s helper "$FIXTURE/$helper.sh"
done

cat >"$FAKE_BIN/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == "compose version" ]]; then
  exit 0
fi
printf 'docker:%s\n' "$*" >>"$BOOTSTRAP_OPS"
if [[ -n "${FAIL_DOCKER_MATCH:-}" && "$*" == *"$FAIL_DOCKER_MATCH"* ]]; then
  exit 41
fi
EOF
chmod +x "$FAKE_BIN/docker"

expected_success="$SCRATCH/expected-success"
cat >"$expected_success" <<'EOF'
__PROLIFERATE_BOOTSTRAP_SUBSTEP__:ensure-secrets:started
__PROLIFERATE_BOOTSTRAP_SUBSTEP__:ensure-secrets:completed
__PROLIFERATE_BOOTSTRAP_SUBSTEP__:preflight:started
__PROLIFERATE_BOOTSTRAP_SUBSTEP__:preflight:completed
__PROLIFERATE_BOOTSTRAP_SUBSTEP__:registry-login:started
__PROLIFERATE_BOOTSTRAP_SUBSTEP__:registry-login:completed
__PROLIFERATE_BOOTSTRAP_SUBSTEP__:runtime-install:started
__PROLIFERATE_BOOTSTRAP_SUBSTEP__:runtime-install:completed
__PROLIFERATE_BOOTSTRAP_SUBSTEP__:db-up:started
__PROLIFERATE_BOOTSTRAP_SUBSTEP__:db-up:completed
__PROLIFERATE_BOOTSTRAP_SUBSTEP__:migrate:started
__PROLIFERATE_BOOTSTRAP_SUBSTEP__:migrate:completed
__PROLIFERATE_BOOTSTRAP_SUBSTEP__:api-caddy-up:started
__PROLIFERATE_BOOTSTRAP_SUBSTEP__:api-caddy-up:completed
__PROLIFERATE_BOOTSTRAP_SUBSTEP__:optional-profiles:started
__PROLIFERATE_BOOTSTRAP_SUBSTEP__:optional-profiles:completed
__PROLIFERATE_BOOTSTRAP_SUBSTEP__:health-wait:started
__PROLIFERATE_BOOTSTRAP_SUBSTEP__:health-wait:completed
EOF

success_output="$SCRATCH/success.out"
success_ops="$SCRATCH/success.ops"
PATH="$FAKE_BIN:$PATH" BOOTSTRAP_OPS="$success_ops" bash "$FIXTURE/bootstrap.sh" >"$success_output"
grep '^__PROLIFERATE_BOOTSTRAP_SUBSTEP__:' "$success_output" >"$SCRATCH/success.markers"
diff -u "$expected_success" "$SCRATCH/success.markers"

failed_output="$SCRATCH/failed.out"
failed_ops="$SCRATCH/failed.ops"
set +e
PATH="$FAKE_BIN:$PATH" BOOTSTRAP_OPS="$failed_ops" FAIL_DOCKER_MATCH='run --rm migrate' \
  bash "$FIXTURE/bootstrap.sh" >"$failed_output" 2>&1
failed_status=$?
set -e
[[ "$failed_status" -eq 41 ]]
grep -qx '__PROLIFERATE_BOOTSTRAP_SUBSTEP__:migrate:started' "$failed_output"
if grep -qE '__PROLIFERATE_BOOTSTRAP_SUBSTEP__:migrate:completed|__PROLIFERATE_BOOTSTRAP_SUBSTEP__:api-caddy-up:' "$failed_output"; then
  printf 'bootstrap emitted completion/later markers after migrate failed\n' >&2
  exit 1
fi
