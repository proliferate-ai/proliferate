# Proliferate - Agent Guidelines

> Code style, patterns, and conventions for AI coding agents working on this codebase.

**Proliferate is fully open source under the MIT license.** Every commit is public. Never commit secrets, credentials, or proprietary material to any branch.

## Core Philosophy

- **Minimal and elegant**: Less code is better. Every line should earn its place.
- **Reads like English**: Code should be self-explanatory through explicit naming.
- **Follow existing patterns**: Never duplicate functionality. Find and extend what exists.
- **No surprises**: Ask before making architecture decisions.
- **Open source first**: Only use MIT/Apache-2.0/BSD-compatible dependencies. No GPL, AGPL, SSPL, or BSL.

## Stack & Architecture

- **TypeScript** - Primary language for API, frontend, and Gateway
- **Python** - Modal image + deploy script only (`packages/modal-sandbox/`)
- **Frontend**: Next.js + React + TanStack Query + Zustand + Tailwind + shadcn/ui
- **API**: Next.js API routes (session lifecycle, repo management, NOT real-time streaming)
- **Real-Time**: Gateway service (WebSocket connections, message state)
- **Sandboxes**: Modal (default) or E2B providers + OpenCode (coding agent)
- **Background Jobs**: BullMQ workers in Kubernetes (EKS in prod) + ElastiCache Redis
- **Database**: PostgreSQL via Drizzle ORM (metadata only)
- **Auth**: better-auth
- **Infrastructure**: Pulumi + Helm for cloud (`infra/pulumi-k8s/`, `infra/pulumi-k8s-gcp/`); legacy ECS in `infra/pulumi/` + `infra/terraform/`

```
Client ──WebSocket──► Gateway ◄──HTTP── Sandbox (Modal/E2B + OpenCode)
                         │
Next.js API: session lifecycle only (create/pause/resume/delete)
PostgreSQL: metadata persistence only (not in streaming path)
```

**Key principle**: API routes are NOT in the real-time streaming path. All streaming goes Client ↔ Gateway ↔ Sandbox.

## Repo Layout (Top-Level)

```
apps/                 # web, gateway, worker, llm-proxy, trigger-service
packages/             # shared, services, db, gateway-clients, environment, cli, modal-sandbox
charts/               # Helm chart
infra/                # pulumi-k8s (EKS), pulumi-k8s-gcp (GKE), legacy ECS
scripts/              # one-off scripts
AGENTS.md             # agent guidelines (Codex, etc.)
CLAUDE.md             # this file (Claude Code)
```

## Code Style

- Tabs for indentation
- Semicolons required
- Run `biome check` before committing

**Naming**
- `camelCase` for variables/functions
- `PascalCase` for types/components/classes
- Be explicit: names should carry meaning, not abbreviations

## Code Organization (Shared Utils & DB)

**Web utilities**
- `apps/web/src/lib/` is **web-only**. If a helper is used outside the web app, move it:
- Shared, pure helpers/types → `packages/shared/`
- Backend/business logic → `packages/services/`

**Database operations (must follow)**
- **All DB reads/writes live in `packages/services/src/**/db.ts`.**
- Import Drizzle helpers + schema from `@proliferate/services/db/client` (preferred).
- **Do not** import `@proliferate/db` directly outside the services package (except migrations/tests).
- Next.js API routes should call `packages/services` methods, not query DB directly.

## Frontend Rules

- **Data fetching**: TanStack Query + oRPC. No raw `fetch("/api/..." )` in components.
- **WebSocket streaming**: use `@proliferate/gateway-clients`.

```ts
import { createSyncClient } from "@proliferate/gateway-clients";

const client = createSyncClient({
  baseUrl: GATEWAY_URL,
  auth: { type: "token", token },
  source: "web",
});

const ws = client.connect(sessionId, { onEvent: handleEvent });
ws.sendPrompt(content, userId);
```

- **Client-only state**: Zustand (onboarding, UI state). Server state stays in TanStack Query.
- **UI**: Tailwind + shadcn/ui only. No native `alert/confirm/prompt`.
- **Colors & theming**: Always use the CSS custom properties from `globals.css` via Tailwind classes (`bg-background`, `text-foreground`, `border-border`, `bg-muted`, etc.). Never hardcode hex/rgb/hsl values. Key tokens: `background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, `sidebar`, `chat-input`. All tokens have light and dark mode variants already defined.
- **Component reuse**: check `components/ui/` before creating new patterns.
- **No raw HTML form elements in pages**: In route components under `apps/web/src/app/**` (pages/layouts/templates) and feature components under `apps/web/src/components/` (except `ui/`), prefer shadcn/ui primitives (`Button`, `Input`, `Label`, `Select`, `Textarea`) from `@/components/ui/` over raw `<button>`, `<input>`, `<label>`, `<select>`, `<textarea>`. Raw elements are expected inside `apps/web/src/components/ui/**` primitives themselves.
- **Hooks**: kebab-case filenames (`use-repos.ts`).

## Backend Rules

- API routes are thin wrappers; real-time is Gateway only.
- oRPC procedures live in `apps/web/src/server/routers/` and are consumed via hooks or direct oRPC client.
- Drizzle only; no raw SQL unless absolutely necessary.
- Throw errors, don’t return `{ ok: false }` objects.

## Logging

- Prefer structured logs (JSON) in Node services. Don’t add new `console.*` in `apps/gateway`, `apps/worker`, `apps/trigger-service`, or `packages/services`.
- Use `@proliferate/logger` (`packages/logger/`) as the default logger:

```ts
import { createLogger } from "@proliferate/logger";

const logger = createLogger({ service: "gateway" });
const log = logger.child({ sessionId });

log.info({ userId }, "Client connected");
log.error({ err }, "Failed to handle prompt");
```

- Add context via `logger.child({ ... })` (recommended keys: `requestId`, `sessionId`, `orgId`, `userId`, `jobId`).
- Log errors as `logger.error({ err }, "...")` so stacks/causes serialize consistently.
- Never log secrets or sensitive payloads. Treat `authorization` headers, cookies, tokens, private keys, `DATABASE_URL`, and user prompt content as sensitive. Redaction helps, but don’t rely on it.
- Avoid high-cardinality blobs in logs (full request bodies, prompts, huge arrays). Prefer IDs and lengths.
- Env:
  - `LOG_LEVEL`: `trace|debug|info|warn|error|fatal|silent` (default `info`)
  - `LOG_PRETTY`: `true|false` (default `true` in non-production)
- Express services should use request logging middleware (`pino-http`) via `createHttpLogger()`:

```ts
import { createHttpLogger } from "@proliferate/logger";

app.use(createHttpLogger({ logger }));
```

## Sandboxes

- Providers: Modal (default) and E2B (`packages/shared/src/providers/`).
- Python only in `packages/modal-sandbox/` (image + `deploy.py`).
- Deploy Modal: `cd packages/modal-sandbox && modal deploy deploy.py`
- Modal docs: https://docs.proliferate.com/self-hosting/modal-setup
- OpenCode plugin is **minimal SSE** (no event pushing). See `packages/shared/src/sandbox/config.ts`.

## Workers & Infra (K8s/EKS)

- Prod runs on EKS via Pulumi + Helm (`infra/pulumi-k8s/`, `charts/proliferate/`).
- ECS workflows are **legacy/manual only**.

Key commands:
- `make aws-health`, `make aws-logs-worker`
- `K8S_CLOUD=aws make k8s-pods`
- `make deploy-cloud SHA=<sha> STACK=prod`

## Secrets & Sensitive Information

**This repo is public. Treat every branch as public.**

- **Never commit**: API keys, tokens, passwords, private keys, connection strings, customer data, internal URLs, or `.env` files.
- **Never hardcode** secrets or credentials anywhere in source — use environment variables.
- If you accidentally stage a secret, remove it from the commit **and** rotate the secret immediately.
- Verify `.gitignore` covers any new secret/config files before committing.
- Local dev: `.env.local`
- Cloud runtime: AWS Secrets Manager → External Secrets → K8s
- App runtime env **overrides Modal secrets** when creating sessions
- Source of truth for env keys: `packages/environment/src/schema.ts` and https://docs.proliferate.com/self-hosting/environment (source: `~/documentation/self-hosting/environment.mdx`)
- Vercel is optional; if used, avoid `echo` when setting env vars (newline issue)

## CI/CD Overview

- `ci.yml`: lint/typecheck/tests/build
- `deploy-eks.yml`: manual EKS deploy (ECR build/push + Pulumi + health checks)
- `deploy-ecs.yml`: manual legacy ECS deploy
- `deploy-modal.yml`: Modal deploy on changes to `packages/modal-sandbox/**`
- `docker-publish.yml`: GHCR images on `v*` tags
- `changesets.yml` + `release-cli.yml`: CLI release pipeline

## Makefile Shortcuts

Run `make` or `make help` for the full list. Common targets:
- `make services`, `make ngrok`, `make web`, `make gateway`, `make worker`
- `make db-migrate`, `make aws-health`, `make deploy-cloud`

## Testing

- Use Vitest
- Test pure functions + API handlers
- Skip unit tests for React UI (manual review instead)

## Git Workflow

- **Do not create branches** unless explicitly asked.
- Use conventional commits (`feat:`, `fix:`, `chore:`) for commits and PR titles.
- When opening a PR: use the PR template (`.github/PULL_REQUEST_TEMPLATE.md`) and fill every section.
- On merge conflicts: summarize each conflict before choosing a resolution.
- Before committing: `pnpm typecheck`, `pnpm lint`, `pnpm test` (where applicable), `pnpm build`.

## Architecture Decisions

Ask before:
- Adding dependencies — verify the license is MIT/Apache-2.0/BSD-compatible (no GPL, AGPL, SSPL, BSL)
- Creating new patterns/abstractions
- Changing core systems (Gateway ↔ Sandbox, DB schema, event types)

## Documentation

Do not update docs unless explicitly asked.

## Database Notes (Condensed)

- DB stores metadata and billing, **not** real-time message content.
- Migrations: `packages/db/drizzle/` (`pnpm -C packages/db db:generate` / `db:migrate`).

## Common Mistakes to Avoid

- Routing messages through API routes
- Polling for messages instead of WebSocket
- Raw `fetch("/api/..." )` in components
- API calls inside `components/ui/`
- Server state in Zustand
- Committing secrets, `.env` files, or credentials to any branch
- Adding dependencies with GPL/AGPL/SSPL/BSL licenses
