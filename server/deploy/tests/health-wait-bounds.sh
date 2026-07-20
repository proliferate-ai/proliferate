#!/usr/bin/env bash

# Offline contract tests for wait-for-health.sh. The fake curl records argv and
# never touches the network; these checks fail on the former unbounded curl path.

set -euo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$TESTS_DIR/.." && pwd)"
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/proliferate-health-wait.XXXXXX")"
trap 'rm -rf "$SCRATCH"' EXIT

FAKE_BIN="$SCRATCH/bin"
mkdir -p "$FAKE_BIN"
cat >"$FAKE_BIN/curl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$FAKE_CURL_CALLS"
case "$*" in
  *http://local.test/health) exit 0 ;;
  *) exit 22 ;;
esac
EOF
chmod +x "$FAKE_BIN/curl"

progress="$SCRATCH/progress.log"
calls="$SCRATCH/curl.calls"
runtime_env="$SCRATCH/runtime.env"
printf 'PROLIFERATE_PUBLIC_HEALTHCHECK_URL=https://public.test/health\n' >"$runtime_env"

set +e
PATH="$FAKE_BIN:$PATH" \
  FAKE_CURL_CALLS="$calls" \
  PROLIFERATE_ENV_FILE="$runtime_env" \
  PROLIFERATE_HEALTHCHECK_URL="http://local.test/health" \
  PROLIFERATE_HEALTHCHECK_ATTEMPTS=1 \
  PROLIFERATE_HEALTHCHECK_SLEEP_SECONDS=0 \
  PROLIFERATE_HEALTHCHECK_CONNECT_TIMEOUT_SECONDS=3 \
  PROLIFERATE_HEALTHCHECK_MAX_TIME_SECONDS=4 \
  PROLIFERATE_HEALTHCHECK_PROGRESS_FILE="$progress" \
  "$DEPLOY_DIR/wait-for-health.sh" >/dev/null 2>&1
status=$?
set -e
[[ "$status" -eq 1 ]]
[[ "$(wc -l <"$calls" | tr -d ' ')" -eq 2 ]]
while IFS= read -r call; do
  [[ "$call" == *"--connect-timeout 3 --max-time 4"* ]]
done <"$calls"
cat >"$SCRATCH/expected-progress" <<'EOF'
__PROLIFERATE_HEALTHCHECK_TARGET__:local:started
__PROLIFERATE_HEALTHCHECK_TARGET__:local:completed
__PROLIFERATE_HEALTHCHECK_TARGET__:public:started
__PROLIFERATE_HEALTHCHECK_TARGET__:public:failed
EOF
diff -u "$SCRATCH/expected-progress" "$progress"

# An exhausted CFN-owned deadline fails before starting curl, while retaining a
# precise fixed target marker rather than waiting for the outer timeout.
: >"$progress"
: >"$calls"
set +e
PATH="$FAKE_BIN:$PATH" \
  FAKE_CURL_CALLS="$calls" \
  PROLIFERATE_ENV_FILE="$runtime_env" \
  PROLIFERATE_HEALTHCHECK_URL="http://local.test/health" \
  PROLIFERATE_HEALTHCHECK_DEADLINE_EPOCH_SECONDS=1 \
  PROLIFERATE_HEALTHCHECK_PROGRESS_FILE="$progress" \
  "$DEPLOY_DIR/wait-for-health.sh" >/dev/null 2>&1
status=$?
set -e
[[ "$status" -eq 1 ]]
[[ ! -s "$calls" ]]
cat >"$SCRATCH/expected-deadline-progress" <<'EOF'
__PROLIFERATE_HEALTHCHECK_TARGET__:local:started
__PROLIFERATE_HEALTHCHECK_TARGET__:local:failed
EOF
diff -u "$SCRATCH/expected-deadline-progress" "$progress"
