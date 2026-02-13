# ===========================================
# Proliferate - Development Commands
# ===========================================
# Run `make` or `make help` to see all commands

.DEFAULT_GOAL := help

NGROK_CONFIG ?= $(shell if [ -f ngrok.yml ]; then echo ngrok.yml; else echo ngrok.yml.example; fi)

# ===========================================
# Quick Start
# ===========================================

help:
	@echo "Proliferate Development Commands"
	@echo ""
	@echo "Quick Start (2 terminals):"
	@echo "  make services    - Start Postgres, Redis, LLM Proxy"
	@echo "  make ngrok       - Start ALL ngrok tunnels"
	@echo "  make web         - Start Next.js app"
	@echo ""
	@echo "Services:"
	@echo "  make services    - Start all docker services"
	@echo "  make services-rebuild - Rebuild + start postgres/redis/llm-proxy"
	@echo "  make llm-proxy   - Start just LLM proxy"
	@echo "  make llm-proxy-rebuild - Rebuild + start LLM proxy"
	@echo "  make docker-nuke - Stop + remove ALL containers and volumes"
	@echo "  make stop        - Stop docker services"
	@echo "  make logs        - Tail all logs"
	@echo "  make logs-llm    - Tail LLM proxy logs"
	@echo ""
	@echo "Ngrok Tunnels:"
	@echo "  make ngrok       - Start ALL tunnels (llm, web, gateway)"
	@echo "  make ngrok-llm   - Just LLM proxy (port 4000)"
	@echo "  make ngrok-web   - Just web (port 3000)"
	@echo "  make ngrok-gateway - Just gateway (port 8787)"
	@echo ""
	@echo "Apps:"
	@echo "  make web         - Next.js web app (localhost:3000)"
	@echo "  make gateway     - Gateway server (localhost:8787)"
	@echo "  make worker      - Background worker"
	@echo ""
	@echo "Database:"
	@echo "  make db-local    - Connect to local Postgres"
	@echo "  make db-migrate  - Apply Drizzle migrations to local Postgres"
	@echo "  make db-prod     - Connect to production Postgres"
	@echo ""
	@echo "Kubernetes (cloud):"
	@echo "  make k8s-setup                      - Generate AWS kubeconfig (.tmp/aws-kubeconfig)"
	@echo "  make k8s-cloud K8S_CLOUD=aws|gcp   - Show which kubeconfig is used"
	@echo "  make k8s-ns K8S_CLOUD=aws|gcp      - List namespaces"
	@echo "  make k8s-pods K8S_CLOUD=aws|gcp    - List app pods"
	@echo "  make k8s-logs-web K8S_CLOUD=aws|gcp"
	@echo "  make k8s-logs-gateway K8S_CLOUD=aws|gcp"
	@echo "  make k8s-logs-worker K8S_CLOUD=aws|gcp"
	@echo "  make k8s-logs-llm K8S_CLOUD=aws|gcp"
	@echo "  make k8s-logs-all K8S_CLOUD=aws|gcp"
	@echo "  make k8s-env-keys K8S_CLOUD=aws|gcp"
	@echo "  make k8s-env KEY=DATABASE_URL K8S_CLOUD=aws|gcp"
	@echo "  make k8s-ingress K8S_CLOUD=aws|gcp"
	@echo "  make k8s-health K8S_CLOUD=aws|gcp"
	@echo "  make k8s-shell-web K8S_CLOUD=aws|gcp   - Shell into web pod"
	@echo "  make k8s-shell-gateway K8S_CLOUD=aws|gcp"
	@echo "  make k8s-shell-worker K8S_CLOUD=aws|gcp"
	@echo ""
	@echo "Kubernetes (AWS shortcuts):"
	@echo "  make aws-logs-web"
	@echo "  make aws-logs-gateway"
	@echo "  make aws-logs-worker"
	@echo "  make aws-logs-llm"
	@echo "  make aws-logs-all"
	@echo "  make aws-env-keys"
	@echo "  make aws-env KEY=DATABASE_URL"
	@echo "  make aws-ingress"
	@echo "  make aws-health"
	@echo "  make aws-shell-web     - Shell into web pod"
	@echo "  make aws-shell-gateway"
	@echo "  make aws-shell-worker"
	@echo ""
	@echo "Release & Cloud Ops:"
	@echo "  make deploy-cloud SHA=<sha>"
	@echo "  make release-tag TAG=vX.Y.Z"
	@echo "  make push-secrets ENV=prod"
	@echo "  make restart-pods K8S_CLOUD=aws|gcp"
	@echo "  make last-good-sha-set SHA=<sha>"
	@echo "  make last-good-sha-get"

# ===========================================
# Docker Services
# ===========================================

services:
	docker compose up -d postgres redis llm-proxy
	@echo ""
	@echo "✅ Services started:"
	@echo "   PostgreSQL: localhost:5432"
	@echo "   Redis:      localhost:6379"
	@echo "   LLM Proxy:  localhost:4000"
	@echo ""
	@echo "Next: Run 'make ngrok' in another terminal"

services-rebuild:
	docker compose up -d --build postgres redis llm-proxy
	@echo ""
	@echo "✅ Services rebuilt and started:"
	@echo "   PostgreSQL: localhost:5432"
	@echo "   Redis:      localhost:6379"
	@echo "   LLM Proxy:  localhost:4000"
	@echo ""
	@echo "Next: Run 'make ngrok' in another terminal"

llm-proxy:
	docker compose up -d llm-proxy
	@echo "✅ LLM Proxy: localhost:4000"

llm-proxy-rebuild:
	docker compose up -d --build llm-proxy
	@echo "✅ LLM Proxy rebuilt: localhost:4000"

ngrok:
	@echo "Starting all ngrok tunnels (llm-proxy, web, gateway)..."
	@echo "Config: $(NGROK_CONFIG)"
	@echo ""
	ngrok start --all --config "$(HOME)/Library/Application Support/ngrok/ngrok.yml" --config $(NGROK_CONFIG)

ngrok-llm:
	ngrok http 4000

ngrok-web:
	ngrok http 3000

ngrok-gateway:
	ngrok http 8787

docker-nuke:
	docker rm -f $$(docker ps -aq) 2>/dev/null || true
	docker volume rm $$(docker volume ls -q) 2>/dev/null || true
	@echo "✅ All containers and volumes removed"

stop:
	docker compose down
	@echo "✅ Services stopped"

logs:
	docker compose logs -f

logs-llm:
	docker compose logs -f llm-proxy

# ===========================================
# App Development
# ===========================================

web:
	pnpm dev:web

gateway:
	pnpm dev:gateway

worker:
	pnpm dev:worker

# ===========================================
# Database Commands
# ===========================================

# Local database (Docker Compose Postgres)
db-local:
	@psql "postgresql://postgres:postgres@127.0.0.1:5432/proliferate"

db-migrate:
	@DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/proliferate" pnpm -C packages/db db:migrate

# Production database
# Loads from .env.prod which has DATABASE_URL
db-prod:
	@source .env.prod && psql "$$DATABASE_URL"

# Quick status checks
db-local-status:
	@psql "postgresql://postgres:postgres@127.0.0.1:5432/proliferate" -c "SELECT 'Local DB connected' as status;"

db-prod-status:
	@source .env.prod && psql "$$DATABASE_URL" -c "SELECT 'Production DB connected' as status;"

# List tables
db-local-tables:
	@psql "postgresql://postgres:postgres@127.0.0.1:5432/proliferate" -c "\dt"

db-prod-tables:
	@source .env.prod && psql "$$DATABASE_URL" -c "\dt"

# ===========================================
# Kubernetes (Cloud)
# ===========================================

K8S_CLOUD ?= aws
KUBECONFIG_AWS ?= .tmp/aws-kubeconfig
KUBECONFIG_GCP ?= .tmp/gcp-kubeconfig
APP_HOST ?= app.example.com
EKS_CLUSTER ?= proliferate-prod-eks
EKS_REGION ?= us-east-1

ifeq ($(K8S_CLOUD),gcp)
KUBECONFIG := $(KUBECONFIG_GCP)
else ifeq ($(K8S_CLOUD),aws)
KUBECONFIG := $(KUBECONFIG_AWS)
else
$(error K8S_CLOUD must be 'aws' or 'gcp')
endif

KUBECTL := KUBECONFIG=$(KUBECONFIG) kubectl

k8s-setup:
	@mkdir -p .tmp
	@aws eks update-kubeconfig --name $(EKS_CLUSTER) --region $(EKS_REGION) --kubeconfig $(KUBECONFIG_AWS)
	@echo "Kubeconfig written to $(KUBECONFIG_AWS)"

k8s-cloud:
	@echo "K8S_CLOUD=$(K8S_CLOUD)"
	@echo "KUBECONFIG=$(KUBECONFIG)"

k8s-ns:
	@$(KUBECTL) get ns

k8s-pods:
	@$(KUBECTL) -n proliferate get pods

k8s-logs-web:
	@$(KUBECTL) -n proliferate logs -f deploy/proliferate-web

k8s-logs-gateway:
	@$(KUBECTL) -n proliferate logs -f deploy/proliferate-gateway

k8s-logs-worker:
	@$(KUBECTL) -n proliferate logs -f deploy/proliferate-worker

k8s-logs-llm:
	@$(KUBECTL) -n proliferate logs -f deploy/proliferate-llm-proxy

k8s-logs-all:
	@$(KUBECTL) -n proliferate logs -f --all-containers --max-log-requests=20 --timestamps

k8s-shell-web:
	@$(KUBECTL) -n proliferate exec -it deploy/proliferate-web -- sh

k8s-shell-gateway:
	@$(KUBECTL) -n proliferate exec -it deploy/proliferate-gateway -- sh

k8s-shell-worker:
	@$(KUBECTL) -n proliferate exec -it deploy/proliferate-worker -- sh

k8s-env-keys:
	@$(KUBECTL) -n proliferate get secret proliferate-env -o json \
		| python3 -c 'import json,sys; data=json.load(sys.stdin)["data"]; print("\n".join(sorted(data.keys())))'

k8s-env:
	@if [ -z "$(KEY)" ]; then echo "Set KEY=... (e.g. KEY=DATABASE_URL)"; exit 1; fi
	@$(KUBECTL) -n proliferate get secret proliferate-env -o jsonpath="{.data.$(KEY)}" | base64 --decode; echo ""

k8s-ingress:
	@HOST=$$($(KUBECTL) -n ingress-nginx get svc -l app.kubernetes.io/component=controller -o jsonpath='{.items[0].status.loadBalancer.ingress[0].hostname}'); \
	IP=$$($(KUBECTL) -n ingress-nginx get svc -l app.kubernetes.io/component=controller -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}'); \
	echo "$${HOST:-$${IP}}"

k8s-health:
	@ADDR=$$($(KUBECTL) -n ingress-nginx get svc -l app.kubernetes.io/component=controller -o jsonpath='{.items[0].status.loadBalancer.ingress[0].hostname}'); \
	IP=$$($(KUBECTL) -n ingress-nginx get svc -l app.kubernetes.io/component=controller -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}'); \
	ADDR=$${ADDR:-$${IP}}; \
	if [ "$(K8S_CLOUD)" = "aws" ]; then \
		echo "https://$(APP_HOST) -> $$ADDR"; \
		curl -sk -o /dev/null -w "web /api/health: %{http_code}\n" -H "Host: $(APP_HOST)" https://$$ADDR/api/health; \
		curl -sk -o /dev/null -w "gateway /gateway/health: %{http_code}\n" -H "Host: $(APP_HOST)" https://$$ADDR/gateway/health; \
		curl -sk -o /dev/null -w "llm /llm-proxy/health/liveliness: %{http_code}\n" -H "Host: $(APP_HOST)" https://$$ADDR/llm-proxy/health/liveliness; \
	else \
		echo "http://$$ADDR"; \
		curl -s -o /dev/null -w "web /api/health: %{http_code}\n" http://$$ADDR/api/health; \
		curl -s -o /dev/null -w "gateway /gateway/health: %{http_code}\n" http://$$ADDR/gateway/health; \
		curl -s -o /dev/null -w "llm /llm-proxy/health/liveliness: %{http_code}\n" http://$$ADDR/llm-proxy/health/liveliness; \
	fi

# AWS short aliases
aws-logs-web: k8s-logs-web
aws-logs-gateway: k8s-logs-gateway
aws-logs-worker: k8s-logs-worker
aws-logs-llm: k8s-logs-llm
aws-logs-all: k8s-logs-all
aws-env-keys: k8s-env-keys
aws-env: k8s-env
aws-shell-web: k8s-shell-web
aws-shell-gateway: k8s-shell-gateway
aws-shell-worker: k8s-shell-worker
aws-ingress: k8s-ingress
aws-health: k8s-health

# ===========================================
# Release & Cloud Ops
# ===========================================

ENV ?= prod

# Trigger the manual EKS deploy workflow (requires gh CLI)
deploy-cloud:
	@if [ -z "$(SHA)" ]; then SHA=$$(git rev-parse --short HEAD); fi; \
	gh workflow run deploy-eks.yml -f sha=$$SHA

# Create a self-host release tag (GHCR release pipeline runs on tags)
release-tag:
	@if [ -z "$(TAG)" ]; then echo "Set TAG=vX.Y.Z"; exit 1; fi
	@git tag $(TAG)
	@git push origin $(TAG)

# Update runtime secrets in AWS Secrets Manager (expects local files)
push-secrets:
	@if [ ! -f "secrets/$(ENV)-app.json" ]; then echo "Missing secrets/$(ENV)-app.json"; exit 1; fi
	@if [ ! -f "secrets/$(ENV)-llm-proxy.json" ]; then echo "Missing secrets/$(ENV)-llm-proxy.json"; exit 1; fi
	@aws secretsmanager put-secret-value --secret-id proliferate-$(ENV)-app-env --secret-string file://secrets/$(ENV)-app.json
	@aws secretsmanager put-secret-value --secret-id proliferate-$(ENV)-llm-proxy-env --secret-string file://secrets/$(ENV)-llm-proxy.json

# Restart all deployments to pick up new secrets / config
restart-pods:
	@$(KUBECTL) -n proliferate rollout restart deploy/proliferate-web
	@$(KUBECTL) -n proliferate rollout restart deploy/proliferate-gateway
	@$(KUBECTL) -n proliferate rollout restart deploy/proliferate-worker
	@$(KUBECTL) -n proliferate rollout restart deploy/proliferate-llm-proxy
	@echo "Rollout restart triggered for all deployments"

# Track rollback marker in SSM
last-good-sha-set:
	@if [ -z "$(SHA)" ]; then SHA=$$(git rev-parse --short HEAD); fi; \
	aws ssm put-parameter --name /proliferate/last-good-sha --value $$SHA --type String --overwrite

last-good-sha-get:
	@aws ssm get-parameter --name /proliferate/last-good-sha --query Parameter.Value --output text

.PHONY: help services services-rebuild llm-proxy llm-proxy-rebuild ngrok ngrok-llm ngrok-web ngrok-gateway docker-nuke stop logs logs-llm web gateway worker db-local db-migrate db-prod db-local-status db-prod-status db-local-tables db-prod-tables k8s-setup k8s-cloud k8s-ns k8s-pods k8s-logs-web k8s-logs-gateway k8s-logs-worker k8s-logs-llm k8s-logs-all k8s-shell-web k8s-shell-gateway k8s-shell-worker k8s-env-keys k8s-env k8s-ingress k8s-health aws-logs-web aws-logs-gateway aws-logs-worker aws-logs-llm aws-logs-all aws-shell-web aws-shell-gateway aws-shell-worker aws-env-keys aws-env aws-ingress aws-health deploy-cloud release-tag push-secrets last-good-sha-set last-good-sha-get
