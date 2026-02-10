# E2B Custom Sandbox Template
# Mirrors Modal's BASE_IMAGE for parity
# Build with: e2b template build --name proliferate-base

FROM e2bdev/base:latest

# Core build tools
RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    build-essential \
    ca-certificates \
    openssh-client \
    sudo \
    procps \
    lsof \
    netcat-openbsd \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Create user if not exists (e2bdev/base now includes 'user')
RUN id -u user >/dev/null 2>&1 || useradd -m -s /bin/bash user && \
    grep -q "^user ALL" /etc/sudoers || echo "user ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# PostgreSQL
RUN apt-get update && apt-get install -y \
    postgresql \
    postgresql-contrib \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Redis
RUN apt-get update && apt-get install -y redis-server \
    && rm -rf /var/lib/apt/lists/*

# Ruby (for Mailcatcher)
RUN apt-get update && apt-get install -y ruby ruby-dev \
    && rm -rf /var/lib/apt/lists/*

# Playwright browser dependencies
RUN apt-get update && apt-get install -y \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    libxshmfence1 \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm (yarn already in base image)
RUN npm install -g pnpm

# Install Mailcatcher
RUN gem install mailcatcher --no-document

# Install Caddy (for preview proxy)
RUN apt-get update && apt-get install -y debian-keyring debian-archive-keyring apt-transport-https \
    && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
    && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list \
    && apt-get update && apt-get install -y caddy \
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

# Install OpenCode CLI + sandbox-mcp
RUN npm install -g opencode-ai@latest proliferate-sandbox-mcp@0.1.16

# Install Python tools
RUN pip install httpx uv playwright psycopg2-binary redis

# Install Playwright browsers (Chromium only)
RUN playwright install chromium && playwright install-deps chromium

# Initialize PostgreSQL
RUN mkdir -p /var/run/postgresql && chown postgres:postgres /var/run/postgresql \
    && mkdir -p /var/lib/postgresql/data && chown postgres:postgres /var/lib/postgresql/data \
    && sudo -u postgres /usr/lib/postgresql/*/bin/initdb -D /var/lib/postgresql/data \
    && echo "local all all trust" > /var/lib/postgresql/data/pg_hba.conf \
    && echo "host all all 127.0.0.1/32 trust" >> /var/lib/postgresql/data/pg_hba.conf \
    && echo "host all all ::1/128 trust" >> /var/lib/postgresql/data/pg_hba.conf

# Create startup script for services with proper error logging
# Note: Don't use 'set -e' as we want services to start even if some fail
RUN echo '#!/bin/bash' > /usr/local/bin/start-services.sh \
    && echo 'echo "[start-services] Starting Docker daemon..."' >> /usr/local/bin/start-services.sh \
    && echo 'if ! pgrep -x dockerd > /dev/null 2>&1; then' >> /usr/local/bin/start-services.sh \
    && echo '  sudo dockerd > /var/log/docker.log 2>&1 &' >> /usr/local/bin/start-services.sh \
    && echo '  sleep 2' >> /usr/local/bin/start-services.sh \
    && echo 'fi' >> /usr/local/bin/start-services.sh \
    && echo 'mkdir -p /var/log/postgresql && chown postgres:postgres /var/log/postgresql 2>/dev/null || true' >> /usr/local/bin/start-services.sh \
    && echo 'echo "[start-services] Starting PostgreSQL..."' >> /usr/local/bin/start-services.sh \
    && echo 'if ! sudo -u postgres /usr/lib/postgresql/*/bin/pg_ctl -D /var/lib/postgresql/data -l /var/log/postgresql/postgresql.log start 2>/dev/null; then' >> /usr/local/bin/start-services.sh \
    && echo '  echo "[start-services] WARNING: PostgreSQL failed to start"' >> /usr/local/bin/start-services.sh \
    && echo 'fi' >> /usr/local/bin/start-services.sh \
    && echo 'echo "[start-services] Starting Redis..."' >> /usr/local/bin/start-services.sh \
    && echo 'redis-server --daemonize yes 2>/dev/null || echo "[start-services] WARNING: Redis failed to start"' >> /usr/local/bin/start-services.sh \
    && echo 'echo "[start-services] Starting Mailcatcher..."' >> /usr/local/bin/start-services.sh \
    && echo 'mailcatcher --ip 0.0.0.0 2>/dev/null || echo "[start-services] WARNING: Mailcatcher failed to start"' >> /usr/local/bin/start-services.sh \
    && echo 'echo "[start-services] Done"' >> /usr/local/bin/start-services.sh \
    && echo 'exit 0' >> /usr/local/bin/start-services.sh \
    && chmod +x /usr/local/bin/start-services.sh

# Install Docker (E2B supports this, unlike Modal)
RUN apt-get update && apt-get install -y \
    docker.io \
    docker-compose \
    && rm -rf /var/lib/apt/lists/*

# Pre-install OpenCode tool dependencies (saves ~10s per sandbox creation)
# These are used by verify.ts tool for S3 uploads
RUN mkdir -p /home/user/.opencode-tools && \
    printf '%s' '{"name":"opencode-tools","version":"1.0.0","private":true}' > /home/user/.opencode-tools/package.json && \
    cd /home/user/.opencode-tools && \
    npm install @aws-sdk/client-s3 @opencode-ai/plugin && \
    chown -R user:user /home/user/.opencode-tools

# Create metadata directory for session/repo tracking across pause/resume
RUN mkdir -p /home/user/.proliferate && \
    chown -R user:user /home/user/.proliferate

# Install Playwright MCP server globally for browser automation
RUN npm install -g playwright-mcp

# Configure SSH for terminal sessions (used by CLI)
RUN mkdir -p /home/user/.ssh && \
    touch /home/user/.ssh/authorized_keys && \
    chmod 700 /home/user/.ssh && \
    chmod 600 /home/user/.ssh/authorized_keys && \
    chown -R user:user /home/user/.ssh

# Add user to docker group so they can run docker without sudo
# Note: user is created by e2bdev/base image
RUN usermod -aG docker user || echo "Warning: Could not add user to docker group"

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

# Configure git to use per-repo credential helper
RUN git config --global credential.helper "/usr/local/bin/git-credential-proliferate" \
    && git config --global credential.useHttpPath true

ENV PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ENV GIT_ASKPASS="/usr/local/bin/git-askpass"
