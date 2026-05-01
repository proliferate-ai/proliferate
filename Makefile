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
STRIPE_FORWARD_TO ?= http://127.0.0.1:8000/v1/billing/webhooks/stripe
STRIPE_SNAPSHOT_EVENTS ?= checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed
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
SERVER_ENV_SOURCE = set -a; \
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

ifneq ($(filter dev dev-init,$(MAKECMDGOALS)),)
ifeq ($(strip $(PROFILE)),)
$(error PROFILE is required. Example: make dev PROFILE=main)
endif
endif

.PHONY: dev dev-init dev-list dev-local dev-desktop dev-runtime dev-server server-db-up server-db-wait \
        server-db-down server-db-ready db db-local db-ah server-migrate serve install \
        check check-max-lines check-server-boundaries test test-server fmt clippy \
        dev-automation-worker \
        sdk-generate sdk-build sdk-react-build runtime-build desktop-build rebuild \
        test-agent-spec test-agent-runtime-local test-agent-local-fast test-agent-local \
        test-agent-runtime-cloud-e2b test-agent-runtime-cloud-daytona \
        cloud-runtime-build publish-cloud-template-env-local \
        test-cloud-e2b test-cloud-daytona test-cloud-all test-cloud-webhooks \
        cloud-openapi cloud-client-generate \
        stripe-setup-test \
        stage-sidecar \
        prod-service prod-taskdef prod-tasks prod-task prod-logs prod-secret-keys \
        prod-db-url prod-sql prod-psql prod-rds \
        db-migrate-up db-migrate-down \
        all clean

# --- Dev (builds SDK, starts runtime + desktop together) ---

dev: sdk-build server-db-ready
	@set -e; \
	if [ -z "$(PROFILE)" ]; then \
		echo "PROFILE is required. Example: make dev PROFILE=main"; \
		exit 1; \
	fi; \
	launch_env=$$( \
		PROLIFERATE_API_PORT="$(PROLIFERATE_API_PORT)" \
		PROLIFERATE_WEB_PORT="$(PROLIFERATE_WEB_PORT)" \
		PROLIFERATE_WEB_HMR_PORT="$(PROLIFERATE_WEB_HMR_PORT)" \
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
	$(STRIPE_LOCAL_SECRET_ENV) \
	$(LOCAL_CODEX_ACP_ENV) \
	if [ "$$database_url_override_set" = "x" ]; then \
		export DATABASE_URL="$$database_url_override_value"; \
		use_profile_db=0; \
	else \
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
	export CORS_ALLOW_ORIGINS="http://localhost:$$PROLIFERATE_WEB_PORT,http://127.0.0.1:$$PROLIFERATE_WEB_PORT,http://tauri.localhost,tauri://localhost"; \
	export STRIPE_CHECKOUT_SUCCESS_URL="http://localhost:$$PROLIFERATE_WEB_PORT/settings/cloud?checkout=success"; \
	export STRIPE_CHECKOUT_CANCEL_URL="http://localhost:$$PROLIFERATE_WEB_PORT/settings/cloud?checkout=cancel"; \
	export STRIPE_CUSTOMER_PORTAL_RETURN_URL="http://localhost:$$PROLIFERATE_WEB_PORT/settings/cloud"; \
	export STRIPE_FORWARD_TO="http://127.0.0.1:$$PROLIFERATE_API_PORT/v1/billing/webhooks/stripe"; \
	if [ "$$use_profile_db" = "1" ]; then \
		LOCAL_PGHOST="$(LOCAL_PGHOST)" \
		LOCAL_PGPORT="$(LOCAL_PGPORT)" \
		LOCAL_PGUSER="$(LOCAL_PGUSER)" \
		LOCAL_PGPASSWORD="$(LOCAL_PGPASSWORD)" \
		USE_EXISTING_POSTGRES="$(USE_EXISTING_POSTGRES)" \
		node scripts/dev.mjs ensure-db --db-name "$$PROLIFERATE_DEV_DB_NAME"; \
	fi; \
	(cd server && DATABASE_URL="$$DATABASE_URL" .venv/bin/alembic upgrade head); \
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
	echo "Starting profile $$PROLIFERATE_DEV_PROFILE: runtime :$$ANYHARNESS_PORT, backend :$$PROLIFERATE_API_PORT, web :$$PROLIFERATE_WEB_PORT"; \
	RUST_LOG=info ANYHARNESS_DEV_CORS=1 $(CARGO) run --bin anyharness -- serve --port "$$ANYHARNESS_PORT" --runtime-home "$$ANYHARNESS_RUNTIME_HOME" & \
	(cd server && .venv/bin/uvicorn proliferate.main:app --reload --host 127.0.0.1 --port "$$PROLIFERATE_API_PORT") & \
	echo "Starting automation worker..."; \
	(cd server && uv run python -m proliferate.server.automations.worker --role all) & \
	sleep 2; \
	(cd desktop && pnpm tauri dev --runner "$$(dirname "$$PROLIFERATE_DEV_HOME")/tauri-runner.sh" --config "$$(dirname "$$PROLIFERATE_DEV_HOME")/tauri.dev.json")

dev-init:
	@if [ -z "$(PROFILE)" ]; then \
		echo "PROFILE is required. Example: make dev-init PROFILE=main"; \
		exit 1; \
	fi
	@PROLIFERATE_API_PORT="$(PROLIFERATE_API_PORT)" \
	PROLIFERATE_WEB_PORT="$(PROLIFERATE_WEB_PORT)" \
	PROLIFERATE_WEB_HMR_PORT="$(PROLIFERATE_WEB_HMR_PORT)" \
	PROLIFERATE_GOOGLE_WORKSPACE_MCP_PORT_BASE="$(PROLIFERATE_GOOGLE_WORKSPACE_MCP_PORT_BASE)" \
	ANYHARNESS_PORT="$(ANYHARNESS_PORT)" \
	ANYHARNESS_RUNTIME_HOME="$(ANYHARNESS_RUNTIME_HOME)" \
	PROLIFERATE_DEV_HOME="$(PROLIFERATE_DEV_HOME)" \
	PROLIFERATE_DEV_DB_NAME="$(PROLIFERATE_DEV_DB_NAME)" \
	node scripts/dev.mjs ensure --profile "$(PROFILE)"

dev-list:
	@node scripts/dev.mjs list

dev-local: export PROLIFERATE_DEV := 1
dev-local: sdk-build
	@echo "Starting desktop app with the bundled AnyHarness sidecar and no control plane..."
	cd desktop && pnpm tauri dev --config src-tauri/tauri.dev.json

# --- Individual dev targets ---

dev-desktop: export ANYHARNESS_DEV_URL := http://127.0.0.1:8457
dev-desktop: export PROLIFERATE_DEV := 1
dev-desktop:
	cd desktop && pnpm tauri dev --config src-tauri/tauri.dev.json

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
	@$(SERVER_ENV_SOURCE) \
	cd server && uv run python -m proliferate.server.automations.worker --role all

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
dev-server: server-migrate
	@$(SERVER_ENV_SOURCE) \
	$(STRIPE_LOCAL_SECRET_ENV) \
	cd server && .venv/bin/uvicorn proliferate.main:app --reload --host 127.0.0.1 --port 8000

server-install:
	cd server && uv venv .venv --python 3.12 && uv pip install -e ".[dev]"

test-server: server-db-ready
	cd server && .venv/bin/python -m pytest tests/ -xvs

cloud-runtime-build:
	@command -v cargo-zigbuild >/dev/null 2>&1 || { \
		echo "cargo-zigbuild is required for cloud lifecycle tests on this machine."; \
		echo "Install it with \`cargo install cargo-zigbuild\`, or set CLOUD_RUNTIME_SOURCE_BINARY_PATH to a prebuilt Linux AnyHarness binary."; \
		exit 1; \
	}
	$(CARGO) zigbuild --release --target x86_64-unknown-linux-musl -p anyharness

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

test-cloud-daytona: cloud-runtime-build server-db-ready
	cd server && RUN_CLOUD_E2E=1 uv run python -m pytest tests/e2e/cloud -m "cloud_e2e and daytona" -xvs

test-cloud-webhooks: server-db-ready
	cd server && RUN_CLOUD_E2E=1 RUN_LIVE_E2B_WEBHOOK=1 uv run python -m pytest tests/e2e/cloud/test_e2b_webhooks.py -m "live_webhook" -xvs

test-cloud-all: cloud-runtime-build server-db-ready
	cd server && RUN_CLOUD_E2E=1 RUN_LIVE_E2B_WEBHOOK=1 uv run python -m pytest tests/e2e/cloud -xvs

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

check-server-boundaries:
	cd server && uv run python ../scripts/check_server_boundaries.py

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

cloud-openapi:
	cd server && DEBUG=1 \
	  JWT_SECRET=local-openapi-generation-secret \
	  CLOUD_SECRET_KEY=local-openapi-generation-cloud-secret \
	  GITHUB_OAUTH_CLIENT_ID=local-openapi-generation-github-client-id \
	  GITHUB_OAUTH_CLIENT_SECRET=local-openapi-generation-github-client-secret \
	  uv run python -c \
	  "from proliferate.main import app; import json; print(json.dumps(app.openapi()))" \
	  > openapi.json

cloud-client-generate: cloud-openapi
	mkdir -p desktop/src/lib/integrations/cloud/generated
	cd desktop && npx openapi-typescript \
	  ../server/openapi.json \
	  -o src/lib/integrations/cloud/generated/openapi.ts

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

runtime-build:
	$(CARGO) build --workspace

desktop-build: cloud-client-generate sdk-build sdk-react-build
	cd desktop && pnpm exec tsc && pnpm exec vite build

test-agent-runtime-cloud-e2b: sdk-generate
	cd anyharness/tests && pnpm run test:cloud:e2b

test-agent-runtime-cloud-daytona: sdk-generate
	cd anyharness/tests && pnpm run test:cloud:daytona

# --- Install ---

install:
	pnpm install

# --- Sidecar staging ---

stage-sidecar:
	$(CARGO) build --release -p anyharness --target $(TARGET)
	mkdir -p desktop/src-tauri/binaries
	cp target/$(TARGET)/release/anyharness desktop/src-tauri/binaries/anyharness-$(TARGET)
	chmod +x desktop/src-tauri/binaries/anyharness-$(TARGET)

# --- Combined ---

all: check check-max-lines check-server-boundaries sdk-build

rebuild: sdk-build runtime-build desktop-build

clean:
	$(CARGO) clean
	rm -rf anyharness/sdk/dist anyharness/sdk/src/generated anyharness/sdk/generated/openapi.json
	rm -f server/openapi.json
	rm -rf desktop/dist
