# Infrastructure Spec: Pulumi Migration & One-Click Deployment

> Migrate from Terraform to Pulumi and enable near one-click self-hosting.

## Goals

1. **Migrate** existing Terraform infrastructure to Pulumi (TypeScript)
2. **Simplify** deployment to: clone repo → fill in API keys → `pulumi up`
3. **Support** AWS initially, with architecture ready for GCP/Azure later
4. **Keep Modal/E2B** as pluggable sandbox providers (users provide their own credentials)

---

## Phase 1: Terraform → Pulumi Migration

### Current Terraform Resources

From `infra/terraform/`:

| File | Resources |
|------|-----------|
| `main.tf` | VPC, subnets (public/private), NAT gateway, internet gateway, route tables, ECS cluster, CloudWatch log groups |
| `worker.tf` | ECR repo, IAM roles (execution + task), ECS task definition, ECS service, security groups |
| `llm-proxy.tf` | ECR repo, ALB + listeners, target group, ECS task definition, ECS service, security groups |
| `elasticache.tf` | Redis cluster, subnet group, parameter group (noeviction for BullMQ), security groups |
| `variables.tf` | Region, environment, app URL, certificate ARN |

### Pulumi Structure

```
infra/
├── pulumi/
│   ├── index.ts              # Main entrypoint - composes all modules
│   ├── Pulumi.yaml           # Project configuration
│   ├── (no Pulumi.<stack>.yaml files) # Stack config set via CLI only
│   │
│   ├── config.ts             # Typed config loader (reads from Pulumi config + env)
│   │
│   ├── network/
│   │   └── index.ts          # VPC, subnets, NAT, IGW, route tables
│   │
│   ├── database/
│   │   └── index.ts          # RDS PostgreSQL (optional - can use external)
│   │
│   ├── cache/
│   │   └── index.ts          # ElastiCache Redis with BullMQ config
│   │
│   ├── secrets/
│   │   └── index.ts          # AWS Secrets Manager entries
│   │
│   ├── ecs/
│   │   ├── index.ts          # ECS cluster, shared IAM roles
│   │   ├── gateway.ts        # Gateway service (WebSocket)
│   │   ├── worker.ts         # Worker service (BullMQ jobs)
│   │   ├── llm-proxy.ts      # LLM Proxy service + ALB
│   │   └── web.ts            # Next.js app (optional - can use Vercel)
│   │
│   └── outputs.ts            # Stack outputs (URLs, endpoints)
│
├── terraform/                # Existing (to be deprecated)
│   └── ...
│
└── SPEC.md                   # This file
```

### Migration Steps

1. **Setup Pulumi project**
   - Initialize `infra/pulumi/` with TypeScript
   - Add `@pulumi/aws`, `@pulumi/awsx` dependencies
   - Configure state backend (Pulumi Cloud or S3)

2. **Migrate network layer** (`main.tf` → `network/index.ts`)
   - VPC with DNS hostnames
   - 2 public + 2 private subnets across AZs
   - NAT gateway in public subnet
   - Internet gateway
   - Route tables (public via IGW, private via NAT)

3. **Migrate cache layer** (`elasticache.tf` → `cache/index.ts`)
   - Redis 7.0 cluster (cache.t3.micro for dev, larger for prod)
   - Custom parameter group with `maxmemory-policy=noeviction`
   - Prefer **Replication Group** with snapshot retention + automatic failover
   - Protect from accidental deletion/replacement (`protect: true`, snapshot retention enabled)
   - Security group allowing 6379 from ECS tasks

3b. **Add database layer** (`database/index.ts`)
   - RDS PostgreSQL (managed) when `enableRds=true`
   - Enable deletion protection + final snapshots
   - Use Pulumi `protect: true` to block accidental replacement

4. **Migrate ECS cluster** (`main.tf` partial → `ecs/index.ts`)
   - ECS cluster with Container Insights
   - Shared execution role (ECR pull, Secrets Manager read)
   - Shared task role
   - CloudWatch log groups (30-day retention)

5. **Migrate worker service** (`worker.tf` → `ecs/worker.ts`)
   - ECR repository with lifecycle policy
   - Task definition (256 CPU, 512 MB)
   - Service in private subnets
   - Health check on port 8080

6. **Migrate LLM proxy service** (`llm-proxy.tf` → `ecs/llm-proxy.ts`)
   - ECR repository
   - ALB with HTTP/HTTPS listeners
   - Target group with health checks
   - Task definition (512 CPU, 1024 MB)
   - Service with ALB attachment

7. **Add gateway service** (new - `ecs/gateway.ts`)
   - Currently not in Terraform (runs separately)
   - Add as ECS service with WebSocket support
   - ALB or NLB for WebSocket connections

8. **Add secrets management** (`secrets/index.ts`)
   - Create Secrets Manager entries for all required secrets
   - Reference in task definitions

9. **Validate and cutover**
   - Deploy to staging environment
   - Run side-by-side with Terraform
   - Switch DNS, deprecate Terraform

---

## Phase 2: One-Click Deployment UX

### Target Experience

```bash
# Clone and setup
git clone https://github.com/proliferate-ai/cloud
cd cloud

# Interactive setup (creates .env and Pulumi config)
pnpm run setup

# Deploy infrastructure
cd infra/pulumi && pulumi up

# Deploy application
pnpm run deploy
```

### Setup CLI (`scripts/setup.ts`)

Interactive wizard that:

1. **Asks for cloud provider** (AWS initially)
2. **Prompts for required credentials**:
   - AWS access key + secret (or uses existing AWS profile)
   - Anthropic API key
   - GitHub App ID + private key
   - GitHub OAuth client ID + secret
   - Modal or E2B credentials (user choice)
3. **Optional credentials**:
   - Google OAuth (for Google login)
   - Resend API key (for email invites)
   - Custom domain + ACM certificate ARN
4. **Generates files**:
   - `.env.local` with all secrets
   - Pulumi config set via CLI (no stack YAML files)
5. **Validates** credentials where possible (test API calls)

### Required Environment Variables

These are the **minimum** for a working deployment:

| Variable | Source | Purpose |
|----------|--------|---------|
| `AWS_ACCESS_KEY_ID` | AWS IAM | Infrastructure provisioning |
| `AWS_SECRET_ACCESS_KEY` | AWS IAM | Infrastructure provisioning |
| `AWS_REGION` | User choice | Where to deploy (default: us-east-1) |
| `ANTHROPIC_API_KEY` | Anthropic Console | Claude API access |
| `GITHUB_APP_ID` | GitHub Developer Settings | Repo access |
| `GITHUB_APP_PRIVATE_KEY` | GitHub Developer Settings | Repo access |
| `GITHUB_OAUTH_APP_ID` | GitHub Developer Settings | User login |
| `GITHUB_OAUTH_APP_SECRET` | GitHub Developer Settings | User login |
| `MODAL_TOKEN_ID` | Modal Dashboard | Sandbox runtime |
| `MODAL_TOKEN_SECRET` | Modal Dashboard | Sandbox runtime |

**Or E2B instead of Modal:**

| Variable | Source | Purpose |
|----------|--------|---------|
| `E2B_API_KEY` | E2B Dashboard | Sandbox runtime |

### Auto-Generated Secrets

These are generated by the setup script:

| Variable | Generation |
|----------|------------|
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `SERVICE_TO_SERVICE_AUTH_TOKEN` | `openssl rand -base64 32` |
| `USER_SECRETS_ENCRYPTION_KEY` | `openssl rand -base64 32` |
| `DATABASE_URL` | Constructed from RDS endpoint |
| `REDIS_URL` | Constructed from ElastiCache endpoint |

### Optional Enhancements

| Variable | Purpose | Default Behavior Without |
|----------|---------|-------------------------|
| `GOOGLE_CLIENT_ID` | Google OAuth login | GitHub-only auth |
| `GOOGLE_CLIENT_SECRET` | Google OAuth login | GitHub-only auth |
| `RESEND_API_KEY` | Email invitations | Invites disabled |
| `AUTUMN_API_KEY` | Usage-based billing | No billing metering |
| `DOMAIN_NAME` | Custom domain | Use default ALB/ECS URLs |
| `ACM_CERTIFICATE_ARN` | HTTPS | HTTP only (not recommended) |

---

## Phase 3: Pulumi Configuration Schema

### Pulumi.yaml

```yaml
name: proliferate
runtime: nodejs
description: Proliferate infrastructure

config:
  # Required
  aws:region:
    type: string
    default: us-east-1

  # Sizing (defaults for small deployment)
  proliferate:workerCpu:
    type: number
    default: 256
  proliferate:workerMemory:
    type: number
    default: 512
  proliferate:llmProxyCpu:
    type: number
    default: 512
  proliferate:llmProxyMemory:
    type: number
    default: 1024
  proliferate:gatewayCpu:
    type: number
    default: 256
  proliferate:gatewayMemory:
    type: number
    default: 512
  proliferate:redisCacheNodeType:
    type: string
    default: cache.t3.micro

  # Optional features
  proliferate:enableRds:
    type: boolean
    default: true
    description: Create RDS PostgreSQL (false = use external database)
  proliferate:enableHttps:
    type: boolean
    default: false
    description: Enable HTTPS (requires certificateArn)
  proliferate:certificateArn:
    type: string
    secret: true
  proliferate:domainName:
    type: string
```

### Stack Config (CLI Only, No YAML Files)

**Dev (minimal for testing):**
```bash
pulumi config set aws:region us-east-1
pulumi config set proliferate:workerCpu 256
pulumi config set proliferate:workerMemory 512
pulumi config set proliferate:redisCacheNodeType cache.t3.micro
pulumi config set proliferate:enableHttps false
```

**Prod (production-ready):**
```bash
pulumi config set aws:region us-east-1
pulumi config set proliferate:workerCpu 512
pulumi config set proliferate:workerMemory 1024
pulumi config set proliferate:llmProxyCpu 1024
pulumi config set proliferate:llmProxyMemory 2048
pulumi config set proliferate:gatewayCpu 512
pulumi config set proliferate:gatewayMemory 1024
pulumi config set proliferate:redisCacheNodeType cache.t3.small
pulumi config set proliferate:enableHttps true
pulumi config set proliferate:certificateArn arn:aws:acm:...
pulumi config set proliferate:domainName app.example.com
```

---

## Phase 4: CI/CD Updates

### GitHub Actions Changes

Replace ECS deployment workflows with Pulumi:

```yaml
# .github/workflows/deploy.yml
name: Deploy Infrastructure

on:
  push:
    branches: [main]
    paths:
      - 'infra/pulumi/**'
      - 'apps/worker/**'
      - 'apps/llm-proxy/**'
      - 'packages/gateway/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pulumi/actions@v5
        with:
          command: up
          stack-name: prod
          work-dir: infra/pulumi
        env:
          PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

### Preview on PRs

```yaml
# .github/workflows/pulumi-preview.yml
name: Pulumi Preview

on:
  pull_request:
    paths:
      - 'infra/pulumi/**'

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pulumi/actions@v5
        with:
          command: preview
          stack-name: prod
          work-dir: infra/pulumi
          comment-on-pr: true
        env:
          PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}
```

---

## Phase 5: Documentation

### Self-Hosting Guide

Create `docs/self-hosting.md`:

1. **Prerequisites**
   - AWS account with admin access
   - Modal or E2B account
   - GitHub account (for OAuth app)
   - Anthropic API key

2. **Quick Start** (5 steps)
   - Clone repo
   - Run setup wizard
   - Review generated config
   - Deploy with Pulumi
   - Access your instance

3. **Configuration Reference**
   - All environment variables
   - Pulumi config options
   - Scaling recommendations

4. **Troubleshooting**
   - Common deployment errors
   - How to check logs
   - How to redeploy

---

## Open Questions

1. **State backend**: Pulumi Cloud (free tier) or self-managed S3?
2. **Multi-cloud**: Worth designing for GCP/Azure now, or AWS-only initially?
3. **Database**: Include RDS in Pulumi, or assume external database?
4. **Web hosting**: Include Next.js in ECS, or keep Vercel as default?
5. **Sandbox providers**: Any preference between Modal vs E2B as default recommendation?

---

## Appendix: Resource Mapping

| Terraform Resource | Pulumi Equivalent |
|--------------------|-------------------|
| `aws_vpc` | `awsx.ec2.Vpc` or `aws.ec2.Vpc` |
| `aws_subnet` | `aws.ec2.Subnet` |
| `aws_nat_gateway` | `aws.ec2.NatGateway` |
| `aws_internet_gateway` | `aws.ec2.InternetGateway` |
| `aws_route_table` | `aws.ec2.RouteTable` |
| `aws_ecs_cluster` | `aws.ecs.Cluster` |
| `aws_ecs_service` | `awsx.ecs.FargateService` |
| `aws_ecs_task_definition` | `awsx.ecs.FargateTaskDefinition` |
| `aws_ecr_repository` | `awsx.ecr.Repository` |
| `aws_elasticache_cluster` | `aws.elasticache.Cluster` |
| `aws_lb` | `awsx.lb.ApplicationLoadBalancer` |
| `aws_secretsmanager_secret` | `aws.secretsmanager.Secret` |
| `aws_iam_role` | `aws.iam.Role` |
| `aws_cloudwatch_log_group` | `aws.cloudwatch.LogGroup` |

---

## CLI Setup Spec (AWS + Pulumi, Idempotent)

### Objectives

- Provide a guided, near one-click setup for AWS + Pulumi.
- Ensure **every** variable in `packages/environment/src/schema.ts` has a value.
- Prefer Pulumi/AWS-derived values and safe autogeneration before prompting.
- Keep the flow **idempotent**: reuse existing resources/config unless the user opts to change.

### Entry Point

```
pnpm run setup
```

### Idempotency Rules

- If `.env.prod` exists, **reuse its values** as defaults and do **not** overwrite without confirmation.
- If Pulumi backend bucket/table exist, **reuse** them.
- If Pulumi stack exists, **select** it; only initialize when missing.
- If Pulumi config keys are already set, prompt before changing.
- If outputs already exist (e.g., database/redis URLs), prefer them over prompts.

### Setup Flow (Required)

1. **Preflight**
   - Check for Pulumi CLI; install if missing (Homebrew if available, otherwise official installer).
   - Check AWS credentials with STS; if missing/invalid, prompt user to authenticate (access keys or existing AWS profile/SSO).

2. **Pulumi Backend (S3 + DynamoDB)**
   - Create or reuse:
     - S3 bucket (versioning, encryption, public access block)
     - DynamoDB table for locks
   - Run `pulumi login s3://...` using the backend.

3. **Pulumi Stack**
   - Select or init stack (default: `dev`).
   - Set core config:
     - `aws:region`
     - `proliferate:enableRds = true`
     - `proliferate:enableHttps`
     - `proliferate:domainName` (optional)
     - `proliferate:certificateArn` (secret, if HTTPS)

4. **Custom Domain + TLS**
   - Ask if the user wants Pulumi to manage Route53 + ACM:
     - **Yes**: create hosted zone, request cert, add DNS validation, wait for issuance.
     - **No**: prompt for existing `certificateArn` and print DNS validation steps.

5. **Run Pulumi**
   - Default: run `pulumi up --yes`.
   - Optional: allow `--skip-pulumi-up`.
   - Read stack outputs (e.g., app URL, gateway URL, database URL, redis URL).

6. **Migrations (Optional, Safe)**
   - If enabled, run DB migrations via a one-off ECS task (no DB creds on CI runner).
   - Use Pulumi outputs for:
     - `migrationsClusterArn`
     - `migrationsTaskDefinitionArn`
     - `migrationsSubnetIds`
     - `migrationsSecurityGroupIds`
   - Only run after a successful `pulumi up`.

7. **Environment Resolution (Full Schema)**
   - Iterate **all keys** in `packages/environment/src/schema.ts`.
   - Resolve in this order:
     1. Existing `.env.prod` values
     2. Pulumi stack outputs
     3. AWS-derived defaults (S3 endpoint/region, etc.)
     4. Autogenerated values (secrets)
     5. User prompt (default to `.env.example`)
   - **Force a value for every key** (no empty values).

8. **Required Prompts**
   - **GitHub App** (required): `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET`, `NEXT_PUBLIC_GITHUB_APP_SLUG`
   - **GitHub OAuth** (required by schema): `GITHUB_OAUTH_APP_ID`, `GITHUB_OAUTH_APP_SECRET`
   - **Sandbox provider**: choose `modal` or `e2b`, then prompt for provider-specific keys.
   - **API keys**: Anthropic/OpenAI, Resend, Slack, Nango, etc. (all keys in schema)
   - **Ports + runtime flags**: `WEB_PORT`, `WORKER_PORT`, `GATEWAY_PORT`, `API_PORT`, `LLM_PROXY_REQUIRED`, etc.

9. **Autogeneration (Optional Prompt)**
   - Ask if the user wants autogenerated values for dev/test keys:
     - `AUTH_TOKEN`, `TEST_TOKEN`, `TEST_REPO_ID`, `DEV_USER_ID`
   - Always generate secure defaults for:
     - `BETTER_AUTH_SECRET`, `SERVICE_TO_SERVICE_AUTH_TOKEN`, `USER_SECRETS_ENCRYPTION_KEY`,
       `BILLING_JWT_SECRET`, `LLM_PROXY_MASTER_KEY`

10. **Write `.env.prod`**
   - Preserve `.env.example` ordering.
   - Escape multiline secrets (e.g., GitHub App private key).
   - Print a summary + next-step checklist (DNS, OAuth callbacks, webhook URL).

### Notes

- Email/password-only auth is supported, but schema currently requires OAuth keys; user must still supply values.
- AWS-only: use managed **RDS (Postgres)** and **ElastiCache (Redis)** by default.
- GitHub App credentials are **required** for integrations/webhooks.
- Protect data stores by default (Pulumi resource protection + deletion protection/snapshots) and require explicit opt-out to replace.
