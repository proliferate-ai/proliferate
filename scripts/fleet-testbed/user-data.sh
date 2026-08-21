#!/usr/bin/env bash
# cloud-init user-data for a fleet concurrency testbed instance.
#
# Installs the stack the local dev profile path expects (guides/local/README.md)
# without a Rust toolchain unless FLEET_WITH_RUST=1, since the testbed runs the
# prebuilt musl release binaries. Ends at a booted, buildable profile, so the
# whole path from nothing to a running product is one unattended command.
#
# No secret is ever a variable in this script. The GitHub token stays in SSM and
# is fetched on demand by a git askPass helper, so it reaches neither xtrace,
# nor argv, nor .git/config. See "repo clone" below.

set -euo pipefail

# Logs first, mode-restricted before a single line is written to them. xtrace is
# on for everything after this, and cloud-init's own log captures the same
# stream, so both files are treated as sensitive by default.
install -m 600 /dev/null /var/log/fleet-testbed-setup.log
chmod 600 /var/log/cloud-init-output.log 2>/dev/null || true
exec > >(tee -a /var/log/fleet-testbed-setup.log) 2>&1
set -x

DEADMAN_HOURS="__DEADMAN_HOURS__"
WITH_RUST="__WITH_RUST__"
REPO_REF="__REPO_REF__"
SSM_PREFIX="__SSM_PREFIX__"
AWSCLI_ARCH="__AWSCLI_ARCH__"
MUSL_ARCH="__MUSL_ARCH__"
RELEASE_TAG="__RELEASE_TAG__"
FIX_BRANCH="__FIX_BRANCH__"
AWS_REGION="__AWS_REGION__"

# --- deadman -----------------------------------------------------------------
#
# First, before anything can fail, so a broken setup still terminates. The
# deadline is a timestamp on disk and the check is a persistent systemd timer
# plus a cron.d entry, because the original transient `systemd-run` unit lived
# in /run and a reboot silently disarmed it on a 16 vCPU instance.
#
# Arming is wrapped so that its own failure degrades rather than aborting the
# setup at the exact line meant to be the safety net.

DEADLINE_EPOCH="$(( $(date +%s) + DEADMAN_HOURS * 3600 ))"
install -m 644 /dev/null /etc/fleet-testbed-deadline
echo "$DEADLINE_EPOCH" > /etc/fleet-testbed-deadline

cat > /usr/local/bin/fleet-deadman <<'DEADMAN_EOF'
#!/bin/sh
# Shuts the testbed down once its deadline passes. run-instances set
# instance-initiated-shutdown-behavior=terminate, so a shutdown is a terminate.
#
# Fails closed: a missing or unparseable deadline file means the deadman cannot
# prove the box is still within its budget, so it shuts down.
set -u
DEADLINE_FILE=/etc/fleet-testbed-deadline
deadline=""
[ -r "$DEADLINE_FILE" ] && deadline="$(cat "$DEADLINE_FILE" 2>/dev/null || true)"
case "$deadline" in
  ''|*[!0-9]*)
    logger -t fleet-deadman "deadline file missing or unreadable; shutting down"
    exec /sbin/shutdown -h now
    ;;
esac
now="$(date +%s)"
[ "$now" -ge "$deadline" ] || exit 0
logger -t fleet-deadman "deadline reached; shutting down (shutdown behavior = terminate)"
exec /sbin/shutdown -h now
DEADMAN_EOF
chmod 700 /usr/local/bin/fleet-deadman

arm_deadman() {
  # cron.d first: it is the simplest of the two and needs no daemon-reload, so
  # it is armed even if the systemd path below fails.
  cat > /etc/cron.d/fleet-deadman <<'CRON_EOF'
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
*/2 * * * * root /usr/local/bin/fleet-deadman
CRON_EOF
  chmod 644 /etc/cron.d/fleet-deadman

  cat > /etc/systemd/system/fleet-deadman.service <<'SVC_EOF'
[Unit]
Description=Fleet testbed deadman shutdown

[Service]
Type=oneshot
ExecStart=/usr/local/bin/fleet-deadman
SVC_EOF

  cat > /etc/systemd/system/fleet-deadman.timer <<'TIMER_EOF'
[Unit]
Description=Fleet testbed deadman check

[Timer]
OnBootSec=1min
OnUnitActiveSec=1min
AccuracySec=30s

[Install]
WantedBy=timers.target
TIMER_EOF

  systemctl daemon-reload
  systemctl enable --now fleet-deadman.timer
}

if arm_deadman; then
  echo "deadman armed: shutdown at $(date -u -d "@${DEADLINE_EPOCH}" 2>/dev/null || echo "$DEADLINE_EPOCH")"
else
  echo "WARNING: could not arm the persistent deadman; falling back to a one-shot shutdown"
  # Last resort. Does not survive a reboot, which is exactly why it is not the
  # primary mechanism, but it is better than an unbounded 16 vCPU instance.
  shutdown -h "+$((DEADMAN_HOURS * 60))" || echo "WARNING: fallback shutdown could not be scheduled either"
fi

export DEBIAN_FRONTEND=noninteractive

# The ec2 ports mirror returns intermittent 503s. Without retries a single bad
# fetch kills the whole setup under `set -e`, which is what happened on the
# first provision.
cat > /etc/apt/apt.conf.d/80-retries <<'APT_EOF'
Acquire::Retries "8";
Acquire::http::Timeout "30";
Acquire::https::Timeout "30";
APT_EOF

apt_install_retry() {
  local attempt
  for attempt in 1 2 3 4 5; do
    apt-get update -y && apt-get install -y --no-install-recommends --fix-missing "$@" && return 0
    echo "apt attempt ${attempt} failed, retrying in $((attempt * 15))s"
    sleep $((attempt * 15))
  done
  return 1
}

# A C toolchain is only needed for --with-rust, and it is the slow half of
# provisioning. The default path compiles nothing: pnpm's onlyBuiltDependencies
# allowlist in pnpm-workspace.yaml is closed and none of its five entries build
# from source on linux (they ship prebuilt platform packages), and every
# platform-specific wheel in server/uv.lock has a manylinux build for both
# x86_64 and aarch64, so uv never falls back to an sdist.
BUILD_PKGS=()
if [ "$WITH_RUST" = "1" ]; then
  BUILD_PKGS=(build-essential pkg-config libssl-dev)
fi

apt_install_retry \
  git curl jq "${BUILD_PKGS[@]}" \
  postgresql-16 postgresql-client-16 redis-server \
  python3 python3-venv unzip ca-certificates

systemctl enable --now postgresql redis-server

# The dev profile path expects a `proliferate` login role that can create
# databases. Local-only password, matching the documented default.
sudo -u postgres psql -v ON_ERROR_STOP=1 -c \
  "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='proliferate') THEN CREATE ROLE proliferate LOGIN CREATEDB PASSWORD 'localdev'; END IF; END \$\$;"

# Concurrent TRUNCATE across many profile databases exhausts the default lock
# table; the CI lane hit exactly this under xdist.
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER SYSTEM SET max_locks_per_transaction = 1024;"
systemctl restart postgresql

# Node via nodesource, pnpm via corepack.
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt_install_retry nodejs
corepack enable

# uv for the server venv, same as CI.
curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh

# AWS CLI, for SSM parameter reads and self-identification.
curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${AWSCLI_ARCH}.zip" -o /tmp/awscliv2.zip
unzip -oq /tmp/awscliv2.zip -d /tmp && /tmp/aws/install --update

if [ "$WITH_RUST" = "1" ]; then
  su - ubuntu -c "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal"
fi

# The Claude CLI is the native component of the claude agent. Installed as root
# so it lands on the default PATH: installing under ~/.npm-global instead means
# the runtime only sees it if the profile happened to be started after that
# directory joined PATH, which is a silent and confusing failure.
npm install -g @anthropic-ai/claude-code

# Environment for every session, interactive or not. /etc/environment is read by
# pam_env, so `ssh host 'cmd'` gets these too; the bottom of ~/.bashrc does not
# work there, because Ubuntu's default returns early for non-interactive shells.
cat >> /etc/environment <<ENV_EOF
ANYHARNESS_DEV_RUNTIME_BIN=/home/ubuntu/bin/anyharness
CLAUDE_CODE_USE_BEDROCK=1
AWS_REGION=${AWS_REGION}
SKIP_RUST=1
USE_EXISTING_POSTGRES=1
USE_EXISTING_REDIS=1
ENV_EOF
cp /etc/environment /tmp/fleet-env
sed -i 's/^/export /' /tmp/fleet-env
install -m 644 /tmp/fleet-env /etc/profile.d/fleet-testbed.sh

# --- repo clone --------------------------------------------------------------
#
# The token never enters this script. A mode-700 askPass helper owned by ubuntu
# reads the SSM SecureString with the instance role each time git needs a
# credential, which keeps it out of three places a URL-embedded token lands in:
#
#   - xtrace and the setup/cloud-init logs, which are not secret stores
#   - argv, since /proc/<pid>/cmdline is world readable on Ubuntu
#   - .git/config, where `git clone https://user:token@...` persists it at 0644
#     forever, and where later fetches would then depend on it
#
# xtrace is off across the whole credential region regardless, so that a future
# edit that does touch the token cannot quietly start logging it.

set +x

install -m 700 -o ubuntu -g ubuntu /dev/null /usr/local/bin/fleet-gh-askpass
cat > /usr/local/bin/fleet-gh-askpass <<ASKPASS_EOF
#!/bin/sh
# git core.askPass helper for the testbed. Prints a GitHub credential on stdout
# and nothing anywhere else. Invoked by git with the prompt text as \$1.
set -u
case "\${1:-}" in
  Username*) printf '%s\n' 'x-access-token' ;;
  *) exec aws ssm get-parameter --with-decryption --region '${AWS_REGION}' \\
       --name '${SSM_PREFIX}/github-token' --query 'Parameter.Value' --output text ;;
esac
ASKPASS_EOF

su - ubuntu -c "git config --global core.askPass /usr/local/bin/fleet-gh-askpass"

# Tokenless remote URL. git prompts for a username and a password, the helper
# supplies both, and nothing is written to .git/config.
su - ubuntu -c "git clone https://github.com/proliferate-ai/proliferate.git ~/proliferate"

set -x

# Fail loudly if a credential ever ends up persisted anyway.
if grep -qE '://[^/@[:space:]]*:[^/@[:space:]]+@' /home/ubuntu/proliferate/.git/config; then
  echo "FATAL: a credential was persisted into .git/config" >&2
  exit 1
fi

# Pin to the release's own commit so the prebuilt runtime and the source tree
# cannot disagree, then cherry-pick only the dev-loop fixes on top.
su - ubuntu -c "cd ~/proliferate && \
  git -c advice.detachedHead=false checkout ${REPO_REF} && \
  git fetch origin ${FIX_BRANCH} main && \
  git -c user.name=fleet -c user.email=fleet@local cherry-pick -x \
    \$(git rev-list --reverse origin/${FIX_BRANCH} --not origin/main)"

# Prebuilt runtime binaries: no cargo required for the product itself.
su - ubuntu -c "mkdir -p ~/bin && cd ~/bin && \
  curl -fsSL -o anyharness.tar.gz https://github.com/proliferate-ai/proliferate/releases/download/${RELEASE_TAG}/anyharness-${MUSL_ARCH}-unknown-linux-musl.tar.gz && \
  tar xzf anyharness.tar.gz && chmod +x anyharness proliferate-worker proliferate-supervisor"

# Build once at image-setup time so a measured boot never pays for it. SKIP_RUST
# is honored end to end here, including sdk-generate, so cargo is never invoked.
su - ubuntu -c "cd ~/proliferate && set -a && . /etc/environment && set +a && \
  corepack pnpm install --frozen-lockfile && \
  uv sync --project server && \
  make build"

# One profile prepared, so `make run PROFILE=fleet-1 HEADLESS=1` is the whole
# boot. Additional profiles are `make setup PROFILE=fleet-N`.
su - ubuntu -c "cd ~/proliferate && set -a && . /etc/environment && set +a && \
  make setup PROFILE=fleet-1"

chown -R ubuntu:ubuntu /home/ubuntu
touch /var/lib/fleet-testbed-ready
echo "fleet-testbed setup complete"
