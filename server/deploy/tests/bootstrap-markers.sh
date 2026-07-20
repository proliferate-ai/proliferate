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
helper_name="$(basename "$0" .sh)"
printf '%s\n' "$helper_name" >>"$BOOTSTRAP_OPS"
if [[ "$helper_name" == "${BLOCK_HELPER:-}" ]]; then
  printf '%s %s\n' "$$" "$PPID" >"$BLOCK_PIDS_FILE"
  trap '' TERM
  while :; do
    sleep 1
  done
fi
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
diff -u "$expected_success" "$FIXTURE/.bootstrap-progress.log"
[[ "$(stat -c '%a' "$FIXTURE/.bootstrap-progress.log" 2>/dev/null || stat -f '%Lp' "$FIXTURE/.bootstrap-progress.log")" == "600" ]]

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

# Model cfn-init's ProcessHelper/LoggingProcessHelper contract: the child stdout
# stays in a command-substitution pipe and reaches cfn-init-cmd.log only after
# the child returns. Kill the wrapper while preflight is blocked. The buffered
# stdout path must lose the marker, while bootstrap.sh's owned append survives.
buffered_log="$SCRATCH/cfn-init-cmd.log"
block_pids="$SCRATCH/block.pids"
timeout_ops="$SCRATCH/timeout.ops"
wrapper="$SCRATCH/cfn-init-wrapper"
cat >"$wrapper" <<EOF
#!/usr/bin/env bash
set +e
output="\$(bash '$FIXTURE/bootstrap.sh' 2>&1)"
status=\$?
printf '%s\n' "\$output" >'$buffered_log'
exit "\$status"
EOF
chmod +x "$wrapper"

PATH="$FAKE_BIN:$PATH" BOOTSTRAP_OPS="$timeout_ops" BLOCK_HELPER=preflight \
  BLOCK_PIDS_FILE="$block_pids" "$wrapper" &
wrapper_pid=$!
for _ in $(seq 1 500); do
  if [[ -s "$block_pids" ]] && grep -qx '__PROLIFERATE_BOOTSTRAP_SUBSTEP__:preflight:started' "$FIXTURE/.bootstrap-progress.log"; then
    break
  fi
  sleep 0.01
done
[[ -s "$block_pids" ]]
grep -qx '__PROLIFERATE_BOOTSTRAP_SUBSTEP__:preflight:started' "$FIXTURE/.bootstrap-progress.log"
read -r helper_pid bootstrap_pid <"$block_pids"

# TERM is the outer deadline's first action; KILL models its bounded fallback.
kill -TERM "$wrapper_pid" "$bootstrap_pid" "$helper_pid" 2>/dev/null || true
kill -KILL "$wrapper_pid" "$bootstrap_pid" "$helper_pid" 2>/dev/null || true
wait "$wrapper_pid" 2>/dev/null || true

# Signal delivery and orphan reaping are asynchronous. In particular, kill -0
# remains true for a zombie even though it cannot execute or retain the pipe.
# Give the killed tree a bounded interval to stop, while still failing if any
# named process remains executable after KILL.
live_pids=()
for _ in $(seq 1 500); do
  live_pids=()
  for pid in "$wrapper_pid" "$bootstrap_pid" "$helper_pid"; do
    process_state="$(ps -o stat= -p "$pid" 2>/dev/null | awk 'NR == 1 { print $1 }' || true)"
    if [[ -n "$process_state" && "$process_state" != Z* ]]; then
      live_pids+=("$pid")
    fi
  done
  [[ "${#live_pids[@]}" -eq 0 ]] && break
  sleep 0.01
done
if [[ "${#live_pids[@]}" -ne 0 ]]; then
  printf 'timeout regression left executable process(es): %s\n' "${live_pids[*]}" >&2
  ps -o pid=,ppid=,stat=,command= -p "$(IFS=,; printf '%s' "${live_pids[*]}")" >&2 || true
  exit 1
fi

grep -qx '__PROLIFERATE_BOOTSTRAP_SUBSTEP__:ensure-secrets:completed' "$FIXTURE/.bootstrap-progress.log"
grep -qx '__PROLIFERATE_BOOTSTRAP_SUBSTEP__:preflight:started' "$FIXTURE/.bootstrap-progress.log"
if grep -qE '__PROLIFERATE_BOOTSTRAP_SUBSTEP__:preflight:completed|__PROLIFERATE_BOOTSTRAP_SUBSTEP__:registry-login:' "$FIXTURE/.bootstrap-progress.log"; then
  printf 'durable progress invented completion/later work after wrapper termination\n' >&2
  exit 1
fi
if [[ -f "$buffered_log" ]] && grep -q '__PROLIFERATE_BOOTSTRAP_SUBSTEP__' "$buffered_log"; then
  printf 'stdout-only cfn-init emulation unexpectedly retained a pre-completion marker\n' >&2
  exit 1
fi

# The release-runner regression consumes these exact kill-path artifacts and
# executes the real bounded diagnostic command/parser over them.
if [[ -n "${BOOTSTRAP_MARKER_EVIDENCE_DIR:-}" ]]; then
  mkdir -p "$BOOTSTRAP_MARKER_EVIDENCE_DIR"
  cp "$FIXTURE/.bootstrap-progress.log" "$BOOTSTRAP_MARKER_EVIDENCE_DIR/bootstrap-progress.log"
  printf 'Running Command 02-bootstrap\n' >"$BOOTSTRAP_MARKER_EVIDENCE_DIR/cfn-init.log"
  : >"$BOOTSTRAP_MARKER_EVIDENCE_DIR/cfn-init-cmd.log"
  printf '__PROLIFERATE_CFN_OUTER__:timeout\n' >"$BOOTSTRAP_MARKER_EVIDENCE_DIR/cloud-init-output.log"
fi
