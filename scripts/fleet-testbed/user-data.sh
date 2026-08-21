#!/usr/bin/env bash
# cloud-init user-data for a fleet concurrency testbed instance.
#
# Installs the stack the local dev profile path expects (guides/local/README.md)
# without a Rust toolchain unless FLEET_WITH_RUST=1, since the testbed runs the
# prebuilt musl release binaries. Ends at a booted, buildable profile, so the
# whole path from nothing to a running product is one unattended command.

set -euxo pipefail
exec > >(tee -a /var/log/fleet-testbed-setup.log) 2>&1

DEADMAN_HOURS="__DEADMAN_HOURS__"
WITH_RUST="__WITH_RUST__"
REPO_REF="__REPO_REF__"
SSM_PREFIX="__SSM_PREFIX__"
AWSCLI_ARCH="__AWSCLI_ARCH__"
MUSL_ARCH="__MUSL_ARCH__"
RELEASE_TAG="__RELEASE_TAG__"
FIX_BRANCH="__FIX_BRANCH__"
AWS_REGION="__AWS_REGION__"

# Deadman first, before anything can fail, so a broken setup still terminates.
systemd-run --on-active="${DEADMAN_HOURS}h" --unit=fleet-deadman /sbin/shutdown -h now

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

apt_install_retry \
  git curl jq build-essential pkg-config libssl-dev \
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

# Repo clone. The token lives in SSM SecureString and is read with the instance
# role, so it never appears in user-data (which is readable via IMDS).
GH_TOKEN=$(aws ssm get-parameter --with-decryption --region "$AWS_REGION" \
  --name "${SSM_PREFIX}/github-token" --query 'Parameter.Value' --output text)
su - ubuntu -c "git clone https://x-access-token:${GH_TOKEN}@github.com/proliferate-ai/proliferate.git ~/proliferate"

# Pin to the release's own commit so the prebuilt runtime and the source tree
# cannot disagree, then cherry-pick only the dev-loop fixes on top.
su - ubuntu -c "cd ~/proliferate && \
  git -c advice.detachedHead=false checkout ${REPO_REF} && \
  git fetch origin ${FIX_BRANCH} main && \
  git -c user.name=fleet -c user.email=fleet@local cherry-pick -x \
    \$(git rev-list --reverse origin/${FIX_BRANCH} --not origin/main)"
unset GH_TOKEN

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
