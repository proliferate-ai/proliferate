export PATH := $(HOME)/.cargo/bin:$(PATH)
CARGO := $(HOME)/.cargo/bin/cargo
TARGET := aarch64-apple-darwin
LOCAL_PGHOST ?= 127.0.0.1
LOCAL_PGPORT ?= 5432
LOCAL_PGUSER ?= proliferate
LOCAL_PGPASSWORD ?= localdev
LOCAL_PGDATABASE ?= proliferate
USE_EXISTING_POSTGRES ?= 0
AWS_REGION ?= us-east-1
PROD_CLUSTER ?= proliferate-prod
PROD_SERVICE ?= proliferate-prod-server
PROD_LOG_GROUP ?= /ecs/proliferate-server
PROD_APP_SECRET ?= proliferate/prod/server-app
PROD_DB_SECRET ?= proliferate/prod/database
PROD_DB_INSTANCE ?= proliferate-prod
SQL ?= select version_num from alembic_version;

.PHONY: dev dev-local dev-desktop dev-runtime dev-server server-db-up server-db-wait \
        server-db-down server-db-ready db db-local db-ah server-migrate serve install \
        check check-max-lines check-server-boundaries test test-server fmt clippy \
        sdk-generate sdk-build sdk-react-build runtime-build desktop-build rebuild \
        test-agent-spec test-agent-runtime-local test-agent-local-fast test-agent-local \
        test-agent-runtime-cloud-e2b test-agent-runtime-cloud-daytona \
        cloud-runtime-build publish-cloud-template-env-local \
        test-cloud-e2b test-cloud-daytona test-cloud-all test-cloud-webhooks \
        cloud-openapi cloud-client-generate \
        stage-sidecar \
        prod-service prod-taskdef prod-tasks prod-task prod-logs prod-secret-keys \
        prod-db-url prod-sql prod-psql prod-rds \
        all clean

# --- Dev (builds SDK, starts runtime + desktop together) ---

dev: sdk-build server-migrate
	@echo "Starting runtime on :8457, backend on :8000, and desktop app..."
	@trap 'kill 0' EXIT; \
	RUST_LOG=info ANYHARNESS_DEV_CORS=1 $(CARGO) run --bin anyharness -- serve & \
	cd server && .venv/bin/uvicorn proliferate.main:app --reload --host 127.0.0.1 --port 8000 & \
	sleep 2; \
	cd desktop && ANYHARNESS_DEV_URL=http://127.0.0.1:8457 pnpm tauri dev --config src-tauri/tauri.dev.json

dev-local: sdk-build
	@echo "Starting desktop app with the bundled AnyHarness sidecar and no control plane..."
	cd desktop && pnpm tauri dev --config src-tauri/tauri.dev.json

# --- Individual dev targets ---

dev-desktop: export ANYHARNESS_DEV_URL := http://127.0.0.1:8457
dev-desktop:
	cd desktop && pnpm tauri dev --config src-tauri/tauri.dev.json

dev-runtime: export ANYHARNESS_DEV_CORS := 1
dev-runtime: sdk-build
	$(CARGO) run --bin anyharness -- serve

serve:
	$(CARGO) run --bin anyharness -- serve

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
	@PGPASSWORD="$(LOCAL_PGPASSWORD)" psql \
		-h "$(LOCAL_PGHOST)" \
		-p "$(LOCAL_PGPORT)" \
		-U "$(LOCAL_PGUSER)" \
		-d "$(LOCAL_PGDATABASE)"

db-ah:
	@sqlite3 -cmd ".headers on" -cmd ".mode column" $(HOME)/.proliferate/anyharness/db.sqlite

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
	@aws logs tail "$(PROD_LOG_GROUP)" \
		--region "$(AWS_REGION)" \
		--since 30m \
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
	@host="$${LOCAL_PGHOST:-127.0.0.1}"; port="$${LOCAL_PGPORT:-5432}"; \
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

dev-server: server-migrate
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

lint-server:
	cd server && .venv/bin/ruff check proliferate/ tests/ && .venv/bin/ruff format --check proliferate/ tests/ && .venv/bin/mypy proliferate/

# --- Checks ---

check:
	$(CARGO) check --workspace

check-max-lines:
	python3 scripts/check_max_lines.py

check-server-boundaries:
	python3 scripts/check_server_boundaries.py

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
	cd server && uv run python -c \
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
