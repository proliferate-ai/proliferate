# Proliferate Sandbox Image
# This Dockerfile defines the sandbox environment for Modal sandboxes.
# Deploy with: modal deploy deploy.py

FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Core build tools and utilities
RUN apt-get update && apt-get install -y \
    git curl wget build-essential ca-certificates \
    openssh-client openssh-server sudo \
    net-tools iproute2 \
    postgresql postgresql-contrib libpq-dev \
    redis-server \
    ruby ruby-dev \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libpango-1.0-0 libcairo2 libxshmfence1 fonts-liberation \
    procps lsof netcat-openbsd jq rsync tmux \
    python3.11 python3.11-venv python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install Docker CE with Compose and Buildx
RUN install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null \
    && apt-get update \
    && apt-get install -y \
        docker-ce=5:27.5.0-1~ubuntu.22.04~jammy \
        docker-ce-cli=5:27.5.0-1~ubuntu.22.04~jammy \
        containerd.io docker-buildx-plugin docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

# Install modern runc for reliable Docker networking
RUN rm -f $(which runc) \
    && wget -q https://github.com/opencontainers/runc/releases/download/v1.3.0/runc.amd64 \
    && chmod +x runc.amd64 \
    && mv runc.amd64 /usr/local/bin/runc

# Configure iptables-legacy (gVisor doesn't support nftables)
RUN update-alternatives --set iptables /usr/sbin/iptables-legacy || true \
    && update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy || true

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install global npm packages
RUN npm install -g pnpm yarn @aws-sdk/client-s3 ws node-pty

# Install Mailcatcher
RUN gem install mailcatcher --no-document

# Install Caddy (for preview proxy)
RUN apt-get update \
    && apt-get install -y debian-keyring debian-archive-keyring apt-transport-https \
    && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
    && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list \
    && apt-get update \
    && apt-get install -y caddy \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Install openvscode-server (web-based VS Code editor)
RUN OVSCODE_VERSION="1.106.3" \
    && wget -q "https://github.com/gitpod-io/openvscode-server/releases/download/openvscode-server-v${OVSCODE_VERSION}/openvscode-server-v${OVSCODE_VERSION}-linux-x64.tar.gz" -O /tmp/ovscode.tar.gz \
    && mkdir -p /opt/openvscode-server \
    && tar xzf /tmp/ovscode.tar.gz -C /opt/openvscode-server --strip-components=1 \
    && ln -s /opt/openvscode-server/bin/openvscode-server /usr/local/bin/openvscode-server \
    && rm /tmp/ovscode.tar.gz

# Install AI coding agents
RUN npm install -g opencode-ai@latest @anthropic-ai/claude-code @openai/codex

# Install MCP servers (Playwright + sandbox-mcp) — cache-bust: v0.1.18
RUN npm install -g proliferate-sandbox-mcp@0.1.18 playwright-mcp --unsafe-perm

# Make python3.11 the default python
RUN update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1 \
    && update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1

# Install Python tools (including fastapi for Modal endpoints)
RUN pip3 install httpx uv playwright psycopg2-binary redis fastapi

# Install Playwright browsers (Chromium only)
RUN playwright install chromium && playwright install-deps chromium

# Initialize PostgreSQL
RUN mkdir -p /var/run/postgresql && chown postgres:postgres /var/run/postgresql \
    && mkdir -p /var/lib/postgresql/data && chown postgres:postgres /var/lib/postgresql/data \
    && sudo -u postgres /usr/lib/postgresql/14/bin/initdb -D /var/lib/postgresql/data \
    && echo "local all all trust" > /var/lib/postgresql/data/pg_hba.conf \
    && echo "host all all 127.0.0.1/32 trust" >> /var/lib/postgresql/data/pg_hba.conf \
    && echo "host all all ::1/128 trust" >> /var/lib/postgresql/data/pg_hba.conf \
    && sed -i "s/#listen_addresses = 'localhost'/listen_addresses = 'localhost'/" /var/lib/postgresql/data/postgresql.conf

# Create startup script for services
RUN echo '#!/bin/bash\n\
mkdir -p /var/log/postgresql && chown postgres:postgres /var/log/postgresql\n\
sudo -u postgres /usr/lib/postgresql/14/bin/pg_ctl -D /var/lib/postgresql/data -l /var/log/postgresql/postgresql.log start || true\n\
redis-server --daemonize yes\n\
/usr/sbin/sshd\n\
mailcatcher --ip 0.0.0.0 || true' > /usr/local/bin/start-services.sh \
    && chmod +x /usr/local/bin/start-services.sh

# Create Docker daemon startup script
RUN echo '#!/bin/bash\n\
set -e\n\
rm -f /var/run/docker.pid\n\
dev=$(ip route show default | awk '\''/default/ {print $5}'\'')\n\
if [ -n "$dev" ]; then\n\
    addr=$(ip addr show dev "$dev" | grep -w inet | awk '\''{print $2}'\'' | cut -d/ -f1)\n\
    if [ -n "$addr" ]; then\n\
        echo 1 > /proc/sys/net/ipv4/ip_forward\n\
        iptables-legacy -t nat -A POSTROUTING -o "$dev" -j SNAT --to-source "$addr" -p tcp 2>/dev/null || true\n\
        iptables-legacy -t nat -A POSTROUTING -o "$dev" -j SNAT --to-source "$addr" -p udp 2>/dev/null || true\n\
    fi\n\
fi\n\
/usr/bin/dockerd --iptables=false --ip6tables=false &\n\
DOCKER_PID=$!\n\
for i in $(seq 1 30); do\n\
    if docker info >/dev/null 2>&1; then\n\
        echo "Docker daemon ready"\n\
        break\n\
    fi\n\
    sleep 0.5\n\
done\n\
wait $DOCKER_PID' > /usr/local/bin/start-dockerd.sh \
    && chmod +x /usr/local/bin/start-dockerd.sh

# Create proliferate-info script
RUN echo '#!/bin/bash\n\
echo ""\n\
echo "Proliferate Session"\n\
echo ""\n\
echo "  Preview URL:   ${PROLIFERATE_PREVIEW_URL:-Not available}"\n\
echo "  Services URL:  ${PROLIFERATE_SERVICES_URL:-Not available}"\n\
echo ""\n\
echo "  Keybindings:"\n\
echo "    Ctrl+b d   - Detach from session (keeps running)"\n\
echo "    Ctrl+b i   - Show this info"\n\
echo "    Ctrl+b ?   - Show all tmux keybindings"\n\
echo ""' > /usr/local/bin/proliferate-info \
    && chmod +x /usr/local/bin/proliferate-info

# Git credential helper (askpass fallback)
RUN printf '#!/bin/bash\ncase "$1" in *Username*) echo ${GIT_USERNAME:-x-access-token};; *) echo $GIT_TOKEN;; esac\n' > /usr/local/bin/git-askpass \
    && chmod +x /usr/local/bin/git-askpass

# Git credential helper (per-repo tokens from JSON file)
# Reads /tmp/.git-credentials.json for per-repo tokens, falls back to $GIT_TOKEN
RUN printf '%s\n' \
    '#!/bin/bash' \
    'CREDS_FILE="/tmp/.git-credentials.json"' \
    '' \
    '# Read input from git (protocol, host, path)' \
    'declare -A input' \
    'while IFS="=" read -r key value; do' \
    '    [[ -z "$key" ]] && break' \
    '    input[$key]="$value"' \
    'done' \
    '' \
    'protocol="${input[protocol]}"' \
    'host="${input[host]}"' \
    'path="${input[path]}"' \
    '' \
    '# Build URL variants to look up' \
    'url="${protocol}://${host}/${path}"' \
    'url_no_git="${url%.git}"' \
    '' \
    '# Try to find token in credentials file' \
    'token=""' \
    'if [[ -f "$CREDS_FILE" ]]; then' \
    '    token=$(jq -r --arg url "$url" ".[\\$url] // empty" "$CREDS_FILE" 2>/dev/null)' \
    '    if [[ -z "$token" ]]; then' \
    '        token=$(jq -r --arg url "$url_no_git" ".[\\$url] // empty" "$CREDS_FILE" 2>/dev/null)' \
    '    fi' \
    'fi' \
    '' \
    '# Fall back to GIT_TOKEN env var' \
    'if [[ -z "$token" ]]; then' \
    '    token="$GIT_TOKEN"' \
    'fi' \
    '' \
    '# Output credentials if we have a token' \
    'if [[ -n "$token" ]]; then' \
    '    echo "username=${GIT_USERNAME:-x-access-token}"' \
    '    echo "password=$token"' \
    'fi' \
    > /usr/local/bin/git-credential-proliferate
RUN chmod +x /usr/local/bin/git-credential-proliferate

# Create non-root user (Modal sandboxes run as 'user')
RUN useradd -m -s /bin/bash user \
    && echo "user ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Pre-install OpenCode tool dependencies (used by custom tools)
RUN mkdir -p /home/user/.opencode-tools && \
    printf '%s' '{"name":"opencode-tools","version":"1.0.0","private":true}' > /home/user/.opencode-tools/package.json && \
    cd /home/user/.opencode-tools && \
    npm install @aws-sdk/client-s3 @opencode-ai/plugin && \
    chown -R user:user /home/user/.opencode-tools

# Configure SSH for key-based auth only (for rsync from CLI)
RUN mkdir -p /run/sshd /root/.ssh /home/user/.ssh \
    && chmod 700 /root/.ssh /home/user/.ssh \
    && sed -i 's/#PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config \
    && sed -i 's/#PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config \
    && sed -i 's/#PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config \
    && echo "StrictModes no" >> /etc/ssh/sshd_config \
    && ssh-keygen -A

# Configure git to use per-repo credential helper
RUN git config --global credential.helper "/usr/local/bin/git-credential-proliferate" \
    && git config --global credential.useHttpPath true

# Environment
ENV PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ENV GIT_ASKPASS="/usr/local/bin/git-askpass"

# Default working directory
WORKDIR /home/user

# Cache bust - change this to force rebuild
RUN echo "image-v2026-01-28"
