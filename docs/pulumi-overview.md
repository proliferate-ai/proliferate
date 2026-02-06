# Pulumi in this repo (end-to-end, fundamentals + implementation)

This is a self-contained explanation of how Pulumi works in this codebase, including the core concepts and the end-to-end flow from configuration to running infrastructure.

## Pulumi fundamentals (quick but complete)

- **Project**: A Pulumi project is a folder with `Pulumi.yaml`. It defines the name and runtime. In this repo, the Pulumi project lives in `infra/pulumi/` and is named `proliferate-infra`.
- **Stack**: A stack is one instance of a project (ex: `prod`, `staging`, `dev`). Each stack has its own config and state.
- **State**: Pulumi keeps a state file of what resources exist and their properties. This repo uses an S3 backend with DynamoDB locking (see `scripts/setup-pulumi.sh`).
- **Config**: Stack-specific settings are stored in `Pulumi.<stack>.yaml` under keys like `proliferate-infra:foo`. Pulumi differentiates **plain** config values and **secret** values. Secrets are encrypted in the stack file.
- **Resources**: In Pulumi, infrastructure is defined as code. Creating an AWS resource in code corresponds to a real AWS object when you run `pulumi up`.
- **Provider**: The AWS provider determines region and default tags. This repo sets a provider in `infra/pulumi/config.ts` and passes it to every resource.
- **Inputs/Outputs**: Many resource properties are not known until deploy time. Pulumi models them as `Input<T>` and `Output<T>`. This repo uses `pulumi.Output` for derived values like `redisUrl` and `databaseUrl`.
- **Dependency graph**: Pulumi builds a graph from inputs/outputs and creates resources in the correct order automatically.
- **Preview/Up**:
  - `pulumi preview` shows planned changes without creating anything.
  - `pulumi up` applies the changes.
- **Destroy**: `pulumi destroy` removes resources for a stack.

## Where Pulumi lives in this repo

- **Project root**: `infra/pulumi/`
  - `Pulumi.yaml`: Project definition (name + runtime).
  - `Pulumi.prod.example.yaml`: Example stack config (checked in, no secrets).
  - `Pulumi.<stack>.yaml`: Real stack config (ignored by git).
  - `package.json` + `tsconfig.json`: TypeScript runtime and deps.
  - `index.ts`: Main entry point executed by Pulumi.

## How it works end-to-end in this repo

### 1) Configuration and provider

`infra/pulumi/config.ts` reads the stack config and sets defaults. It also builds an AWS provider with default tags. Key ideas:

- **Plain config**: region, ports, cpu/memory, counts, RDS/Redis settings.
- **Secrets**: service auth token, encryption key, provider API keys, DB password, etc.
- **Provider**: `new aws.Provider("aws", { region, defaultTags })`.

Every resource uses this provider so all resources are tagged and created in the intended region.

### 2) Main composition

`infra/pulumi/index.ts` orchestrates the entire graph in a single pass:

1. **Network**: `createNetwork()` → VPC, subnets, IGW, NAT, routes.
2. **Security groups**: `createServiceSecurityGroups()` → SGs for worker + gateway + llm-proxy + their ALBs.
3. **Redis**: `createCache()` → ElastiCache + redis URL.
4. **Database**: `createDatabase()` → RDS instance + DB URL (or uses override if RDS disabled).
5. **Secrets**: `createSecrets()` → AWS Secrets Manager records built from config + database URL.
6. **ECS services**: `createEcsServices()` → ECS cluster, ECR repos, IAM roles, and Fargate services.
7. **Outputs**: `buildOutputs()` → exports URLs and IDs for downstream use.

This file is the single source of truth for the infra graph.

### 3) Network layer

`infra/pulumi/network/index.ts` creates:

- VPC: `10.0.0.0/16`
- 2 public subnets + 2 private subnets
- Internet Gateway + NAT Gateway
- Public + private route tables

The ECS services and RDS/Redis are placed in **private subnets**. ALBs for public endpoints attach to the same subnets (subnet set is passed in at service creation).

### 4) Security groups

`infra/pulumi/ecs/security-groups.ts` establishes:

- **ALB SGs**: allow ingress from 0.0.0.0/0 on 80/443.
- **Task SGs**: allow ingress only from the corresponding ALB SG.
- **Worker SG**: outbound-only (no ingress).

Redis/RDS are locked down to traffic from ECS task security groups (and optional CIDRs for DB).

### 5) Redis (ElastiCache)

`infra/pulumi/cache/index.ts` creates:

- Subnet group + parameter group
- Either a **single-node cluster** or a **replication group** depending on `redisReplicationEnabled`
- `redisUrl` is computed as `redis://<endpoint>:6379`

Only ECS tasks can reach Redis (via SG rules).

### 6) Postgres (RDS)

`infra/pulumi/database/index.ts` handles two modes:

- **RDS enabled**: Creates a Postgres RDS instance with storage encryption and configurable backups.
- **RDS disabled**: Requires `databaseUrlOverride` and skips RDS creation.

Database access is limited to ECS task SGs and optional CIDR allowlist.

### 7) Secrets

`infra/pulumi/secrets/index.ts` creates 3 Secrets Manager secrets:

- `proliferate-worker`
- `proliferate-llm-proxy`
- `proliferate-gateway`

Each secret JSON payload is composed from:

- `DATABASE_URL`
- Shared auth/encryption keys
- Provider keys (Anthropic, E2B, Nango, GitHub app key, S3 keys, etc.)

ECS tasks read individual keys from these secrets via the `buildSecrets` helper in `infra/pulumi/ecs/env.ts`.

### 8) ECS, ECR, and IAM

`infra/pulumi/ecs/index.ts` creates:

- **ECS Cluster**: Fargate cluster with container insights enabled.
- **ECR Repos**: `worker`, `gateway`, `llm-proxy` with a 10-image lifecycle policy.
- **IAM Roles**:
  - Execution role with access to Secrets Manager
  - Task role for runtime permissions

Then it provisions three services:

#### LLM Proxy
`infra/pulumi/ecs/llm-proxy.ts`

- Public ALB with optional TLS
- Health check: `/health/liveliness`
- Pulls secrets from Secrets Manager

#### Gateway
`infra/pulumi/ecs/gateway.ts`

- Public ALB with optional TLS
- Health check: `/health`
- Env vars include Redis URL, API URL, GitHub app ID, Nango integration ID, and S3 config
- Secrets include DB URL and service auth credentials

#### Worker
`infra/pulumi/ecs/worker.ts`

- No public ALB
- Env vars include Redis URL, Gateway URL, app URL, and billing flags
- Secrets include DB URL and service auth credentials

### 9) Outputs

`infra/pulumi/outputs.ts` exports key values:

- VPC + subnet IDs
- Redis endpoint + URL
- Database endpoint
- Gateway + LLM proxy public URLs
- ECR repo URLs

These are exposed via `pulumi stack output` and can be used by scripts or external systems.

## End-to-end usage (typical flow)

1. **Bootstrap state backend** (S3 + DynamoDB lock):
   - Run `scripts/setup-pulumi.sh` to create the state bucket and lock table.
2. **Login to backend**:
   - `pulumi login 's3://<bucket>/<prefix>?region=<region>&dynamodb_table=<table>'`
3. **Select or init a stack**:
   - `pulumi stack select <stack>` or `pulumi stack init <stack>`
4. **Set config values**:
   - `pulumi config set aws:region us-east-1`
   - `pulumi config set proliferate-infra:serviceAuthToken --secret <value>`
   - Add all required secrets referenced in `infra/pulumi/config.ts`.
5. **Preview**:
   - `pulumi preview`
6. **Apply**:
   - `pulumi up`
7. **Read outputs**:
   - `pulumi stack output --json`

## What is required vs optional

- **Required secrets (cloud)**: `serviceAuthToken`, `userSecretsEncryptionKey`, `anthropicApiKey`, `betterAuthSecret`, `githubAppPrivateKey`, `githubAppWebhookSecret`, `billingJwtSecret`, `autumnApiKey`, `resendApiKey`, and (if RDS enabled) `dbPassword`.
- **Required secrets (conditional)**: `e2bApiKey` when `defaultSandboxProvider=e2b`, `modalTokenId` + `modalTokenSecret` when `defaultSandboxProvider=modal`, `nangoSecretKey` when `integrationsEnabled=true`, `llmProxyMasterKey` when running the LLM proxy.
- **Required non‑secrets (cloud)**: `githubAppId`, `githubAppSlug`, `autumnApiUrl`, `emailFrom`, `defaultSandboxProvider`.
- **Required non‑secrets (conditional)**: `e2bDomain`, `e2bTemplate`, `e2bTemplateAlias` when using E2B; `modalAppName` when using Modal; Nango integration IDs (`nangoGithubIntegrationId`, `nangoLinearIntegrationId`, `nangoSentryIntegrationId`) when `integrationsEnabled=true`.
- **Optional values**: TLS cert ARNs, public URL overrides, DB allowed CIDRs, S3 config, etc.
- **Optional RDS**: You can disable RDS with `enableRds=false` and supply `databaseUrlOverride`.

**Cloud profile:** set `DEPLOYMENT_PROFILE=cloud` and `NEXT_PUBLIC_BILLING_ENABLED=true` in runtime config for hosted deployments.

## Mental model (one-paragraph summary)

Pulumi runs TypeScript in `infra/pulumi/index.ts`, reads stack config from `Pulumi.<stack>.yaml`, and builds a dependency graph of AWS resources. The graph creates networking, Redis, Postgres, secrets, and ECS services. Secrets are assembled once in Secrets Manager and injected into ECS tasks. Public ALBs front the gateway and LLM proxy services, while the worker runs privately. Outputs give you the URLs and IDs to connect the rest of the system.
