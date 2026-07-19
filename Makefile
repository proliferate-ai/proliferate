export PATH := $(HOME)/.cargo/bin:$(PATH)
CARGO := $(HOME)/.cargo/bin/cargo
TARGET := aarch64-apple-darwin
ifeq ($(shell uname -s),Darwin)
LOCAL_PGHOST ?= ::1
else
LOCAL_PGHOST ?= 127.0.0.1
endif
LOCAL_PGPORT ?= 5432
LOCAL_PGUSER ?= proliferate
LOCAL_PGPASSWORD ?= localdev
LOCAL_PGDATABASE ?= proliferate
USE_EXISTING_POSTGRES ?= 0
LOCAL_REDIS_HOST ?= 127.0.0.1
LOCAL_REDIS_PORT ?= 6379
USE_EXISTING_REDIS ?= 0
STRIPE_FORWARD_TO ?= http://127.0.0.1:8000/v1/billing/webhooks/stripe
STRIPE_SNAPSHOT_EVENTS ?= checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed
AGENT_GATEWAY ?= 0
BACKGROUND ?= 0
LOCAL_LITELLM_BASE_URL ?= http://127.0.0.1:14000
LOCAL_LITELLM_MASTER_KEY ?= sk-proliferate-local-dev
CLOUD_WORKER_TUNNEL ?= 0
AUTH_PROFILE ?=
SSO_STATUS ?= enabled
AWS_REGION ?= us-east-1
PROD_CLUSTER ?= proliferate-prod
PROD_SERVICE ?= proliferate-prod-server
PROD_LOG_GROUP ?=
PROD_LOG_SINCE ?= 30m
PROD_LOG_CONTAINER ?= server
PROD_APP_SECRET ?= proliferate/prod/server-app
PROD_DB_SECRET ?= proliferate/prod/database
PROD_DB_INSTANCE ?= proliferate-prod
SQL ?= select version_num from alembic_version;
LOCAL_CODEX_ACP ?= $(HOME)/codex-acp/target/debug/codex-acp
DEV_ANYHARNESS_TARGET_DIR ?= target/runtime-local
CLOUD_SSH_WORKER_API_PORT ?= 8044
CLOUD_SSH_WORKER_DB ?= proliferate_dev_ssh_worker_smoke
DESKTOP_RELEASE_WORKFLOW ?= Release Desktop
DESKTOP_RELEASE_REF ?= $(shell git branch --show-current 2>/dev/null)
LANE ?= local
DESKTOP ?= web
AGENTS ?= all
SCENARIOS ?= all
BEHAVIOR ?= diagnostic
DRY_RUN ?=
FILE_ISSUES ?=
DESKTOP_RELEASE_TARGET_OS ?= macos
DESKTOP_RELEASE_TAG ?= desktop-v$(shell node -p "require('./apps/desktop/package.json').version" 2>/dev/null)
SERVER_ENV_SOURCE = set -a; \
	[ ! -f .env ] || . .env; \
	[ ! -f .env.local ] || . .env.local; \
	[ ! -f server/.env ] || . server/.env; \
	[ ! -f server/.env.local ] || . server/.env.local; \
	set +a;
LOCAL_CODEX_ACP_ENV = if [ -z "$${ANYHARNESS_CODEX_AGENT_PROGRAM:-}" ] && [ -x "$(LOCAL_CODEX_ACP)" ]; then \
	export ANYHARNESS_CODEX_AGENT_PROGRAM="$(LOCAL_CODEX_ACP)"; \
	echo "Using local codex-acp: $$ANYHARNESS_CODEX_AGENT_PROGRAM"; \
fi;
STRIPE_LOCAL_SECRET_ENV = if [ -z "$${STRIPE_SECRET_KEY:-}" ] && command -v stripe >/dev/null 2>&1; then \
	stripe_secret_key=$$(stripe config --list 2>/dev/null | grep '^test_mode_api_key' | cut -d "'" -f2); \
	if [ -n "$$stripe_secret_key" ]; then \
		export STRIPE_SECRET_KEY="$$stripe_secret_key"; \
		echo "Using Stripe CLI test key for local billing API calls."; \
	fi; \
fi;
AUTH_PROFILE_ENV_SOURCE = auth_profile="$(AUTH_PROFILE)"; \
	if [ -n "$$auth_profile" ]; then \
		case "$$auth_profile" in *[!A-Za-z0-9_-]* ) \
			echo "AUTH_PROFILE must contain only letters, numbers, underscores, or hyphens."; \
			exit 1; \
		esac; \
		auth_env=".auth-env/.env.$$auth_profile"; \
		if [ ! -f "$$auth_env" ]; then \
			echo "Missing auth profile env file: $$auth_env"; \
			exit 1; \
		fi; \
		set -a; \
		. "$$auth_env"; \
		set +a; \
		export AUTH_PROFILE="$$auth_profile"; \
		echo "Loaded auth profile $$auth_profile from $$auth_env"; \
	fi;
DEV_FRONTEND_ARTIFACTS := \
	anyharness/sdk/dist \
	anyharness/sdk-react/dist \
	cloud/sdk/dist \
	cloud/sdk-react/dist \
	apps/packages/design/dist \
	apps/packages/product-domain/dist \
	apps/packages/ui/dist \
	apps/packages/product-ui/dist \
	apps/packages/product-surfaces/dist \
	apps/packages/product-client/dist
PROFILE_DB_READY_COMMAND = make server-db-ready;
PROFILE_DB_ENSURE_COMMAND = LOCAL_PGHOST="$(LOCAL_PGHOST)" LOCAL_PGPORT="$(LOCAL_PGPORT)" LOCAL_PGUSER="$(LOCAL_PGUSER)" LOCAL_PGPASSWORD="$(LOCAL_PGPASSWORD)" USE_EXISTING_POSTGRES="$(USE_EXISTING_POSTGRES)" node scripts/dev.mjs ensure-db --db-name "$$PROLIFERATE_DEV_DB_NAME";
PROFILE_REDIS_READY_COMMAND = make server-redis-ready;
ifneq ($(origin DATABASE_URL), undefined)
PROFILE_DB_READY_COMMAND = :;
PROFILE_DB_ENSURE_COMMAND = :;
endif

ifneq ($(filter dev dev-init setup run seed-sso,$(MAKECMDGOALS)),)
ifeq ($(strip $(PROFILE)),)
$(error PROFILE is required. Example: make dev PROFILE=main)
endif
endif

.PHONY: catalog-view catalog-pin catalog-update setup run dev dev-init dev-list dev-local dev-desktop dev-runtime dev-server dev-mobile-auth dev-mobile-tunnel dev-web-auth seed-sso server-db-up server-db-wait \
        server-db-down server-db-ready server-redis-up server-redis-wait server-redis-down server-redis-ready \
        server-background-up server-background-logs server-background-down \
        server-litellm-up server-litellm-wait server-litellm-down db db-local db-ah server-migrate serve install \
        check check-max-lines check-server-boundaries test test-server fmt clippy \
        dev-automation-worker \
        sdk-generate sdk-build sdk-react-build cloud-sdk-build cloud-sdk-react-build shared-build dev-artifacts-ready build-rust runtime-build web-build desktop-build build-frontend build rebuild \
        desktop-test-build release-desktop-dry-run release-desktop-draft \
        test-agent-spec test-agent-runtime-local test-agent-local-fast test-agent-local \
        test-agent-runtime-cloud-e2b \
        cloud-runtime-build publish-cloud-template-env-local \
        test-cloud-ssh-worker dev-cloud-ssh-worker \
        test-cloud-e2b test-cloud-all test-cloud-webhooks \
        cloud-openapi cloud-client-generate \
        stripe-setup-test \
        stage-sidecar \
        prod-service prod-taskdef prod-tasks prod-task prod-logs prod-secret-keys \
        prod-db-url prod-sql prod-psql prod-rds \
        db-migrate-up db-migrate-down \
        release-e2e \
        all clean

# --- Profile dev (setup, build, and run are separate) ---

dev: setup run

dev-artifacts-ready:
	@runtime_bin="$${ANYHARNESS_DEV_RUNTIME_BIN:-$(DEV_ANYHARNESS_TARGET_DIR)/debug/anyharness}"; \
	missing_rust=0; \
	missing_frontend=0; \
	if [ ! -x "$$runtime_bin" ]; then \
		echo "Missing AnyHarness runtime binary: $$runtime_bin"; \
		missing_rust=1; \
	elif grep -a -q "sidecar is not available\\|unsupported target placeholder" "$$runtime_bin" 2>/dev/null; then \
		echo "AnyHarness runtime binary is a sidecar placeholder: $$runtime_bin"; \
		missing_rust=1; \
	fi; \
	for artifact in $(DEV_FRONTEND_ARTIFACTS); do \
		if [ ! -d "$$artifact" ]; then \
			echo "Missing frontend build artifact: $$artifact"; \
			missing_frontend=1; \
		fi; \
	done; \
	if [ "$$missing_rust" = "1" ] || [ "$$missing_frontend" = "1" ]; then \
		if [ "$$missing_rust" = "1" ] && [ "$$missing_frontend" = "1" ]; then \
			echo "Run: make build"; \
		elif [ "$$missing_rust" = "1" ]; then \
			echo "Run: make build-rust"; \
		else \
			echo "Run: make build-frontend"; \
		fi; \
		exit 1; \
	fi

run: dev-artifacts-ready
	@set -e; \
	if [ -z "$(PROFILE)" ]; then \
		echo "PROFILE is required. Example: make run PROFILE=main"; \
		exit 1; \
	fi; \
	launch_env=$$( \
		PROLIFERATE_API_PORT="$(PROLIFERATE_API_PORT)" \
		PROLIFERATE_WEB_PORT="$(PROLIFERATE_WEB_PORT)" \
		PROLIFERATE_WEB_HMR_PORT="$(PROLIFERATE_WEB_HMR_PORT)" \
		PROLIFERATE_HOSTED_WEB_PORT="$(PROLIFERATE_HOSTED_WEB_PORT)" \
		PROLIFERATE_MOBILE_WEB_PORT="$(PROLIFERATE_MOBILE_WEB_PORT)" \
		PROLIFERATE_GOOGLE_WORKSPACE_MCP_PORT_BASE="$(PROLIFERATE_GOOGLE_WORKSPACE_MCP_PORT_BASE)" \
		ANYHARNESS_PORT="$(ANYHARNESS_PORT)" \
		ANYHARNESS_RUNTIME_HOME="$(ANYHARNESS_RUNTIME_HOME)" \
		PROLIFERATE_DEV_HOME="$(PROLIFERATE_DEV_HOME)" \
		PROLIFERATE_DEV_DB_NAME="$(PROLIFERATE_DEV_DB_NAME)" \
		node scripts/dev.mjs ensure --profile "$(PROFILE)" --lock \
	); \
	database_url_override_set="$${DATABASE_URL+x}"; \
	database_url_override_value="$${DATABASE_URL:-}"; \
	cleanup() { \
		status=$$?; \
		trap - EXIT INT TERM; \
		if [ -n "$${PROLIFERATE_DEV_HOME:-}" ]; then \
			rm -f "$$(dirname "$$PROLIFERATE_DEV_HOME")/run.lock"; \
		fi; \
		kill 0 >/dev/null 2>&1 || true; \
		exit $$status; \
	}; \
	trap cleanup EXIT INT TERM; \
	$(SERVER_ENV_SOURCE) \
	. "$$launch_env"; \
	$(AUTH_PROFILE_ENV_SOURCE) \
	$(STRIPE_LOCAL_SECRET_ENV) \
	$(LOCAL_CODEX_ACP_ENV) \
	$(PROFILE_REDIS_READY_COMMAND) \
	if [ "$$database_url_override_set" = "x" ]; then \
		export DATABASE_URL="$$database_url_override_value"; \
		use_profile_db=0; \
	else \
		$(PROFILE_DB_READY_COMMAND) \
		export DATABASE_URL="$$( \
			LOCAL_PGHOST="$(LOCAL_PGHOST)" \
			LOCAL_PGPORT="$(LOCAL_PGPORT)" \
			LOCAL_PGUSER="$(LOCAL_PGUSER)" \
			LOCAL_PGPASSWORD="$(LOCAL_PGPASSWORD)" \
			node scripts/dev.mjs database-url --db-name "$$PROLIFERATE_DEV_DB_NAME" \
		)"; \
		use_profile_db=1; \
	fi; \
	export API_BASE_URL="http://127.0.0.1:$$PROLIFERATE_API_PORT"; \
	export FRONTEND_BASE_URL="$${FRONTEND_BASE_URL:-http://127.0.0.1:$$PROLIFERATE_HOSTED_WEB_PORT}"; \
	if [ -n "$${AUTH_PROFILE:-}" ]; then \
		sso_oidc_callback_base_url="$${PROLIFERATE_SSO_OIDC_CALLBACK_BASE_URL:-$$API_BASE_URL}"; \
		echo "SSO callback URL for provider console: $$sso_oidc_callback_base_url/auth/sso/oidc/callback"; \
	fi; \
	export CORS_ALLOW_ORIGINS="http://localhost:$$PROLIFERATE_WEB_PORT,http://127.0.0.1:$$PROLIFERATE_WEB_PORT,http://localhost:$$PROLIFERATE_HOSTED_WEB_PORT,http://127.0.0.1:$$PROLIFERATE_HOSTED_WEB_PORT,http://localhost:$$PROLIFERATE_MOBILE_WEB_PORT,http://127.0.0.1:$$PROLIFERATE_MOBILE_WEB_PORT,http://tauri.localhost,tauri://localhost"; \
	export STRIPE_CHECKOUT_SUCCESS_URL="$$FRONTEND_BASE_URL/settings/cloud?checkout=success"; \
	export STRIPE_CHECKOUT_CANCEL_URL="$$FRONTEND_BASE_URL/settings/cloud?checkout=cancel"; \
	export STRIPE_CUSTOMER_PORTAL_RETURN_URL="$$FRONTEND_BASE_URL/settings/cloud"; \
	export STRIPE_FORWARD_TO="http://127.0.0.1:$$PROLIFERATE_API_PORT/v1/billing/webhooks/stripe"; \
	cloud_worker_tunnel_mode="$(CLOUD_WORKER_TUNNEL)"; \
	if [ "$$cloud_worker_tunnel_mode" = "ngrok" ] || [ "$$cloud_worker_tunnel_mode" = "1" ]; then \
		if ! command -v ngrok >/dev/null 2>&1; then \
			echo "ngrok is required for CLOUD_WORKER_TUNNEL=ngrok."; \
			exit 1; \
		fi; \
		cloud_worker_ngrok_url=$$(node scripts/dev-ngrok-tunnel-url.mjs --port "$$PROLIFERATE_API_PORT" 2>/dev/null || true); \
		if [ -z "$$cloud_worker_ngrok_url" ]; then \
			echo "Starting ngrok tunnel for Cloud worker callbacks :$$PROLIFERATE_API_PORT"; \
			ngrok http "$$PROLIFERATE_API_PORT" --log=stdout --log-format=json > "/tmp/proliferate-cloud-worker-$$PROLIFERATE_DEV_PROFILE-ngrok.log" 2>&1 & \
			cloud_worker_ngrok_url=$$(node scripts/dev-ngrok-tunnel-url.mjs --port "$$PROLIFERATE_API_PORT" --wait-ms 45000); \
		else \
			echo "Using existing ngrok tunnel for Cloud worker callbacks: $$cloud_worker_ngrok_url"; \
		fi; \
		export CLOUD_WORKER_BASE_URL="$${CLOUD_WORKER_BASE_URL:-$$cloud_worker_ngrok_url}"; \
		export CLOUD_MCP_OAUTH_CALLBACK_BASE_URL="$${CLOUD_MCP_OAUTH_CALLBACK_BASE_URL:-$$cloud_worker_ngrok_url}"; \
		echo "Cloud worker public callback URL: $$CLOUD_WORKER_BASE_URL"; \
	elif [ "$$cloud_worker_tunnel_mode" != "0" ]; then \
		echo "Unsupported CLOUD_WORKER_TUNNEL=$$cloud_worker_tunnel_mode. Use 0, 1, or ngrok."; \
		exit 1; \
	fi; \
	if [ "$$use_profile_db" = "1" ]; then \
		$(PROFILE_DB_ENSURE_COMMAND) \
	fi; \
	agent_gateway_mode="$(AGENT_GATEWAY)"; \
	if [ "$$agent_gateway_mode" = "1" ] || [ "$$agent_gateway_mode" = "litellm" ]; then \
		export AGENT_GATEWAY_ENABLED=true; \
		export AGENT_GATEWAY_LITELLM_BASE_URL="$${AGENT_GATEWAY_LITELLM_BASE_URL:-$(LOCAL_LITELLM_BASE_URL)}"; \
		export AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL="$${AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL:-$$AGENT_GATEWAY_LITELLM_BASE_URL}"; \
		if [ -z "$${LITELLM_MASTER_KEY:-}" ] && [ -z "$${AGENT_GATEWAY_LITELLM_MASTER_KEY:-}" ]; then \
			case "$$AGENT_GATEWAY_LITELLM_BASE_URL" in \
				*127.0.0.1*|*localhost*) \
					echo "WARNING: LITELLM_MASTER_KEY unset; booting the local LiteLLM proxy with the well-known dev default ($(LOCAL_LITELLM_MASTER_KEY)). Set LITELLM_MASTER_KEY for anything shared." >&2; \
					export LITELLM_MASTER_KEY="$(LOCAL_LITELLM_MASTER_KEY)"; \
					;; \
				*) \
					echo "ERROR: AGENT_GATEWAY_LITELLM_BASE_URL=$$AGENT_GATEWAY_LITELLM_BASE_URL is not local but LITELLM_MASTER_KEY/AGENT_GATEWAY_LITELLM_MASTER_KEY are unset. Refusing to boot with a default master key. Set the master key explicitly." >&2; \
					exit 1; \
					;; \
			esac; \
		fi; \
		export LITELLM_MASTER_KEY="$${LITELLM_MASTER_KEY:-$(LOCAL_LITELLM_MASTER_KEY)}"; \
		export AGENT_GATEWAY_LITELLM_MASTER_KEY="$${AGENT_GATEWAY_LITELLM_MASTER_KEY:-$$LITELLM_MASTER_KEY}"; \
		make server-litellm-up; \
		make server-litellm-wait; \
		echo "Agent gateway LiteLLM enabled: admin $$AGENT_GATEWAY_LITELLM_BASE_URL, public $$AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL"; \
	elif [ "$$agent_gateway_mode" != "0" ]; then \
		echo "Unsupported AGENT_GATEWAY=$$agent_gateway_mode. Use 0, 1, or litellm."; \
		exit 1; \
	fi; \
	(cd server && DATABASE_URL="$$DATABASE_URL" .venv/bin/alembic upgrade head); \
	background_mode="$(BACKGROUND)"; \
	if [ "$$background_mode" = "1" ] || [ "$$background_mode" = "celery" ]; then \
		if [ "$$use_profile_db" != "1" ]; then \
			echo "ERROR: BACKGROUND=$$background_mode requires the profile database (do not set DATABASE_URL). The compose worker/beat reach the SAME host Postgres/profile DB the API uses." >&2; \
			exit 1; \
		fi; \
		: "$${PROLIFERATE_RABBITMQ_HOST_PORT:?background port not allocated; run make setup PROFILE=$(PROFILE)}"; \
		: "$${PROLIFERATE_RABBITMQ_MGMT_HOST_PORT:?background port not allocated; run make setup PROFILE=$(PROFILE)}"; \
		: "$${PROLIFERATE_REDIS_HOST_PORT:?background port not allocated; run make setup PROFILE=$(PROFILE)}"; \
		export PROLIFERATE_RABBITMQ_HOST_PORT PROLIFERATE_RABBITMQ_MGMT_HOST_PORT PROLIFERATE_REDIS_HOST_PORT; \
		export PROLIFERATE_DB_HOST_PORT="$${PROLIFERATE_DB_HOST_PORT:-$(LOCAL_PGPORT)}"; \
		: "$${DATABASE_URL:?}"; \
		background_db_url="$$(node scripts/dev.mjs background-db-url --database-url "$$DATABASE_URL")"; \
		if printf '%s' "$$background_db_url" | grep -Eq '@(127\.0\.0\.1|localhost|\[?::1\]?):'; then \
			echo "ERROR: could not rewrite DATABASE_URL host to host.docker.internal for the background plane (got $$background_db_url)." >&2; \
			exit 1; \
		fi; \
		export COMPOSE_PROJECT_NAME="proliferate_bg_$$(printf '%s' "$$PROLIFERATE_DEV_PROFILE" | tr '-' '_')"; \
		export BACKGROUND_DATABASE_URL="$$background_db_url"; \
		echo "Starting background plane (worker + beat) via compose project $$COMPOSE_PROJECT_NAME against $$background_db_url (broker :$$PROLIFERATE_RABBITMQ_HOST_PORT, store :$$PROLIFERATE_REDIS_HOST_PORT)"; \
		docker compose -f server/docker-compose.yml --profile background up -d --no-deps --build rabbitmq redis worker beat; \
	fi; \
	stripe_listener_ready=0; \
	if [ "$(STRIPE)" = "1" ]; then \
		if command -v stripe >/dev/null 2>&1; then \
			stripe_listener_ready=1; \
		else \
			echo "Skipping Stripe listener. Install Stripe CLI if you need billing webhooks."; \
		fi; \
	fi; \
	if [ "$$stripe_listener_ready" = "1" ]; then \
		stripe_webhook_secret=$$(stripe listen --print-secret 2>/dev/null || true); \
		if [ -n "$$stripe_webhook_secret" ]; then \
			export STRIPE_WEBHOOK_SECRET="$$stripe_webhook_secret"; \
		fi; \
		stripe listen --events "$(STRIPE_SNAPSHOT_EVENTS)" --forward-to "$$STRIPE_FORWARD_TO" & \
	fi; \
	runtime_bin="$${ANYHARNESS_DEV_RUNTIME_BIN:-$(DEV_ANYHARNESS_TARGET_DIR)/debug/anyharness}"; \
	echo "Starting profile $$PROLIFERATE_DEV_PROFILE: runtime :$$ANYHARNESS_PORT, backend :$$PROLIFERATE_API_PORT, desktop :$$PROLIFERATE_WEB_PORT, web :$$PROLIFERATE_HOSTED_WEB_PORT, mobile web :$$PROLIFERATE_MOBILE_WEB_PORT"; \
	RUST_LOG=info ANYHARNESS_DEV_CORS=1 "$$runtime_bin" serve --port "$$ANYHARNESS_PORT" --runtime-home "$$ANYHARNESS_RUNTIME_HOME" & \
	(cd server && .venv/bin/uvicorn proliferate.main:app --reload --host 127.0.0.1 --port "$$PROLIFERATE_API_PORT") & \
	echo "Starting hosted web app..."; \
	(cd apps/web && VITE_PROLIFERATE_API_BASE_URL="$$API_BASE_URL" VITE_PROLIFERATE_DEV_TOKEN_LOGIN="$${VITE_PROLIFERATE_DEV_TOKEN_LOGIN:-true}" pnpm dev --host 127.0.0.1 --port "$$PROLIFERATE_HOSTED_WEB_PORT" --strictPort) & \
	sleep 2; \
	(cd apps/desktop && pnpm tauri dev --runner "$$(dirname "$$PROLIFERATE_DEV_HOME")/tauri-runner.sh" --config "$$(dirname "$$PROLIFERATE_DEV_HOME")/tauri.dev.json")

setup:
	@if [ -z "$(PROFILE)" ]; then \
		echo "PROFILE is required. Example: make setup PROFILE=main"; \
		exit 1; \
	fi; \
	database_url_override_set="$${DATABASE_URL+x}"; \
	launch_env=$$( \
		PROLIFERATE_API_PORT="$(PROLIFERATE_API_PORT)" \
		PROLIFERATE_WEB_PORT="$(PROLIFERATE_WEB_PORT)" \
		PROLIFERATE_WEB_HMR_PORT="$(PROLIFERATE_WEB_HMR_PORT)" \
		PROLIFERATE_HOSTED_WEB_PORT="$(PROLIFERATE_HOSTED_WEB_PORT)" \
		PROLIFERATE_MOBILE_WEB_PORT="$(PROLIFERATE_MOBILE_WEB_PORT)" \
		PROLIFERATE_GOOGLE_WORKSPACE_MCP_PORT_BASE="$(PROLIFERATE_GOOGLE_WORKSPACE_MCP_PORT_BASE)" \
		ANYHARNESS_PORT="$(ANYHARNESS_PORT)" \
		ANYHARNESS_RUNTIME_HOME="$(ANYHARNESS_RUNTIME_HOME)" \
		PROLIFERATE_DEV_HOME="$(PROLIFERATE_DEV_HOME)" \
		PROLIFERATE_DEV_DB_NAME="$(PROLIFERATE_DEV_DB_NAME)" \
		node scripts/dev.mjs ensure --profile "$(PROFILE)" \
	); \
	if [ "$$database_url_override_set" = "x" ]; then \
		echo "Skipping profile database creation because DATABASE_URL is set."; \
	else \
		. "$$launch_env"; \
		$(PROFILE_DB_READY_COMMAND) \
		$(PROFILE_DB_ENSURE_COMMAND) \
	fi

dev-init: setup

dev-list:
	@node scripts/dev.mjs list

dev-local: export PROLIFERATE_DEV := 1
dev-local: sdk-build
	@echo "Starting desktop app with the bundled AnyHarness sidecar and no control plane..."
	cd apps/desktop && pnpm tauri dev --config src-tauri/tauri.dev.json

# --- Individual dev targets ---

dev-desktop: export ANYHARNESS_DEV_URL := http://127.0.0.1:8457
dev-desktop: export VITE_ANYHARNESS_DEV_URL := http://127.0.0.1:8457
dev-desktop: export PROLIFERATE_DEV := 1
dev-desktop:
	cd apps/desktop && pnpm tauri dev --config src-tauri/tauri.dev.json

dev-runtime: export ANYHARNESS_DEV_CORS := 1
dev-runtime: export PROLIFERATE_DEV := 1
dev-runtime: sdk-build
	@$(SERVER_ENV_SOURCE) \
	$(LOCAL_CODEX_ACP_ENV) \
	$(CARGO) run --bin anyharness -- serve

serve:
	@$(SERVER_ENV_SOURCE) \
	$(LOCAL_CODEX_ACP_ENV) \
	$(CARGO) run --bin anyharness -- serve

dev-automation-worker:
	@echo "Automation scheduler is parked while automations are retargeted to repo environments."
	@echo "make run PROFILE=<name> does not start automation workers in this stack."

dev-mobile-auth:
	@node scripts/dev-mobile-auth.mjs

dev-mobile-tunnel: dev-mobile-auth

dev-web-auth:
	@node scripts/dev-web-auth.mjs

seed-sso:
	@set -e; \
	org_id="$(ORG_ID)"; \
	if [ -z "$$org_id" ]; then org_id="$(org_id)"; fi; \
	if [ -z "$$org_id" ]; then \
		echo "ORG_ID is required. Example: make seed-sso PROFILE=sso-org AUTH_PROFILE=google ORG_ID=<org-id>"; \
		exit 1; \
	fi; \
	database_url_override_set="$${DATABASE_URL+x}"; \
	database_url_override_value="$${DATABASE_URL:-}"; \
	launch_env=$$( \
		PROLIFERATE_API_PORT="$(PROLIFERATE_API_PORT)" \
		PROLIFERATE_WEB_PORT="$(PROLIFERATE_WEB_PORT)" \
		PROLIFERATE_WEB_HMR_PORT="$(PROLIFERATE_WEB_HMR_PORT)" \
		PROLIFERATE_HOSTED_WEB_PORT="$(PROLIFERATE_HOSTED_WEB_PORT)" \
		PROLIFERATE_MOBILE_WEB_PORT="$(PROLIFERATE_MOBILE_WEB_PORT)" \
		PROLIFERATE_GOOGLE_WORKSPACE_MCP_PORT_BASE="$(PROLIFERATE_GOOGLE_WORKSPACE_MCP_PORT_BASE)" \
		ANYHARNESS_PORT="$(ANYHARNESS_PORT)" \
		ANYHARNESS_RUNTIME_HOME="$(ANYHARNESS_RUNTIME_HOME)" \
		PROLIFERATE_DEV_HOME="$(PROLIFERATE_DEV_HOME)" \
		PROLIFERATE_DEV_DB_NAME="$(PROLIFERATE_DEV_DB_NAME)" \
		node scripts/dev.mjs ensure --profile "$(PROFILE)" \
	); \
	$(SERVER_ENV_SOURCE) \
	. "$$launch_env"; \
	$(AUTH_PROFILE_ENV_SOURCE) \
	if [ -z "$${AUTH_PROFILE:-}" ]; then \
		echo "AUTH_PROFILE is required. Example: make seed-sso PROFILE=sso-org AUTH_PROFILE=google ORG_ID=<org-id>"; \
		exit 1; \
	fi; \
	if [ "$$database_url_override_set" = "x" ]; then \
		export DATABASE_URL="$$database_url_override_value"; \
	else \
		$(PROFILE_DB_READY_COMMAND) \
		export DATABASE_URL="$$( \
			LOCAL_PGHOST="$(LOCAL_PGHOST)" \
			LOCAL_PGPORT="$(LOCAL_PGPORT)" \
			LOCAL_PGUSER="$(LOCAL_PGUSER)" \
			LOCAL_PGPASSWORD="$(LOCAL_PGPASSWORD)" \
			node scripts/dev.mjs database-url --db-name "$$PROLIFERATE_DEV_DB_NAME" \
		)"; \
		$(PROFILE_DB_ENSURE_COMMAND) \
	fi; \
	export API_BASE_URL="http://127.0.0.1:$$PROLIFERATE_API_PORT"; \
	echo "Seeding org SSO for profile $$PROLIFERATE_DEV_PROFILE with auth profile $$AUTH_PROFILE"; \
	(cd server && DATABASE_URL="$$DATABASE_URL" uv run alembic upgrade head); \
	(cd server && DATABASE_URL="$$DATABASE_URL" uv run python ../scripts/seed_sso.py --org-id "$$org_id" --status "$(SSO_STATUS)")

# --- Server (Python control plane) ---

server-db-up:
	@command -v docker >/dev/null 2>&1 || { \
		echo "Docker is required for backend development. Install or start Docker and retry."; \
		exit 1; \
	}
	@docker info >/dev/null 2>&1 || { \
		echo "Docker is not running. Start Docker Desktop and retry."; \
		exit 1; \
	}
	@docker compose -f server/docker-compose.yml up -d db

server-db-wait:
	@attempts=0; \
	until docker compose -f server/docker-compose.yml exec -T db pg_isready -U proliferate -d proliferate >/dev/null 2>&1; do \
		attempts=$$((attempts + 1)); \
		if [ $$attempts -ge 30 ]; then \
			echo "Local Postgres did not become ready. Check \`docker compose -f server/docker-compose.yml logs db\`."; \
			exit 1; \
		fi; \
		sleep 1; \
	done

server-db-down:
	@docker compose -f server/docker-compose.yml stop db

server-redis-up:
	@command -v docker >/dev/null 2>&1 || { \
		echo "Docker is required for backend development. Install or start Docker and retry."; \
		exit 1; \
	}
	@docker info >/dev/null 2>&1 || { \
		echo "Docker is not running. Start Docker Desktop and retry."; \
		exit 1; \
	}
	@docker compose -f server/docker-compose.yml up -d redis

server-redis-wait:
	@attempts=0; \
	until docker compose -f server/docker-compose.yml exec -T redis redis-cli ping >/dev/null 2>&1; do \
		attempts=$$((attempts + 1)); \
		if [ $$attempts -ge 30 ]; then \
			echo "Local Redis did not become ready. Check \`docker compose -f server/docker-compose.yml logs redis\`."; \
			exit 1; \
		fi; \
		sleep 1; \
	done

server-redis-down:
	@docker compose -f server/docker-compose.yml stop redis

# Self-contained local background plane: Postgres, RabbitMQ, Redis, migrations,
# Celery worker, and Celery Beat, all on the same compose image. This is the
# merge-gated same-image outbox->worker smoke vehicle. Set a per-worktree
# COMPOSE_PROJECT_NAME plus PROLIFERATE_*_HOST_PORT overrides to run isolated
# stacks side by side without default-port collisions.
server-background-up:
	@command -v docker >/dev/null 2>&1 || { \
		echo "Docker is required for the local background plane. Install or start Docker and retry."; \
		exit 1; \
	}
	@docker info >/dev/null 2>&1 || { \
		echo "Docker is not running. Start Docker Desktop and retry."; \
		exit 1; \
	}
	@docker compose -f server/docker-compose.yml --profile background up -d --build \
		db rabbitmq redis migrate worker beat
	@echo "Background plane up (worker + beat). Logs: make server-background-logs"

server-background-logs:
	@docker compose -f server/docker-compose.yml --profile background logs -f worker beat

server-background-down:
	@docker compose -f server/docker-compose.yml --profile background down

server-litellm-up:
	@command -v docker >/dev/null 2>&1 || { \
		echo "Docker is required for the local LiteLLM gateway. Install or start Docker and retry."; \
		exit 1; \
	}
	@docker info >/dev/null 2>&1 || { \
		echo "Docker is not running. Start Docker Desktop and retry."; \
		exit 1; \
	}
	@docker compose -f server/docker-compose.yml up -d litellm

server-litellm-wait:
	@attempts=0; \
	until curl -fsS "$(LOCAL_LITELLM_BASE_URL)/health/liveliness" >/dev/null 2>&1; do \
		attempts=$$((attempts + 1)); \
		if [ $$attempts -ge 30 ]; then \
			echo "Local LiteLLM did not become ready. Check \`docker compose -f server/docker-compose.yml logs litellm\`."; \
			exit 1; \
		fi; \
		sleep 1; \
	done

server-litellm-down:
	@docker compose -f server/docker-compose.yml stop litellm litellm-db

server-redis-ready:
ifeq ($(USE_EXISTING_REDIS),1)
	@host="$(LOCAL_REDIS_HOST)"; port="$(LOCAL_REDIS_PORT)"; \
	for _ in $$(seq 1 30); do \
		python3 -c 'import socket, sys; socket.create_connection((sys.argv[1], int(sys.argv[2])), timeout=1).close()' "$$host" "$$port" >/dev/null 2>&1 && exit 0; \
		sleep 1; \
	done; \
	echo "Redis is not reachable at $$host:$$port." >&2; \
	exit 1
else
	@$(MAKE) server-redis-up
	@$(MAKE) server-redis-wait
endif

db: server-db-ready
	@docker compose -f server/docker-compose.yml exec db psql -U proliferate -d proliferate

db-local:
	@command -v psql >/dev/null 2>&1 || { \
		echo "psql is required for \`make db-local\`. Install Postgres client tools and retry."; \
		exit 1; \
	}
	@db_name="$(LOCAL_PGDATABASE)"; \
	if [ -n "$(PROFILE)" ]; then \
		db_name="proliferate_dev_$$(echo "$(PROFILE)" | tr '-' '_')"; \
	fi; \
	PGPASSWORD="$(LOCAL_PGPASSWORD)" psql \
		-h "$(LOCAL_PGHOST)" \
		-p "$(LOCAL_PGPORT)" \
		-U "$(LOCAL_PGUSER)" \
		-d "$$db_name"

db-ah:
	@sqlite3 -cmd ".headers on" -cmd ".mode column" $(HOME)/.proliferate-local/anyharness/db.sqlite

# --- Release helpers ---

# Build a TEST-FLAVOR desktop app whose auto-updater points at a local manifest
# server (UPDATER_URL) and trusts a throwaway key. For the tier-4 upgrade test.
# The shipped tauri.conf.json is untouched -- a gitignored overlay is merged via
# `tauri build --config`. See specs/developing/testing/desktop-update-testing.md.
#   make desktop-test-build UPDATER_URL=http://127.0.0.1:8787/latest.json
desktop-test-build:
	@test -n "$(UPDATER_URL)" || { echo "UPDATER_URL is required. Example: make desktop-test-build UPDATER_URL=http://127.0.0.1:8787/latest.json"; exit 1; }
	UPDATER_URL="$(UPDATER_URL)" UPDATER_PUBKEY="$(UPDATER_PUBKEY)" TARGET="$(TARGET)" BUNDLES="$(BUNDLES)" \
		bash apps/desktop/scripts/build-updater-test.sh

release-desktop-dry-run:
	@set -e; \
	command -v gh >/dev/null 2>&1 || { echo "GitHub CLI is required: brew install gh"; exit 1; }; \
	ref="$(DESKTOP_RELEASE_REF)"; \
	if [ -z "$$ref" ]; then \
		echo "DESKTOP_RELEASE_REF is required. Example: make release-desktop-dry-run DESKTOP_RELEASE_REF=feat/my-branch"; \
		exit 1; \
	fi; \
	echo "Triggering $(DESKTOP_RELEASE_WORKFLOW) build dry run on $$ref..."; \
	gh workflow run "$(DESKTOP_RELEASE_WORKFLOW)" \
		--ref "$$ref" \
		-f dry_run=true \
		-f target_os="$(DESKTOP_RELEASE_TARGET_OS)"; \
	echo ""; \
	echo "Next:"; \
	echo "  gh run list --workflow \"$(DESKTOP_RELEASE_WORKFLOW)\" --limit 5"; \
	echo "  gh run watch <RUN_ID>"

release-desktop-draft:
	@set -e; \
	command -v gh >/dev/null 2>&1 || { echo "GitHub CLI is required: brew install gh"; exit 1; }; \
	tag="$(DESKTOP_RELEASE_TAG)"; \
	if [ -z "$$tag" ] || [ "$$tag" = "desktop-v" ]; then \
		echo "DESKTOP_RELEASE_TAG is required. Example: make release-desktop-draft DESKTOP_RELEASE_TAG=desktop-v0.1.28"; \
		exit 1; \
	fi; \
	git ls-remote --exit-code --tags origin "$$tag" >/dev/null || { \
		echo "Tag $$tag does not exist on origin. Create and push the tag before draft-release preview."; \
		exit 1; \
	}; \
	echo "Triggering $(DESKTOP_RELEASE_WORKFLOW) draft release preview on $$tag with updater publish disabled..."; \
	gh workflow run "$(DESKTOP_RELEASE_WORKFLOW)" \
		--ref "$$tag" \
		-f dry_run=false \
		-f publish_updater=false \
		-f target_os="$(DESKTOP_RELEASE_TARGET_OS)"; \
	echo ""; \
	echo "Next:"; \
	echo "  gh run list --workflow \"$(DESKTOP_RELEASE_WORKFLOW)\" --limit 5"; \
	echo "  gh run watch <RUN_ID>"

# --- Production ops shortcuts ---

prod-service:
	@aws ecs describe-services \
		--region "$(AWS_REGION)" \
		--cluster "$(PROD_CLUSTER)" \
		--services "$(PROD_SERVICE)" \
		--query 'services[0].{service:serviceName,taskDefinition:taskDefinition,desired:desiredCount,running:runningCount,pending:pendingCount,exec:enableExecuteCommand}' \
		--output table

prod-taskdef:
	@task_definition=$$(aws ecs describe-services \
		--region "$(AWS_REGION)" \
		--cluster "$(PROD_CLUSTER)" \
		--services "$(PROD_SERVICE)" \
		--query 'services[0].taskDefinition' \
		--output text); \
	aws ecs describe-task-definition \
		--region "$(AWS_REGION)" \
		--task-definition "$$task_definition" \
		--query 'taskDefinition.containerDefinitions[0].{image:image,env:environment[].name,secrets:secrets[].name,command:command,entryPoint:entryPoint}' \
		--output json

prod-tasks:
	@aws ecs list-tasks \
		--region "$(AWS_REGION)" \
		--cluster "$(PROD_CLUSTER)" \
		--service-name "$(PROD_SERVICE)" \
		--desired-status RUNNING \
		--output text

prod-task:
	@task_arn=$$(aws ecs list-tasks \
		--region "$(AWS_REGION)" \
		--cluster "$(PROD_CLUSTER)" \
		--service-name "$(PROD_SERVICE)" \
		--desired-status RUNNING \
		--query 'taskArns[0]' \
		--output text); \
	aws ecs describe-tasks \
		--region "$(AWS_REGION)" \
		--cluster "$(PROD_CLUSTER)" \
		--tasks "$$task_arn" \
		--query 'tasks[0].{task:taskArn,lastStatus:lastStatus,health:healthStatus,startedAt:startedAt,image:containers[0].image,imageDigest:containers[0].imageDigest}' \
		--output json

prod-logs:
	@task_definition=$$(aws ecs describe-services \
		--region "$(AWS_REGION)" \
		--cluster "$(PROD_CLUSTER)" \
		--services "$(PROD_SERVICE)" \
		--query 'services[0].taskDefinition' \
		--output text); \
	log_group="$(PROD_LOG_GROUP)"; \
	if [ -z "$$log_group" ]; then \
		log_group=$$(aws ecs describe-task-definition \
			--region "$(AWS_REGION)" \
			--task-definition "$$task_definition" \
			--query 'taskDefinition.containerDefinitions[?name==`$(PROD_LOG_CONTAINER)`].logConfiguration.options."awslogs-group"' \
			--output text); \
	fi; \
	if [ -z "$$log_group" ] || [ "$$log_group" = "None" ]; then \
		echo "Could not resolve CloudWatch log group for service $(PROD_SERVICE) container $(PROD_LOG_CONTAINER)." >&2; \
		exit 1; \
	fi; \
	echo "Tailing $$log_group (since $(PROD_LOG_SINCE))"; \
	aws logs tail "$$log_group" \
		--region "$(AWS_REGION)" \
		--since "$(PROD_LOG_SINCE)" \
		--follow

prod-secret-keys:
	@aws secretsmanager get-secret-value \
		--region "$(AWS_REGION)" \
		--secret-id "$(PROD_APP_SECRET)" \
		--query SecretString \
		--output text | jq 'keys'

prod-db-url:
	@aws secretsmanager get-secret-value \
		--region "$(AWS_REGION)" \
		--secret-id "$(PROD_DB_SECRET)" \
		--query SecretString \
		--output text | jq -r '.DATABASE_URL'

prod-sql:
	@db_url=$$(aws secretsmanager get-secret-value \
		--region "$(AWS_REGION)" \
		--secret-id "$(PROD_DB_SECRET)" \
		--query SecretString \
		--output text | jq -r '.DATABASE_URL'); \
	psql_url=$$(DB_URL="$$db_url" node -e 'const url = new URL(process.env.DB_URL); url.protocol = "postgresql:"; if (url.searchParams.has("ssl")) { url.searchParams.set("sslmode", url.searchParams.get("ssl")); url.searchParams.delete("ssl"); } console.log(url.toString())'); \
	psql "$$psql_url" -c "$(SQL)"

prod-psql:
	@db_url=$$(aws secretsmanager get-secret-value \
		--region "$(AWS_REGION)" \
		--secret-id "$(PROD_DB_SECRET)" \
		--query SecretString \
		--output text | jq -r '.DATABASE_URL'); \
	psql_url=$$(DB_URL="$$db_url" node -e 'const url = new URL(process.env.DB_URL); url.protocol = "postgresql:"; if (url.searchParams.has("ssl")) { url.searchParams.set("sslmode", url.searchParams.get("ssl")); url.searchParams.delete("ssl"); } console.log(url.toString())'); \
	psql "$$psql_url"

prod-rds:
	@aws rds describe-db-instances \
		--region "$(AWS_REGION)" \
		--db-instance-identifier "$(PROD_DB_INSTANCE)" \
		--query 'DBInstances[0].{id:DBInstanceIdentifier,endpoint:Endpoint.Address,status:DBInstanceStatus,engine:Engine,version:EngineVersion,master:MasterUsername}' \
		--output table

server-db-ready:
ifeq ($(USE_EXISTING_POSTGRES),1)
	@host="$(LOCAL_PGHOST)"; port="$(LOCAL_PGPORT)"; \
	for _ in $$(seq 1 30); do \
		python3 -c 'import socket, sys; socket.create_connection((sys.argv[1], int(sys.argv[2])), timeout=1).close()' "$$host" "$$port" >/dev/null 2>&1 && exit 0; \
		sleep 1; \
	done; \
	echo "Postgres is not reachable at $$host:$$port." >&2; \
	exit 1
else
	@$(MAKE) server-db-up
	@$(MAKE) server-db-wait
endif

server-migrate: server-db-ready
	cd server && .venv/bin/alembic upgrade head

db-migrate-up: server-db-ready
	@$(SERVER_ENV_SOURCE) \
	cd server && .venv/bin/alembic upgrade head

db-migrate-down: server-db-ready
	@$(SERVER_ENV_SOURCE) \
	cd server && .venv/bin/alembic downgrade base

dev-server: export DEBUG := true
dev-server: server-migrate server-redis-ready
	@$(SERVER_ENV_SOURCE) \
	$(STRIPE_LOCAL_SECRET_ENV) \
	cd server && .venv/bin/uvicorn proliferate.main:app --reload --host 127.0.0.1 --port 8000

server-install:
	cd server && uv venv .venv --python 3.12 && uv pip install -e ".[dev]"

test-server: server-db-ready
	cd server && .venv/bin/python -m pytest tests/ -xvs

cloud-runtime-build:
	@if [ -n "$(CLOUD_RUNTIME_SOURCE_BINARY_PATH)" ] && \
		[ -n "$(CLOUD_WORKER_SOURCE_BINARY_PATH)" ] && \
		[ -n "$(CLOUD_SUPERVISOR_SOURCE_BINARY_PATH)" ]; then \
		test -x "$(CLOUD_RUNTIME_SOURCE_BINARY_PATH)" || { echo "CLOUD_RUNTIME_SOURCE_BINARY_PATH is not executable: $(CLOUD_RUNTIME_SOURCE_BINARY_PATH)"; exit 1; }; \
		test -x "$(CLOUD_WORKER_SOURCE_BINARY_PATH)" || { echo "CLOUD_WORKER_SOURCE_BINARY_PATH is not executable: $(CLOUD_WORKER_SOURCE_BINARY_PATH)"; exit 1; }; \
		test -x "$(CLOUD_SUPERVISOR_SOURCE_BINARY_PATH)" || { echo "CLOUD_SUPERVISOR_SOURCE_BINARY_PATH is not executable: $(CLOUD_SUPERVISOR_SOURCE_BINARY_PATH)"; exit 1; }; \
		echo "Using prebuilt cloud runtime bundle binaries."; \
		exit 0; \
	fi
	@command -v cargo-zigbuild >/dev/null 2>&1 || { \
		echo "cargo-zigbuild is required for cloud lifecycle tests on this machine."; \
		echo "Install it with \`cargo install cargo-zigbuild\`, or set CLOUD_RUNTIME_SOURCE_BINARY_PATH, CLOUD_WORKER_SOURCE_BINARY_PATH, and CLOUD_SUPERVISOR_SOURCE_BINARY_PATH to prebuilt Linux binaries."; \
		exit 1; \
	}
	$(CARGO) zigbuild --release --target x86_64-unknown-linux-musl \
		-p anyharness \
		-p proliferate-worker \
		-p proliferate-supervisor

publish-cloud-template-env-local:
	@test -f server/.env.local || { \
		echo "server/.env.local was not found."; \
		exit 1; \
	}
	@set -a; \
	. server/.env.local; \
	set +a; \
	test -n "$$E2B_API_KEY" || { \
		echo "E2B_API_KEY is required in server/.env.local."; \
		exit 1; \
	}; \
	test -n "$$E2B_TEMPLATE_NAME" || { \
		echo "E2B_TEMPLATE_NAME is required in server/.env.local."; \
		exit 1; \
	}; \
		if printf '%s' "$$E2B_TEMPLATE_NAME" | grep -q '/'; then \
			test -n "$$E2B_TEAM_ID" || { \
				echo "E2B_TEAM_ID must be exported when E2B_TEMPLATE_NAME is a public family ref."; \
				exit 1; \
			}; \
			echo "Publishing public E2B template ref $$E2B_TEMPLATE_NAME from server/.env.local"; \
			node scripts/build-template.mjs --name "$$E2B_TEMPLATE_NAME" --publish --rebuild-runtime; \
		else \
			echo "Building local E2B template alias $$E2B_TEMPLATE_NAME from server/.env.local"; \
			node scripts/build-template.mjs --alias "$$E2B_TEMPLATE_NAME" --rebuild-runtime; \
		fi

test-cloud-e2b: cloud-runtime-build server-db-ready
	cd server && RUN_CLOUD_E2E=1 uv run python -m pytest tests/e2e/cloud -m "cloud_e2e and e2b and not live_webhook" -xvs

test-cloud-webhooks: server-db-ready
	cd server && RUN_CLOUD_E2E=1 RUN_LIVE_E2B_WEBHOOK=1 uv run python -m pytest tests/e2e/cloud/test_e2b_webhooks.py -m "live_webhook" -xvs

test-cloud-all: cloud-runtime-build server-db-ready
	cd server && RUN_CLOUD_E2E=1 RUN_LIVE_E2B_WEBHOOK=1 uv run python -m pytest tests/e2e/cloud -xvs

# Tier-3 live end-to-end / tier-4 upgrade-path runner
# (specs/developing/testing/README.md "Running tier 3/4 locally"). One runner
# CLI with lane flags; this target is a thin wrapper so CI and laptops call it
# identically. LANE=local|staging DESKTOP=web|native AGENTS=<list|all>
# SCENARIOS=<list|all> BEHAVIOR=diagnostic|strict DRY_RUN=1 FILE_ISSUES=1.
release-e2e:
	pnpm install --silent
	cd tests/release && pnpm exec tsx src/cli/run.ts \
		--behavior $(BEHAVIOR) \
		--lane $(LANE) \
		--desktop $(DESKTOP) \
		--agents $(AGENTS) \
		--scenarios $(SCENARIOS) \
		$(if $(DRY_RUN),--dry-run,) \
		$(if $(FILE_ISSUES),--file-issues,) \
		$(if $(CANDIDATE_BUILD_MAP),--candidate-build-map $(CANDIDATE_BUILD_MAP),)

# Assembles a CandidateBuildMapV1 for an already-built binary
# (specs/developing/testing/candidate-build-handoff.md). BINARY defaults to the
# release AnyHarness build; OUTPUT to tests/release/.output/candidate-build.json.
CANDIDATE_MAP_BINARY ?= target/release/anyharness
CANDIDATE_MAP_OUTPUT ?= tests/release/.output/candidate-build.json
qualification-candidate-build-map:
	node scripts/ci-cd/assemble-candidate-build-map.mjs \
		--binary $(CANDIDATE_MAP_BINARY) \
		--output $(CANDIDATE_MAP_OUTPUT)

# The real build→map→validate→materialize→launch→health→evidence proof
# (specs/developing/testing/candidate-build-handoff.md "Real handoff smoke").
# Builds a release-mode AnyHarness stamped with the repository VERSION and the
# current HEAD SHA, assembles the map, launches the exact bytes against an
# isolated runtime home/port, and requires the diagnostic runner's report
# candidate evidence to equal the launched identity.
# The build and the assembler must agree on the exact output path: pin the
# target dir and clear any ambient cross-compile target so an operator's
# CARGO_TARGET_DIR/CARGO_BUILD_TARGET cannot make this qualify a stale binary
# at target/release/ while cargo wrote somewhere else.
# Validate and materialize a committed retained-release receipt — the exact
# immutable production N-1 artifact set Tier 4 update proofs start from
# (specs/developing/testing/tier-4-scenario-contract.md "Artifact Identity").
# Shape + policy validation run before any download; every byte is verified
# against the receipt on every use (a cache hit is re-hashed, never trusted).
# Read-only toward providers: LIVE=1 adds an E2B metadata lookup proving the
# recorded immutable source tag still resolves to the recorded build id.
#
# RETAINED_RELEASE_ID=vX.Y.Z   Receipt to validate (see
#                              tests/release/retained-releases/index.json).
# LIVE=1                       Also live-verify E2B template identity
#                              (needs E2B_API_KEY or RELEASE_E2E_E2B_API_KEY).
# CANDIDATE_SHA=<40-hex>       Optional candidate N SHA for the N != N-1 check.
qualification-retained-release:
	@if [ -z "$(RETAINED_RELEASE_ID)" ]; then \
		echo "RETAINED_RELEASE_ID=<vX.Y.Z> is required, e.g. make qualification-retained-release RETAINED_RELEASE_ID=v0.3.38"; \
		exit 2; \
	fi
	cd tests/release && pnpm install --silent && pnpm exec tsx src/cli/retained-release.ts validate \
		--release-id $(RETAINED_RELEASE_ID) \
		$(if $(filter 1,$(LIVE)),--live,) \
		$(if $(CANDIDATE_SHA),--candidate-sha $(CANDIDATE_SHA),)

qualification-candidate-handoff-smoke:
	pnpm install --silent
	env -u CARGO_BUILD_TARGET \
	CARGO_TARGET_DIR=$(CURDIR)/target \
	PROLIFERATE_BUILD_VERSION=$$(cat VERSION) \
	PROLIFERATE_BUILD_SHA=$$(git rev-parse HEAD) \
		cargo build --release -p anyharness
	node scripts/ci-cd/assemble-candidate-build-map.mjs \
		--binary $(CURDIR)/target/release/anyharness \
		--output tests/release/.output/candidate-build.json
	cd tests/release && pnpm exec tsx src/artifacts/anyharness-smoke.ts \
		--map .output/candidate-build.json

# "Prove One Real Local Workspace Turn": one exact candidate Server, one exact
# candidate AnyHarness, and one exact candidate Desktop renderer built,
# handed to the qualification runner, started as an isolated local world, and
# used through the real product UI for one cheap managed-gateway turn. This
# is the ONE entrypoint; GitHub Actions' manual `release-e2e.yml` job invokes
# this same target — same four operations (resolve secrets, build candidates,
# write the candidate map, run the same TypeScript command), same code path.
#
# PROFILE=<unique-name>   Names this run (becomes its run id). Never reuse a
#                         PROFILE for two concurrent invocations.
# BEHAVIOR=diagnostic|strict
#
# Locally, LiteLLM access comes from an ignored, mode-0600 secret profile
# (never committed, never printed): AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL and
# AGENT_GATEWAY_LITELLM_MASTER_KEY. When that file has no separate
# AGENT_GATEWAY_LITELLM_BASE_URL (admin/control-plane URL), the verified
# public origin is mapped to it too (the public staging origin serves both
# inference and authenticated admin routes today). In GitHub Actions
# (GITHUB_ACTIONS=true) the same three env vars are supplied directly by the
# protected `staging` environment's secrets/vars — this target does not read
# or expect the local file there.
QUALIFICATION_INFRA_ENV ?= $(HOME)/.proliferate-local/dev/qualification-infra.env
# Dev provisioning env (RELEASE_E2E_INTEGRATION_API_KEY, RELEASE_E2E_LOCAL_DATABASE_URL,
# and the BYOK provider keys) written by the local provisioning scripts. Sourced
# by qualification-local-functional AFTER qualification-infra.env when present —
# local only; in Actions the protected Qualification environment supplies these.
RELEASE_E2E_ENV ?= $(HOME)/.proliferate-local/dev/release-e2e.env
QUALIFICATION_LOCAL_WORLD_BASE_DIR ?= $(CURDIR)/tests/release/.output/local-world
qualification-local-workspace:
	@test -n "$(PROFILE)" || { \
		echo "PROFILE=<unique-name> is required, e.g. make qualification-local-workspace PROFILE=$$(whoami)-1 BEHAVIOR=diagnostic"; \
		exit 1; \
	}
	@test -n "$(BEHAVIOR)" || { \
		echo "BEHAVIOR=<diagnostic|strict> is required."; \
		exit 1; \
	}
	@if [ "$$GITHUB_ACTIONS" != "true" ]; then \
		test -f "$(QUALIFICATION_INFRA_ENV)" || { \
			echo "Missing qualification secret profile at $(QUALIFICATION_INFRA_ENV)."; \
			echo "It must define AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL and AGENT_GATEWAY_LITELLM_MASTER_KEY (mode 0600, never committed)."; \
			exit 1; \
		}; \
		perm=$$(stat -f '%Lp' "$(QUALIFICATION_INFRA_ENV)" 2>/dev/null || stat -c '%a' "$(QUALIFICATION_INFRA_ENV)"); \
		test "$$perm" = "600" || { \
			echo "$(QUALIFICATION_INFRA_ENV) must be mode 0600 (got $$perm). Run: chmod 600 $(QUALIFICATION_INFRA_ENV)"; \
			exit 1; \
		}; \
	fi
	@if [ "$$GITHUB_ACTIONS" = "true" ]; then \
		: "$${AGENT_GATEWAY_LITELLM_BASE_URL:=$$AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL}"; \
		export AGENT_GATEWAY_LITELLM_BASE_URL; \
	else \
		set -a; \
		. "$(QUALIFICATION_INFRA_ENV)"; \
		: "$${AGENT_GATEWAY_LITELLM_BASE_URL:=$$AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL}"; \
		set +a; \
		export AGENT_GATEWAY_LITELLM_BASE_URL; \
	fi; \
	run_id="ql-$(PROFILE)"; \
	shard_id="1"; \
	run_dir="$(QUALIFICATION_LOCAL_WORLD_BASE_DIR)/$$run_id/$$shard_id"; \
	mkdir -p "$$run_dir/preflight"; \
	source_sha=$$(git rev-parse HEAD); \
	attempt="$${GITHUB_RUN_ATTEMPT:-1}"; \
	if [ -n "$(REUSE_CANDIDATES)" ]; then \
		node scripts/ci-cd/qualification-preflight.mjs \
			--world local --source-sha "$$source_sha" --run-id "$$run_id" --shard-id "$$shard_id" --attempt "$$attempt" \
			--scenarios LOCAL-WORLD-SMOKE-1 --artifact-mode reuse \
			--candidate-build-map "$(REUSE_CANDIDATES)/candidate-build.json" \
			--output "$$run_dir/preflight/qualification-preflight.json" || exit $$?; \
	else \
		node scripts/ci-cd/qualification-preflight.mjs \
			--world local --source-sha "$$source_sha" --run-id "$$run_id" --shard-id "$$shard_id" --attempt "$$attempt" \
			--scenarios LOCAL-WORLD-SMOKE-1 --artifact-mode build \
			--output "$$run_dir/preflight/qualification-preflight.json" || exit $$?; \
	fi; \
	pnpm install --silent; \
	pnpm exec playwright install --with-deps chromium; \
	if [ -n "$(REUSE_CANDIDATES)" ]; then \
		build_summary=$$(node scripts/ci-cd/build-local-qualification-candidates.mjs \
			--run-id "$$run_id" --shard-id "$$shard_id" --run-dir "$$run_dir" \
			--reuse-from "$(REUSE_CANDIDATES)") || exit $$?; \
	else \
		build_summary=$$(node scripts/ci-cd/build-local-qualification-candidates.mjs \
			--run-id "$$run_id" --shard-id "$$shard_id" --run-dir "$$run_dir") || exit $$?; \
	fi; \
	echo "$$build_summary"; \
	candidate_map=$$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).candidate_build_map)' "$$build_summary"); \
	cd tests/release && pnpm exec tsx src/cli/run.ts \
		--behavior $(BEHAVIOR) \
		--lane local \
		--desktop web \
		--agents claude \
		--scenarios LOCAL-WORLD-SMOKE-1 \
		--candidate-build-map "$$candidate_map" \
		--run-id "$$run_id" --shard-id "$$shard_id" \
		--output-dir "$$run_dir/evidence"

# Tier-2 strict billing qualification (PR 4). Boots the shared BootedStack
# (real Server + Postgres + Redis + real Stripe test mode; AnyHarness runtime
# skipped) and runs the authoritative T2-BILL-1..15 cells through the SAME
# tests/release aggregate command as tier 3. PR-8 non-billing rows remain
# manifest-deferred until one collector proves each complete guarantee with
# truthful domain evidence.
# No candidate build (Tier-2 boots from source) — `--source-candidate`
# synthesizes the Server identity for the strict report. Selected financial
# cells require a Stripe `sk_test_` key (env or `stripe config`); a missing key
# in trusted CI is a FAILURE (fail-closed), never skip-as-success.
#
# PROFILE=<unique-name>       Names this run.
# BEHAVIOR=diagnostic|strict
QUALIFICATION_TIER2_BASE_DIR ?= $(CURDIR)/tests/release/.output/tier2
qualification-tier2:
	@test -n "$(BEHAVIOR)" || { echo "BEHAVIOR=<diagnostic|strict> is required."; exit 1; }
	pnpm install --silent
	pnpm exec playwright install --with-deps chromium
	@run_id="qt2-$${PROFILE:-$$(whoami)}"; \
	shard_id="1"; \
	run_dir="$(QUALIFICATION_TIER2_BASE_DIR)/$$run_id/$$shard_id"; \
	mkdir -p "$$run_dir/evidence"; \
	cd tests/release && TIER2_INTENT_SKIP_RUNTIME=1 pnpm exec tsx src/cli/run.ts \
		--behavior $(BEHAVIOR) \
		--lane local \
		--desktop web \
		--agents claude \
		--scenarios T2-BILL \
		--source-candidate \
		--run-id "$$run_id" --shard-id "$$shard_id" \
		--output-dir "$$run_dir/evidence"
# "Complete Local Workspace Qualification (Functional)" — the same three
# exact local-world candidates as `qualification-local-workspace`
# (`build-local-qualification-candidates.mjs`, unmodified), handed to the same
# qualification runner, but driving the full LOCAL-1..7 functional cell set
# (specs/developing/testing/tier-3-scenario-contract.md §"Local cases")
# instead of the single LOCAL-WORLD-SMOKE-1 infrastructure proof. This is the
# ONE entrypoint; the release-e2e.yml manual job invokes this same target —
# same build step, same runner invocation.
#
# PROFILE=<unique-name>   Names this run (becomes its run id). Never reuse a
#                         PROFILE for two concurrent invocations.
# BEHAVIOR=diagnostic|strict
# AGENTS=all|<comma-list>   Harness kinds to fan out over (default: all).
# SCENARIOS=all|<comma-list>   Default (all): the seven functional local cell
#                         ids below (two of which — T3-WT-1 + T3-REPO-1 — are
#                         the canonical LOCAL-1 pair). Override to run a subset
#                         while iterating.
# REUSE_CANDIDATES=<dir>   Optional fast path: point at a run directory that
#                         already has candidate-build.json +
#                         local-world-ports.json (e.g. from a previous
#                         qualification-local-functional or
#                         qualification-local-workspace run) to skip
#                         rebuilding the Server/AnyHarness/Desktop-renderer
#                         candidates and reuse them as-is. Evidence still
#                         writes to a fresh run dir. No target in this
#                         Makefile builds a "managed-cloud" candidate set
#                         today, so there is nothing to mirror beyond this
#                         local skip-the-build shape.
#
# Same local secret-profile / env resolution as qualification-local-workspace
# (QUALIFICATION_INFRA_ENV): AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL and
# AGENT_GATEWAY_LITELLM_MASTER_KEY are required there; the functional
# scenarios additionally read RELEASE_E2E_BYOK_ANTHROPIC_A/_B,
# RELEASE_E2E_BYOK_OPENAI, RELEASE_E2E_BYOK_XAI, RELEASE_E2E_INTEGRATION_*,
# and RELEASE_E2E_LOCAL_DATABASE_URL (all optional — env-manifest.ts: an
# absent credential reports just its dependent scenarios/cells blocked, it
# never fails the whole run) straight off the same `set -a`-sourced profile
# file, by name, with no extra mapping needed here. In GitHub Actions those
# same names come from the protected `Qualification` environment's
# vars/secrets, mapped explicitly in release-e2e.yml.
# Canonical local inventory: LOCAL-1's workspace-from-repo journey is proven by
# BOTH T3-WT-1 (worktree/creation) and T3-REPO-1 (repo settings take effect) —
# both fold into the world-backed `runLocal1WorkspaceLeaf`, so `SCENARIOS=all`
# must plan and report both. Omitting T3-REPO-1 would silently drop a canonical
# LOCAL-1 cell from the strict contract.
QUALIFICATION_LOCAL_FUNCTIONAL_SCENARIOS := T3-WT-1,T3-REPO-1,T3-CHAT-1,T3-AUTHROUTE-1,T3-CFG-1,T3-SESSION-1,T3-INT-1
qualification-local-functional:
	@test -n "$(PROFILE)" || { \
		echo "PROFILE=<unique-name> is required, e.g. make qualification-local-functional PROFILE=$$(whoami)-1 BEHAVIOR=diagnostic"; \
		exit 1; \
	}
	@test -n "$(BEHAVIOR)" || { \
		echo "BEHAVIOR=<diagnostic|strict> is required."; \
		exit 1; \
	}
	@if [ "$$GITHUB_ACTIONS" != "true" ]; then \
		test -f "$(QUALIFICATION_INFRA_ENV)" || { \
			echo "Missing qualification secret profile at $(QUALIFICATION_INFRA_ENV)."; \
			echo "It must define AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL and AGENT_GATEWAY_LITELLM_MASTER_KEY (mode 0600, never committed); optionally the RELEASE_E2E_BYOK_*/RELEASE_E2E_INTEGRATION_*/RELEASE_E2E_LOCAL_DATABASE_URL names too."; \
			exit 1; \
		}; \
		perm=$$(stat -f '%Lp' "$(QUALIFICATION_INFRA_ENV)" 2>/dev/null || stat -c '%a' "$(QUALIFICATION_INFRA_ENV)"); \
		test "$$perm" = "600" || { \
			echo "$(QUALIFICATION_INFRA_ENV) must be mode 0600 (got $$perm). Run: chmod 600 $(QUALIFICATION_INFRA_ENV)"; \
			exit 1; \
		}; \
	fi
	@if [ "$$GITHUB_ACTIONS" = "true" ]; then \
		: "$${AGENT_GATEWAY_LITELLM_BASE_URL:=$$AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL}"; \
		export AGENT_GATEWAY_LITELLM_BASE_URL; \
	else \
		set -a; \
		. "$(QUALIFICATION_INFRA_ENV)"; \
		[ ! -f "$(RELEASE_E2E_ENV)" ] || . "$(RELEASE_E2E_ENV)"; \
		: "$${AGENT_GATEWAY_LITELLM_BASE_URL:=$$AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL}"; \
		set +a; \
		export AGENT_GATEWAY_LITELLM_BASE_URL; \
	fi; \
	run_id="qlf-$(PROFILE)"; \
	shard_id="1"; \
	build_dir="$(QUALIFICATION_LOCAL_WORLD_BASE_DIR)/$$run_id/$$shard_id"; \
	evidence_dir="$$build_dir/evidence"; \
	scenarios="$(if $(filter-out all,$(SCENARIOS)),$(SCENARIOS),$(QUALIFICATION_LOCAL_FUNCTIONAL_SCENARIOS))"; \
	mkdir -p "$$build_dir/preflight"; \
	source_sha=$$(git rev-parse HEAD); \
	attempt="$${GITHUB_RUN_ATTEMPT:-1}"; \
	if [ -n "$(REUSE_CANDIDATES)" ]; then \
		node scripts/ci-cd/qualification-preflight.mjs \
			--world local --source-sha "$$source_sha" --run-id "$$run_id" --shard-id "$$shard_id" --attempt "$$attempt" \
			--scenarios "$$scenarios" --artifact-mode reuse \
			--candidate-build-map "$(REUSE_CANDIDATES)/candidate-build.json" \
			--output "$$build_dir/preflight/qualification-preflight.json" || exit $$?; \
	else \
		node scripts/ci-cd/qualification-preflight.mjs \
			--world local --source-sha "$$source_sha" --run-id "$$run_id" --shard-id "$$shard_id" --attempt "$$attempt" \
			--scenarios "$$scenarios" --artifact-mode build \
			--output "$$build_dir/preflight/qualification-preflight.json" || exit $$?; \
	fi; \
	pnpm install --silent; \
	pnpm exec playwright install --with-deps chromium; \
	if [ -n "$(REUSE_CANDIDATES)" ]; then \
		build_summary=$$(node scripts/ci-cd/build-local-qualification-candidates.mjs \
			--run-id "$$run_id" --shard-id "$$shard_id" --run-dir "$$build_dir" \
			--reuse-from "$(REUSE_CANDIDATES)") || exit $$?; \
	else \
		build_summary=$$(node scripts/ci-cd/build-local-qualification-candidates.mjs \
			--run-id "$$run_id" --shard-id "$$shard_id" --run-dir "$$build_dir") || exit $$?; \
	fi; \
	echo "$$build_summary"; \
	candidate_map=$$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).candidate_build_map)' "$$build_summary"); \
	mkdir -p "$$evidence_dir"; \
	cd tests/release && pnpm exec tsx src/cli/run.ts \
		--behavior $(BEHAVIOR) \
		--lane local \
		--desktop web \
		--agents $(AGENTS) \
		--scenarios "$$scenarios" \
		--candidate-build-map "$$candidate_map" \
		--run-id "$$run_id" --shard-id "$$shard_id" \
		--output-dir "$$evidence_dir"

# "Prove One Real Self-Hosted Installation": build the exact self-host
# candidate (Server image archive for the box arch + release-shaped
# proliferate-deploy.tar.gz + controller AnyHarness + renderer), hand it to the
# qualification runner, provision a run-scoped EC2 box behind Route53+Caddy TLS,
# run the SHIPPED install.sh on the candidate bytes, and drive the four
# SELFHOST-INSTALL-1 cells. This is the ONE entrypoint; the release-e2e selfhost
# job invokes this same target. One target per world; never reuse the
# local-workspace target.
#
# PROFILE=<unique-name>   Names this run (becomes its run id). Never reuse a
#                         PROFILE for two concurrent invocations (each run owns
#                         its EC2 instance, SG, key pair, and DNS record).
# BEHAVIOR=diagnostic|strict
# SELFHOST_SCENARIOS=<comma-separated scenario ids>   Defaults to
#                         SELFHOST-INSTALL-1 (current behavior). Passed
#                         verbatim to `run.ts --scenarios`.
# SELFHOST_API_BASE_URL=<https://...>   Optional. When set, replaces the
#                         computed `print-selfhost-run-api-base-url.ts` value
#                         baked into the candidate renderer — for postures
#                         that need a fixed baked origin (e.g. the fixed-origin
#                         serial lane at https://selfhost-fixed.qualification.
#                         proliferate.com) instead of this run's own computed
#                         subdomain. Run-scoped scenarios leave this unset and
#                         get the computed value, unchanged. Example:
#                           make qualification-selfhost PROFILE=$$(whoami)-1 \
#                             BEHAVIOR=diagnostic \
#                             SELFHOST_SCENARIOS=SELFHOST-INSTALL-1 \
#                             SELFHOST_API_BASE_URL=https://selfhost-fixed.qualification.proliferate.com
#
# Locally, AWS/SSH/BYOK inputs come from the ignored, mode-0600 qualification
# env file (never committed, never printed): RELEASE_E2E_SELFHOST_REGION,
# RELEASE_E2E_SELFHOST_HOSTED_ZONE_ID, RELEASE_E2E_SELFHOST_INSTANCE_TYPE,
# RELEASE_E2E_SELFHOST_SSH_USER, and the bounded BYOK provider key
# RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY (plus ambient AWS credentials). In GitHub
# Actions the same inputs are supplied by the protected `Qualification`
# environment and configured AWS credentials; this target does not read the
# local file there.
QUALIFICATION_SELFHOST_BASE_DIR ?= $(CURDIR)/tests/release/.output/selfhost-world
SELFHOST_SCENARIOS ?= SELFHOST-INSTALL-1
SELFHOST_API_BASE_URL ?=
# Exported so the recipe reads it as a SHELL env var (`$$SELFHOST_API_BASE_URL`)
# rather than a Make expansion (`$(...)`). A Make expansion would textually inline
# the value into the recipe before the shell runs, so a value containing a quote
# plus shell syntax would be reparsed in this secret-bearing/AWS-authorized job
# (PR7-CONTROL-002). Reading it from the environment keeps the value inert data.
export SELFHOST_API_BASE_URL
# The candidate box platform. Defaults to linux/amd64 (t3.small-based scenarios:
# INSTALL-1/QUAL-1/ISOLATION-1). SELFHOST-CFN-1's CloudFormation template
# defaults to a Graviton (arm64) t4g instance, so run it with
# SELFHOST_CANDIDATE_PLATFORM=linux/arm64 so the docker-load candidate image
# and exact runtime archive match the box arch.
SELFHOST_CANDIDATE_PLATFORM ?= linux/amd64
# Optional matrix-cell filter passed verbatim to run.ts --cells (e.g. SH-GATEWAY
# to run SELFHOST-QUAL-1's gateway cell alone on a run-scoped origin). Empty =
# every planned cell.
SELFHOST_CELLS ?=
# Workflow seam for keeping the short-lived provider credential window separate
# from long local candidate builds. `all` preserves the one-command local path;
# Actions uses `build` before AWS federation and `run` afterward. The run phase
# revalidates the exact map and every artifact hash before provider work.
QUALIFICATION_SELFHOST_PHASE ?= all
export QUALIFICATION_SELFHOST_PHASE
qualification-selfhost:
	@test -n "$(PROFILE)" || { \
		echo "PROFILE=<unique-name> is required, e.g. make qualification-selfhost PROFILE=$$(whoami)-1 BEHAVIOR=diagnostic"; \
		exit 1; \
	}
	@test -n "$(BEHAVIOR)" || { \
		echo "BEHAVIOR=<diagnostic|strict> is required."; \
		exit 1; \
	}
	@case "$${QUALIFICATION_SELFHOST_PHASE:-all}" in \
		all|build|run) ;; \
		*) echo "QUALIFICATION_SELFHOST_PHASE must be all, build, or run."; exit 2 ;; \
	esac
	@if [ "$$GITHUB_ACTIONS" != "true" ]; then \
		test -f "$(QUALIFICATION_INFRA_ENV)" || { \
			echo "Missing qualification secret profile at $(QUALIFICATION_INFRA_ENV)."; \
			echo "It must define the selected scenario's RELEASE_E2E_SELFHOST_* and optional BYOK inputs (mode 0600, never committed)."; \
			exit 1; \
		}; \
		perm=$$(stat -f '%Lp' "$(QUALIFICATION_INFRA_ENV)" 2>/dev/null || stat -c '%a' "$(QUALIFICATION_INFRA_ENV)"); \
		test "$$perm" = "600" || { \
			echo "$(QUALIFICATION_INFRA_ENV) must be mode 0600 (got $$perm). Run: chmod 600 $(QUALIFICATION_INFRA_ENV)"; \
			exit 1; \
		}; \
	fi
	@if [ "$$GITHUB_ACTIONS" != "true" ]; then \
		set -a; \
		. "$(QUALIFICATION_INFRA_ENV)"; \
		set +a; \
	fi; \
	run_id="qs-$(PROFILE)"; \
	shard_id="1"; \
	run_dir="$(QUALIFICATION_SELFHOST_BASE_DIR)/$$run_id/$$shard_id"; \
	phase="$${QUALIFICATION_SELFHOST_PHASE:-all}"; \
	candidate_map="$$run_dir/candidate-build.json"; \
	preflight_cells="$(SELFHOST_CELLS)"; \
	if [ -z "$$preflight_cells" ]; then preflight_cells=all; fi; \
	mkdir -p "$$run_dir/preflight"; \
	source_sha=$$(git rev-parse HEAD); \
	attempt="$${GITHUB_RUN_ATTEMPT:-1}"; \
	if [ "$$phase" = "run" ]; then \
		node scripts/ci-cd/qualification-preflight.mjs \
			--world self-host --source-sha "$$source_sha" --run-id "$$run_id" --shard-id "$$shard_id" --attempt "$$attempt" \
			--scenarios "$(SELFHOST_SCENARIOS)" --cells "$$preflight_cells" --artifact-mode reuse \
			--candidate-build-map "$$candidate_map" \
			--output "$$run_dir/preflight/qualification-preflight.json" || exit $$?; \
	else \
		node scripts/ci-cd/qualification-preflight.mjs \
			--world self-host --source-sha "$$source_sha" --run-id "$$run_id" --shard-id "$$shard_id" --attempt "$$attempt" \
			--scenarios "$(SELFHOST_SCENARIOS)" --cells "$$preflight_cells" --artifact-mode build \
			--output "$$run_dir/preflight/qualification-preflight.json" || exit $$?; \
		pnpm install --silent; \
		pnpm exec playwright install --with-deps chromium; \
		api_base_url="$${SELFHOST_API_BASE_URL:-}"; \
		if [ -z "$$api_base_url" ]; then \
			api_base_url=$$(cd tests/release && pnpm exec tsx src/cli/print-selfhost-run-api-base-url.ts "$$run_id" "$$shard_id") || exit $$?; \
		fi; \
		build_summary=$$(node scripts/ci-cd/build-selfhost-qualification-candidates.mjs \
			--run-id "$$run_id" --shard-id "$$shard_id" --run-dir "$$run_dir" \
			--platform "$(SELFHOST_CANDIDATE_PLATFORM)" \
			--api-base-url "$$api_base_url") || exit $$?; \
		echo "$$build_summary"; \
		candidate_map=$$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).candidate_build_map)' "$$build_summary"); \
		if [ "$$phase" = "build" ]; then exit 0; fi; \
	fi; \
	cells_flag=""; \
	if [ -n "$(SELFHOST_CELLS)" ]; then cells_flag="--cells $(SELFHOST_CELLS)"; fi; \
	cd tests/release && pnpm exec tsx src/cli/run.ts \
		--behavior $(BEHAVIOR) \
		--lane selfhost \
		--desktop web \
		--agents claude \
		--scenarios $(SELFHOST_SCENARIOS) \
		$$cells_flag \
		--candidate-build-map "$$candidate_map" \
		--run-id "$$run_id" --shard-id "$$shard_id" \
		--output-dir "$$run_dir/evidence"

# "Prove One Real Managed-Cloud Workspace": one exact candidate Server, one
# exact set of Linux musl runtime binaries, and one exact candidate Desktop
# renderer built for the public candidate-API origin, handed to the
# qualification runner, provisioned as an isolated run-scoped EC2+E2B managed-
# cloud world, and used through the real product UI for one cheap managed-
# gateway turn inside a real E2B sandbox. One entrypoint, same as
# `qualification-local-workspace`; GitHub Actions' manual `release-e2e.yml`
# job invokes this same target. New builder file
# (`scripts/ci-cd/build-cloud-qualification-candidates.mjs`) — the local-world
# builder and target above stay untouched (extension contract: one builder per
# world).
#
# PROFILE=<unique-name>   Names this run (becomes its run id). Never reuse a
#                         PROFILE for two concurrent invocations.
# BEHAVIOR=diagnostic|strict
#
# Locally, secret VALUES come from the same ignored, mode-0600 qualification
# profile as the local-world target, extended with the cloud inputs (E2B,
# GitHub App, AWS region/zone — see src/config/env-manifest.ts). In GitHub
# Actions (GITHUB_ACTIONS=true) the `Qualification` environment supplies them
# directly; this target does not read or expect the local file there. AWS
# credentials themselves stay ambient (the `aws` CLI), never a manifest var.
QUALIFICATION_MANAGED_CLOUD_BASE_DIR ?= $(CURDIR)/tests/release/.output/managed-cloud-world
# A separate clean checkout of the canonical repository pinned to the trusted
# default-branch cleanup revision. Candidate checkout bytes cannot authorize
# their own LiteLLM hard-cancel reconciliation.
QUALIFICATION_TRUSTED_CLEANUP_REPOSITORY ?=
QUALIFICATION_TRUSTED_CLEANUP_DEFAULT_BRANCH ?= main
qualification-managed-cloud:
	@test -n "$(PROFILE)" || { \
		echo "PROFILE=<unique-name> is required, e.g. make qualification-managed-cloud PROFILE=$$(whoami)-1 BEHAVIOR=diagnostic"; \
		exit 1; \
	}
	@test -n "$(BEHAVIOR)" || { \
		echo "BEHAVIOR=<diagnostic|strict> is required."; \
		exit 1; \
	}
	@if [ "$$GITHUB_ACTIONS" != "true" ]; then \
		test -f "$(QUALIFICATION_INFRA_ENV)" || { \
			echo "Missing qualification secret profile at $(QUALIFICATION_INFRA_ENV)."; \
			echo "It must define the LiteLLM inputs plus the cloud inputs named in tests/release/src/config/env-manifest.ts (mode 0600, never committed)."; \
			exit 1; \
		}; \
		perm=$$(stat -f '%Lp' "$(QUALIFICATION_INFRA_ENV)" 2>/dev/null || stat -c '%a' "$(QUALIFICATION_INFRA_ENV)"); \
		test "$$perm" = "600" || { \
			echo "$(QUALIFICATION_INFRA_ENV) must be mode 0600 (got $$perm). Run: chmod 600 $(QUALIFICATION_INFRA_ENV)"; \
			exit 1; \
		}; \
	fi
	@if [ "$$GITHUB_ACTIONS" = "true" ]; then \
		: "$${AGENT_GATEWAY_LITELLM_BASE_URL:=$$AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL}"; \
		export AGENT_GATEWAY_LITELLM_BASE_URL; \
	else \
		set -a; \
		. "$(QUALIFICATION_INFRA_ENV)"; \
		: "$${AGENT_GATEWAY_LITELLM_BASE_URL:=$$AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL}"; \
		set +a; \
		export AGENT_GATEWAY_LITELLM_BASE_URL; \
	fi; \
	test -n "$(QUALIFICATION_TRUSTED_CLEANUP_REPOSITORY)" || { \
		echo "QUALIFICATION_TRUSTED_CLEANUP_REPOSITORY=<clean trusted-default-branch checkout> is required before managed-cloud build or provider work."; \
		exit 1; \
	}; \
	run_id="qlc-$(PROFILE)"; \
	shard_id="1"; \
	run_dir="$(QUALIFICATION_MANAGED_CLOUD_BASE_DIR)/$$run_id/$$shard_id"; \
	mkdir -p "$$run_dir/preflight"; \
	source_sha=$$(git rev-parse HEAD); \
	attempt="$${GITHUB_RUN_ATTEMPT:-1}"; \
	candidate_map="$$run_dir/candidate-build.json"; \
	if [ "$(REUSE_CANDIDATES)" = "1" ] && [ -f "$$candidate_map" ]; then \
		node scripts/ci-cd/qualification-preflight.mjs \
			--world managed-cloud --source-sha "$$source_sha" --run-id "$$run_id" --shard-id "$$shard_id" --attempt "$$attempt" \
			--scenarios CLOUD-PROVISION-1 --artifact-mode reuse --candidate-build-map "$$candidate_map" \
			--cleanup-attestation-repository "$(QUALIFICATION_TRUSTED_CLEANUP_REPOSITORY)" \
			--cleanup-attestation-default-branch "$(QUALIFICATION_TRUSTED_CLEANUP_DEFAULT_BRANCH)" \
			--cleanup-attestations "$(QUALIFICATION_TRUSTED_CLEANUP_REPOSITORY)/tests/release/fixtures/managed-cloud-litellm-attribution-attestations.v1.json" \
			--output "$$run_dir/preflight/qualification-preflight.json" || exit $$?; \
		echo "[reuse] REUSE_CANDIDATES=1 — exact candidate cache verified at $$candidate_map"; \
	else \
		node scripts/ci-cd/qualification-preflight.mjs \
			--world managed-cloud --source-sha "$$source_sha" --run-id "$$run_id" --shard-id "$$shard_id" --attempt "$$attempt" \
			--scenarios CLOUD-PROVISION-1 --artifact-mode build \
			--cleanup-attestation-repository "$(QUALIFICATION_TRUSTED_CLEANUP_REPOSITORY)" \
			--cleanup-attestation-default-branch "$(QUALIFICATION_TRUSTED_CLEANUP_DEFAULT_BRANCH)" \
			--cleanup-attestations "$(QUALIFICATION_TRUSTED_CLEANUP_REPOSITORY)/tests/release/fixtures/managed-cloud-litellm-attribution-attestations.v1.json" \
			--output "$$run_dir/preflight/qualification-preflight.json" || exit $$?; \
	fi; \
	pnpm install --silent; \
	pnpm exec playwright install --with-deps chromium; \
	if ! { [ "$(REUSE_CANDIDATES)" = "1" ] && [ -f "$$candidate_map" ]; }; then \
		build_summary=$$(node scripts/ci-cd/build-cloud-qualification-candidates.mjs \
			--run-id "$$run_id" --shard-id "$$shard_id" --run-dir "$$run_dir") || exit $$?; \
		echo "$$build_summary"; \
		candidate_map=$$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).candidate_build_map)' "$$build_summary"); \
	fi; \
	cd tests/release && pnpm exec tsx src/cli/run.ts \
		--behavior $(BEHAVIOR) \
		--lane cloud \
		--desktop web \
		--agents claude \
		--scenarios CLOUD-PROVISION-1 \
		--candidate-build-map "$$candidate_map" \
		--run-id "$$run_id" --shard-id "$$shard_id" \
		--output-dir "$$run_dir/evidence"

test-cloud-ssh-worker:
	@test -n "$(SSH_TARGET)" || { \
		echo "SSH_TARGET is required, for example:"; \
		echo "  make test-cloud-ssh-worker SSH_TARGET=ubuntu@44.247.206.119 SSH_KEY=/path/to/key.pem"; \
		exit 1; \
	}
	SSH_TARGET="$(SSH_TARGET)" \
	SSH_KEY="$(SSH_KEY)" \
	NGROK_URL="$(NGROK_URL)" \
	CLOUD_SSH_WORKER_API_PORT="$(CLOUD_SSH_WORKER_API_PORT)" \
	CLOUD_SSH_WORKER_DB="$(CLOUD_SSH_WORKER_DB)" \
	CLOUD_SSH_WORKER_SKIP_BUILD="$(CLOUD_SSH_WORKER_SKIP_BUILD)" \
	python3 scripts/cloud-ssh-worker-smoke.py

dev-cloud-ssh-worker:
	@test -n "$(SSH_TARGET)" || { \
		echo "SSH_TARGET is required, for example:"; \
		echo "  make dev-cloud-ssh-worker SSH_TARGET=ubuntu@44.247.206.119 SSH_KEY=/path/to/key.pem"; \
		exit 1; \
	}
	SSH_TARGET="$(SSH_TARGET)" \
	SSH_KEY="$(SSH_KEY)" \
	NGROK_URL="$(NGROK_URL)" \
	CLOUD_SSH_WORKER_API_PORT="$(CLOUD_SSH_WORKER_API_PORT)" \
	CLOUD_SSH_WORKER_DB="$(CLOUD_SSH_WORKER_DB)" \
	CLOUD_SSH_WORKER_SKIP_BUILD="$(CLOUD_SSH_WORKER_SKIP_BUILD)" \
	CLOUD_SSH_WORKER_KEEP_RUNNING=1 \
	python3 scripts/cloud-ssh-worker-smoke.py

stripe-setup-test:
	@command -v stripe >/dev/null 2>&1 || { \
		echo "Stripe CLI is required. Install it and run \`stripe login\`."; \
		exit 1; \
	}
	node scripts/stripe-setup-test-mode.mjs --write-env-local

lint-server:
	cd server && .venv/bin/ruff check proliferate/ tests/ && .venv/bin/ruff format --check proliferate/ tests/ && .venv/bin/mypy proliferate/

# --- Checks ---

check:
	$(CARGO) check --workspace

check-max-lines:
	python3 scripts/check_max_lines.py
	python3 scripts/check_session_mutation_admission.py

check-server-boundaries:
	cd server && uv run python ../scripts/check_server_boundaries.py

check-worker-structure:
	python3 scripts/check_proliferate_worker_structure.py

test:
	$(CARGO) test --workspace

test-agent-spec:
	pnpm --filter @anyharness/sdk test

test-agent-runtime-local: sdk-generate
	node scripts/run-local-agent-runtime-suite.mjs

test-agent-local-fast: test-agent-runtime-local

test-agent-local: test-agent-spec test-agent-runtime-local

fmt:
	$(CARGO) fmt --all

clippy:
	$(CARGO) clippy --workspace -- -D warnings

# --- Cloud client (Python control plane → TypeScript types) ---

# Pin the deployment posture (telemetry/single-org mode) so the generated
# schema is machine-independent: conditionally mounted routes (e.g. password
# registration under single-org mode) must not churn with the local .env.
cloud-openapi:
	cd server && DEBUG=1 \
	  TELEMETRY_MODE=local_dev \
	  SINGLE_ORG_MODE=1 \
	  JWT_SECRET=local-openapi-generation-secret \
	  CLOUD_SECRET_KEY=local-openapi-generation-cloud-secret \
	  GITHUB_OAUTH_CLIENT_ID=local-openapi-generation-github-client-id \
	  GITHUB_OAUTH_CLIENT_SECRET=local-openapi-generation-github-client-secret \
	  uv run python -c \
	  "from proliferate.main import app; import json; print(json.dumps(app.openapi()))" \
	  > openapi.json

cloud-client-generate: cloud-openapi
	mkdir -p cloud/sdk/src/generated
	cd cloud/sdk && npx openapi-typescript \
	  ../../server/openapi.json \
	  -o src/generated/openapi.ts

# --- TypeScript SDK ---

sdk-generate:
	mkdir -p anyharness/sdk/generated
	$(CARGO) run --bin anyharness -- print-openapi > anyharness/sdk/generated/openapi.json
	cd anyharness/sdk && npx openapi-typescript generated/openapi.json -o src/generated/openapi.ts

sdk-build: sdk-generate
	cd anyharness/sdk && pnpm run build

# --- Build surfaces ---

sdk-react-build:
	cd anyharness/sdk-react && pnpm run build

cloud-sdk-build: cloud-client-generate
	cd cloud/sdk && pnpm run build

cloud-sdk-react-build: cloud-sdk-build
	cd cloud/sdk-react && pnpm run build

shared-build:
	pnpm --filter @proliferate/design build
	pnpm --filter @proliferate/product-domain build
	pnpm --filter @proliferate/ui build
	pnpm --filter @proliferate/product-ui build
	pnpm --filter @proliferate/product-surfaces build
	pnpm --filter @proliferate/product-client build

# SKIP_RUST=1 skips both cargo builds — for frontend-only worktrees (UI waves)
# that run against a shared prebuilt runtime via ANYHARNESS_DEV_RUNTIME_BIN.
# Both `dev-artifacts-ready` and the `run` target honor that env var, so such a
# worktree never needs its own runtime build. (`tauri dev` still compiles the
# desktop shell into the worktree's target/ on first run.)
build-rust:
	@if [ -n "$(SKIP_RUST)" ] && [ "$(SKIP_RUST)" != "0" ]; then \
		echo "SKIP_RUST set — skipping cargo builds (runtime: $${ANYHARNESS_DEV_RUNTIME_BIN:-<unset>})"; \
	else \
		$(CARGO) build --workspace && \
		CARGO_TARGET_DIR="$(DEV_ANYHARNESS_TARGET_DIR)" $(CARGO) build -p anyharness; \
	fi

runtime-build: build-rust

desktop-build: cloud-sdk-build cloud-sdk-react-build sdk-build sdk-react-build shared-build
	cd apps/desktop && pnpm exec tsc && pnpm exec vite build

web-build: cloud-sdk-build cloud-sdk-react-build sdk-build shared-build
	cd apps/web && pnpm exec tsc -p tsconfig.json && pnpm exec vite build

build-frontend: desktop-build web-build

build: build-rust build-frontend

test-agent-runtime-cloud-e2b: sdk-generate
	cd anyharness/tests && pnpm run test:cloud:e2b

# --- Install ---

install:
	pnpm install

# --- Sidecar staging ---

stage-sidecar:
	$(CARGO) build --release -p anyharness --target $(TARGET)
	mkdir -p apps/desktop/src-tauri/binaries
	cp target/$(TARGET)/release/anyharness apps/desktop/src-tauri/binaries/anyharness-$(TARGET)
	chmod +x apps/desktop/src-tauri/binaries/anyharness-$(TARGET)

# --- Combined ---

all: check check-max-lines check-server-boundaries sdk-build

rebuild: build

clean:
	$(CARGO) clean
	rm -rf anyharness/sdk/dist anyharness/sdk/src/generated anyharness/sdk/generated/openapi.json
	rm -f server/openapi.json
	rm -rf apps/desktop/dist

# ── agent catalog ────────────────────────────────────────────────────────────
# View the current catalog draft (rebuild from committed snapshots + open viewer).
catalog-view:
	cd scripts/agent-catalog && node build-catalog.mjs && node render-catalog.mjs && open catalog.html

# Rebuild the draft, resolve every harness into a fenced pin (per-platform
# {url,sha256} or npm/git, reusing prior shas for unchanged URLs), and promote
# it to the bundled lockfile the runtime loads (catalogs/agents/catalog.json).
# This target finalizes already-committed probe snapshots; use catalog-update
# when discovering new upstream harness versions.
catalog-pin:
	@state=scripts/agent-catalog/generated/.probe-logs/run.state; \
		if [ -f "$$state" ] && ! grep -q '^complete=true$$' "$$state"; then \
			echo "Refusing catalog promotion after an incomplete diagnostic probe run." >&2; \
			echo "Run a complete catalog-update or remove the local probe state intentionally." >&2; \
			exit 1; \
		fi
	cd scripts/agent-catalog && node build-catalog.mjs \
		&& node resolve-pins.mjs --catalog catalog.draft.json --reuse-from ../../catalogs/agents/catalog.json \
		&& cp catalog.draft.json ../../catalogs/agents/catalog.json \
		&& node render-catalog.mjs
	node scripts/validate-agent-catalog.mjs

# Resolve current upstream pins, install those exact artifacts, run the complete
# probe matrix, then promote only agents backed by fresh successful probes.
# Set CATALOG_PROBE_AGENTS=codex (comma-separated for more than one) for a
# focused authoritative update; agents outside that selection are retained
# byte-for-byte. Cursor additionally requires CATALOG_PROBE_ARGS=--include-cursor
# on a machine with a working cursor-agent login. --allow-partial is diagnostics
# only: the completeness gate below deliberately refuses to promote it.
catalog-update:
	CATALOG_PROBE_AGENTS="$(CATALOG_PROBE_AGENTS)" ./scripts/agent-catalog/run-probes.sh $(CATALOG_PROBE_ARGS)
	cd scripts/agent-catalog && node build-catalog.mjs --require-complete-probe \
		&& cp catalog.draft.json ../../catalogs/agents/catalog.json \
		&& node render-catalog.mjs
	node scripts/validate-agent-catalog.mjs
