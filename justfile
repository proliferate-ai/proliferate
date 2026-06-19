# Proliferate — task runner
#
# Run `just` to list recipes. Recipes delegate to the canonical `make` targets
# defined in the project Makefile and add WSL/local-dev conveniences with the
# Python venv activated up front.
#
# Conventions:
#   - Venv: ~/venvs/proliferate (Python 3.12) — see /memories/env_activation.md
#   - Server venv: server/.venv (uv-managed)
#   - Default dev profile: `main` (override with `PROFILE=foo just dev`)

set shell := ["bash", "-euo", "pipefail", "-c"]
set dotenv-load := false

# ---- variables --------------------------------------------------------------

profile      := env_var_or_default("PROFILE", "main")
api_port     := env_var_or_default("PROLIFERATE_API_PORT", "8001")
web_port     := env_var_or_default("PROLIFERATE_HOSTED_WEB_PORT", "5175")
anyh_port    := env_var_or_default("ANYHARNESS_PORT", "8457")
db_name      := env_var_or_default("PROLIFERATE_DEV_DB_NAME", "proliferate_dev_main")
db_url       := "postgresql+asyncpg://proliferate:localdev@127.0.0.1:5432/" + db_name

venv         := "source ~/venvs/proliferate/bin/activate"
server_venv  := "source " + justfile_directory() + "/server/.venv/bin/activate"

# ---- meta -------------------------------------------------------------------

# Default: list recipes
default:
    @just --list

# Print resolved config
info:
    @echo "profile     = {{ profile }}"
    @echo "api_port    = {{ api_port }}"
    @echo "web_port    = {{ web_port }}"
    @echo "anyh_port   = {{ anyh_port }}"
    @echo "db_name     = {{ db_name }}"
    @echo "db_url      = {{ db_url }}"
    @echo "venv        = ~/venvs/proliferate"
    @echo "server_venv = server/.venv"

# ---- bootstrap --------------------------------------------------------------

# One-shot first-time setup: pnpm install + server venv + dev profile + DB + migrations
bootstrap: install server-install profile-init infra-up db-create migrate sdk-build
    @echo "Bootstrap complete. Try: just api  (in one shell)  and  just web  (in another)."

# pnpm install at the repo root
install:
    pnpm install

# Create/refresh the server venv at server/.venv and install dev deps
server-install:
    cd server && uv venv .venv --python 3.12 && uv pip install -e ".[dev]"

# Initialize / refresh the dev profile (ports, runtime home, tauri config)
profile-init:
    make dev-init PROFILE={{ profile }}

# List all dev profiles
profile-list:
    make dev-list

# ---- infra (docker compose) -------------------------------------------------

# Bring up Postgres, Redis, RabbitMQ (idempotent)
infra-up:
    cd server && docker compose up -d db redis rabbitmq

# Show infra status
infra-ps:
    cd server && docker compose ps

# Tail infra logs (Ctrl-C to stop)
infra-logs:
    cd server && docker compose logs -f db redis rabbitmq

# Stop infra (keeps volumes)
infra-down:
    cd server && docker compose stop db redis rabbitmq

# ---- database ---------------------------------------------------------------

# Create the profile DB if missing
db-create:
    PGPASSWORD=localdev psql -h 127.0.0.1 -U proliferate -d postgres -tc \
        "SELECT 1 FROM pg_database WHERE datname='{{ db_name }}'" | grep -q 1 || \
    PGPASSWORD=localdev psql -h 127.0.0.1 -U proliferate -d postgres -c \
        "CREATE DATABASE {{ db_name }};"

# Run alembic migrations against the profile DB
migrate:
    {{ venv }} && {{ server_venv }} && cd server && \
        DATABASE_URL="{{ db_url }}" DEBUG=true JWT_SECRET=local-dev-secret \
        alembic upgrade head

# Roll all migrations down (DESTRUCTIVE)
migrate-down:
    {{ venv }} && {{ server_venv }} && cd server && \
        DATABASE_URL="{{ db_url }}" DEBUG=true JWT_SECRET=local-dev-secret \
        alembic downgrade base

# psql shell into the profile DB
psql:
    PGPASSWORD=localdev psql -h 127.0.0.1 -U proliferate -d {{ db_name }}

# ---- run services (foreground, one per terminal) ---------------------------

# Start the FastAPI server (foreground) on $api_port, venv activated
api:
    {{ venv }} && {{ server_venv }} && cd server && \
        DATABASE_URL="{{ db_url }}" DEBUG=true JWT_SECRET=local-dev-secret \
        uvicorn proliferate.main:app --host 0.0.0.0 --port {{ api_port }} \
            --proxy-headers --forwarded-allow-ips "*"

# Start the hosted web app (Vite) on $web_port — open http://localhost:{{ web_port }}/
# Binds to 127.0.0.1 so WSL2 auto-forwards the port to Windows `localhost`.
# Runs `pnpm dev` so all workspace packages (cloud-sdk, product-surfaces, etc.) are built first.
web:
    cd apps/web && \
        VITE_PROLIFERATE_API_BASE_URL="http://127.0.0.1:{{ api_port }}" \
        VITE_PROLIFERATE_DEV_TOKEN_LOGIN=true \
        pnpm dev --port {{ web_port }} --host 127.0.0.1 --strictPort

# Start the AnyHarness runtime sidecar on $anyh_port
anyharness:
    RUST_LOG=info ANYHARNESS_DEV_CORS=1 \
        cargo run --bin anyharness -- serve --port {{ anyh_port }}

# Run the automation worker (scheduler role)
worker:
    {{ venv }} && {{ server_venv }} && cd server && \
        python -m proliferate.server.automations.worker --role scheduler

# Full dev stack (runtime + server + web + desktop) via the Makefile
dev:
    make dev PROFILE={{ profile }}

# Dev stack with Stripe webhook listener
dev-stripe:
    make dev PROFILE={{ profile }} STRIPE=1

# ---- builds -----------------------------------------------------------------

# Build the AnyHarness CLI binary
anyharness-build:
    cargo build --bin anyharness

# Build the AnyHarness TS SDK (generates OpenAPI + tsc)
sdk-build:
    make sdk-build

# Build the React SDK
sdk-react-build:
    make sdk-react-build

# Build everything (Rust workspace + SDKs + desktop bundle)
build-all:
    make rebuild

# ---- checks & tests ---------------------------------------------------------

# Cargo check across the workspace
check:
    make check

# Run all linters & boundary checks
lint: check
    make check-max-lines
    make check-server-boundaries
    make check-worker-structure

# Server lint (ruff + mypy)
lint-server:
    make lint-server

# Rust workspace tests
test:
    make test

# Server pytest suite
test-server:
    make test-server

# Agent SDK spec tests
test-agent-spec:
    make test-agent-spec

# Rust formatter
fmt:
    make fmt

# Clippy with warnings as errors
clippy:
    make clippy

# ---- utilities --------------------------------------------------------------

# Show which ports are bound by our dev services
ports:
    @ss -ltnp 2>/dev/null | grep -E ':({{ api_port }}|{{ web_port }}|{{ anyh_port }})' || echo "no listeners on {{ api_port }}/{{ web_port }}/{{ anyh_port }}"

# Open the web app URL (WSL → Windows browser)
open-web:
    @echo "Open: http://localhost:{{ web_port }}/"
    @command -v wslview >/dev/null 2>&1 && wslview "http://localhost:{{ web_port }}/" || true

# Kill any process listening on our dev ports (use with care)
kill-dev-ports:
    @for p in {{ api_port }} {{ web_port }} {{ anyh_port }}; do \
        pid=$(ss -ltnp 2>/dev/null | awk -v port=":$p" '$4 ~ port {print $NF}' | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2 || true); \
        if [ -n "$pid" ]; then echo "killing $pid on :$p"; kill "$pid" || true; fi; \
    done

# Clean cargo + generated SDK artifacts
clean:
    make clean
