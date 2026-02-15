# Spec Agent Prompts

> Copy-paste these prompts when spawning agents. Phase 1 first, then phase 2 after phase 1 specs exist, then phase 3.

---

## Phase 1 (write first — everything else references these)

### 1. Agent Contract

```
You are writing a system spec for the Proliferate codebase.

READ THESE FILES FIRST (in order):
1. docs/specs/boundary-brief.md — boundary rules and glossary (MANDATORY)
2. docs/specs/template.md — spec template (follow exactly)
3. docs/specs/feature-registry.md — section 1 (Agent Contract features)

YOUR ASSIGNMENT:
- Spec file: docs/specs/agent-contract.md
- In scope:
  - System prompt modes: setup, coding, automation (how they differ, what each injects)
  - OpenCode tool schemas: verify, save_snapshot, save_service_commands, automation.complete, request_env_variables
  - Capability injection: how tools get registered in the sandbox OpenCode config
  - Tool input/output contracts and validation
  - Which tools are available in which session modes
- Out of scope:
  - How tools are executed at runtime (sessions-gateway.md)
  - How tools are injected into the sandbox environment (sandbox-providers.md)
  - Action tools / external-service operations (actions.md)
  - Automation run lifecycle that calls these tools (automations-runs.md)

KEY FILES TO READ:
- packages/shared/src/prompts.ts (all prompt builders)
- packages/shared/src/opencode-tools/index.ts (all tool definitions)
- packages/shared/src/sandbox/config.ts (plugin injection, tool registration)
- packages/shared/src/agents.ts (agent/LLM types)
- apps/gateway/src/hub/capabilities/tools/ (tool implementations — read to understand contracts, but runtime behavior is sessions-gateway.md's scope)

RULES:
- Document what is in main today, not aspirational design
- Cite file paths as evidence for every behavioral claim
- Link to other specs for out-of-scope concepts (see boundary brief §4)
- Use only terms from the canonical glossary (see boundary brief §3)
- Target 300-600 lines
- Classify every feature as Implemented/Partial/Planned/Deprecated
```

### 2. Sandbox Providers

```
You are writing a system spec for the Proliferate codebase.

READ THESE FILES FIRST (in order):
1. docs/specs/boundary-brief.md — boundary rules and glossary (MANDATORY)
2. docs/specs/template.md — spec template (follow exactly)
3. docs/specs/feature-registry.md — section 2 (Sandbox Providers features)

YOUR ASSIGNMENT:
- Spec file: docs/specs/sandbox-providers.md
- In scope:
  - SandboxProvider interface and provider contract
  - Modal provider implementation (libmodal SDK)
  - E2B provider implementation
  - Modal image and deploy script (Python)
  - Sandbox-MCP: API server, terminal WebSocket, service manager, auth, CLI setup
  - Sandbox environment variable injection at boot
  - OpenCode plugin injection (the PLUGIN_MJS template string)
  - Snapshot version key computation
  - Snapshot resolution (which layers to use)
  - Git freshness / pull cadence
  - Port exposure (proliferate services expose)
- Out of scope:
  - Session lifecycle that calls the provider (sessions-gateway.md)
  - Tool schemas and prompt templates (agent-contract.md)
  - Snapshot build jobs — base snapshot workers (`repos-prebuilds.md`)
  - Secret values and bundle management (secrets-environment.md)
  - LLM key generation (llm-proxy.md)

KEY FILES TO READ:
- packages/shared/src/sandbox-provider.ts (interface)
- packages/shared/src/providers/modal-libmodal.ts (Modal provider)
- packages/shared/src/providers/e2b.ts (E2B provider)
- packages/shared/src/sandbox/config.ts (env vars, plugin, boot config)
- packages/shared/src/sandbox/git-freshness.ts
- packages/shared/src/sandbox/opencode.ts
- packages/shared/src/sandbox/version-key.ts
- packages/shared/src/snapshot-resolution.ts
- packages/sandbox-mcp/src/index.ts (entry point)
- packages/sandbox-mcp/src/api-server.ts (HTTP API)
- packages/sandbox-mcp/src/terminal.ts (terminal WebSocket)
- packages/sandbox-mcp/src/service-manager.ts (service start/stop/expose)
- packages/sandbox-mcp/src/auth.ts
- packages/sandbox-mcp/src/proliferate-cli.ts
- packages/modal-sandbox/deploy.py (Modal image)

RULES:
- Document what is in main today, not aspirational design
- Cite file paths as evidence for every behavioral claim
- Link to other specs for out-of-scope concepts (see boundary brief §4)
- Use only terms from the canonical glossary (see boundary brief §3)
- Target 300-600 lines
- Classify every feature as Implemented/Partial/Planned/Deprecated
```

---

## Phase 2 (run after phase 1 specs exist)

### 3. Sessions & Gateway

```
You are writing a system spec for the Proliferate codebase.

READ THESE FILES FIRST (in order):
1. docs/specs/boundary-brief.md — boundary rules and glossary (MANDATORY)
2. docs/specs/template.md — spec template (follow exactly)
3. docs/specs/feature-registry.md — section 3 (Sessions & Gateway features)
4. docs/specs/agent-contract.md — cross-reference for tool contracts
5. docs/specs/sandbox-providers.md — cross-reference for provider interface

YOUR ASSIGNMENT:
- Spec file: docs/specs/sessions-gateway.md
- In scope:
  - Session lifecycle: create, pause, resume, snapshot, delete, rename
  - Session state machine and status transitions
  - Gateway hub manager, session hub, session runtime
  - Event processor (sandbox SSE → client WebSocket)
  - SSE bridge to sandbox OpenCode
  - WebSocket streaming (client ↔ gateway)
  - HTTP message/status/cancel routes
  - Session migration controller (expiry, idle)
  - Preview/sharing URLs
  - Port forwarding proxy (gateway → sandbox)
  - Git operations (gateway-side)
  - Session store (in-memory state)
  - Session connections (DB)
  - Gateway middleware (auth, CORS, error handling, request logging)
  - Gateway client libraries (packages/gateway-clients)
- Out of scope:
  - Sandbox boot mechanics and provider interface (sandbox-providers.md)
  - Tool schemas and prompt modes (agent-contract.md)
  - Automation-initiated sessions (automations-runs.md owns the run lifecycle)
  - Repo/configuration resolution (repos-prebuilds.md)
  - LLM key generation (llm-proxy.md)
  - Billing gating for session creation (billing-metering.md)

KEY FILES TO READ:
- apps/web/src/server/routers/sessions.ts
- apps/gateway/src/lib/session-creator.ts
- apps/gateway/src/lib/session-store.ts
- apps/gateway/src/hub/hub-manager.ts
- apps/gateway/src/hub/session-hub.ts
- apps/gateway/src/hub/session-runtime.ts
- apps/gateway/src/hub/event-processor.ts
- apps/gateway/src/hub/sse-client.ts
- apps/gateway/src/hub/migration-controller.ts
- apps/gateway/src/hub/index.ts
- apps/gateway/src/api/proliferate/http/sessions.ts
- apps/gateway/src/api/proliferate/ws/
- apps/gateway/src/api/proxy/opencode.ts
- apps/gateway/src/hub/git-operations.ts
- apps/gateway/src/middleware/auth.ts
- packages/gateway-clients/
- packages/db/src/schema/sessions.ts

RULES:
- Document what is in main today, not aspirational design
- Cite file paths as evidence for every behavioral claim
- Link to other specs for out-of-scope concepts (see boundary brief §4)
- Use only terms from the canonical glossary (see boundary brief §3)
- Target 300-600 lines
- Classify every feature as Implemented/Partial/Planned/Deprecated
```

### 4. Automations & Runs

```
You are writing a system spec for the Proliferate codebase.

READ THESE FILES FIRST (in order):
1. docs/specs/boundary-brief.md — boundary rules and glossary (MANDATORY)
2. docs/specs/template.md — spec template (follow exactly)
3. docs/specs/feature-registry.md — section 4 (Automations & Runs features)
4. docs/specs/agent-contract.md — cross-reference for automation.complete tool
5. docs/specs/sandbox-providers.md — cross-reference for sandbox boot

YOUR ASSIGNMENT:
- Spec file: docs/specs/automations-runs.md
- In scope:
  - Automation CRUD and configuration
  - Automation connections (integration bindings)
  - Run lifecycle state machine: pending → enriching → executing → completed/failed
  - Run pipeline: enrich → execute → finalize
  - Enrichment worker (context extraction)
  - Execution (session creation for runs)
  - Finalization (post-execution cleanup)
  - Run events log
  - Outbox dispatch (atomic claim, stuck-row recovery)
  - Side effects tracking
  - Artifact storage (S3 — completion + enrichment artifacts)
  - Target resolution (which repo/configuration to use)
  - Notification dispatch (Slack)
  - Slack async client (bidirectional session via Slack)
  - Slack inbound handlers (text, todo, verify, default-tool)
  - Slack receiver worker
  - Run claiming / manual update
  - Schedule binding on automations
- Out of scope:
  - Trigger ingestion and matching (triggers.md — handoff point is AUTOMATION_ENRICH queue)
  - Tool schemas (agent-contract.md)
  - Session runtime mechanics (sessions-gateway.md)
  - Sandbox boot (sandbox-providers.md)
  - Slack OAuth and installation (integrations.md)
  - Schedule CRUD (triggers.md or standalone — schedules are shared)
  - Billing/metering for automation runs (billing-metering.md)

KEY FILES TO READ:
- apps/web/src/server/routers/automations.ts
- apps/worker/src/automation/index.ts (orchestrator)
- apps/worker/src/automation/enrich.ts
- apps/worker/src/automation/finalizer.ts
- apps/worker/src/automation/resolve-target.ts
- apps/worker/src/automation/artifacts.ts
- apps/worker/src/automation/outbox-dispatch.ts
- apps/worker/src/automation/notifications.ts
- apps/worker/src/automation/notifications-dispatch.ts
- apps/worker/src/slack/client.ts
- apps/worker/src/slack/handlers/
- apps/worker/src/slack/index.ts
- packages/services/src/automations/
- packages/services/src/runs/
- packages/services/src/outbox/service.ts
- packages/services/src/side-effects/
- packages/services/src/notifications/
- packages/db/src/schema/automations.ts

RULES:
- Document what is in main today, not aspirational design
- Cite file paths as evidence for every behavioral claim
- Link to other specs for out-of-scope concepts (see boundary brief §4)
- Use only terms from the canonical glossary (see boundary brief §3)
- Target 300-600 lines
- Classify every feature as Implemented/Partial/Planned/Deprecated
```

### 5. Triggers

```
You are writing a system spec for the Proliferate codebase.

READ THESE FILES FIRST (in order):
1. docs/specs/boundary-brief.md — boundary rules and glossary (MANDATORY)
2. docs/specs/template.md — spec template (follow exactly)
3. docs/specs/feature-registry.md — section 5 (Triggers features)

YOUR ASSIGNMENT:
- Spec file: docs/specs/triggers.md
- In scope:
  - Trigger CRUD (web routes)
  - Trigger events log and trigger event actions
  - Trigger service (apps/trigger-service — dedicated Express app)
  - Webhook ingestion via Nango
  - Webhook dispatch and matching (event → trigger)
  - Polling scheduler (cursor-based, Redis state)
  - Cron scheduling (SCHEDULED queue)
  - Provider registry
  - GitHub provider (webhook)
  - Linear provider (webhook + polling)
  - Sentry provider (webhook + polling)
  - PostHog provider (webhook, HMAC validation)
  - Gmail provider (stub/planned)
  - PubSub session events subscriber
  - Schedule CRUD (get/update/delete)
  - Handoff to automations (enqueue AUTOMATION_ENRICH)
- Out of scope:
  - Automation run pipeline after handoff (automations-runs.md)
  - Integration OAuth setup (integrations.md)
  - Session lifecycle (sessions-gateway.md)

KEY FILES TO READ:
- apps/web/src/server/routers/triggers.ts
- apps/web/src/server/routers/schedules.ts
- apps/trigger-service/src/ (all files — dedicated service)
- apps/trigger-service/src/lib/webhook-dispatcher.ts
- apps/trigger-service/src/lib/trigger-processor.ts
- apps/trigger-service/src/polling/worker.ts
- packages/triggers/src/index.ts (registry)
- packages/triggers/src/github.ts
- packages/triggers/src/linear.ts
- packages/triggers/src/sentry.ts
- packages/triggers/src/posthog.ts
- packages/triggers/src/types.ts
- packages/triggers/src/adapters/gmail.ts
- packages/services/src/triggers/
- packages/services/src/schedules/
- packages/db/src/schema/triggers.ts
- packages/db/src/schema/schedules.ts
- apps/worker/src/pubsub/

RULES:
- Document what is in main today, not aspirational design
- Cite file paths as evidence for every behavioral claim
- Link to other specs for out-of-scope concepts (see boundary brief §4)
- Use only terms from the canonical glossary (see boundary brief §3)
- Target 300-600 lines
- Classify every feature as Implemented/Partial/Planned/Deprecated
```

### 6. Actions

```
You are writing a system spec for the Proliferate codebase.

READ THESE FILES FIRST (in order):
1. docs/specs/boundary-brief.md — boundary rules and glossary (MANDATORY)
2. docs/specs/template.md — spec template (follow exactly)
3. docs/specs/feature-registry.md — section 6 (Actions features)
4. docs/specs/agent-contract.md — cross-reference for tool injection

YOUR ASSIGNMENT:
- Spec file: docs/specs/actions.md
- In scope:
  - Action invocation lifecycle: pending → approved/denied → expired
  - Risk classification: read / write / danger
  - Grant system: create, evaluate, revoke, call budgets
  - Gateway action routes (invoke, approve, deny, list, grants)
  - Provider guide/bootstrap flow
  - Linear adapter
  - Sentry adapter
  - Invocation sweeper (expiry job)
  - Sandbox-MCP grants handler
  - Actions list (org-level inbox)
- Out of scope:
  - Tool schema definitions (agent-contract.md)
  - Session runtime (sessions-gateway.md)
  - Integration OAuth for Linear/Sentry (integrations.md)
  - Automation runs that invoke actions (automations-runs.md)

KEY FILES TO READ:
- apps/web/src/server/routers/actions.ts
- packages/services/src/actions/ (all files)
- packages/services/src/actions/grants.ts
- packages/services/src/actions/db.ts
- packages/services/src/actions/adapters/linear.ts
- packages/services/src/actions/adapters/sentry.ts
- apps/gateway/src/api/proliferate/http/ (action routes)
- apps/gateway/src/hub/capabilities/tools/ (action tool implementations)
- apps/worker/src/sweepers/index.ts
- packages/sandbox-mcp/src/actions-grants.ts
- packages/db/src/schema/ (look for action_invocations, action_grants tables)

RULES:
- Document what is in main today, not aspirational design
- Cite file paths as evidence for every behavioral claim
- Link to other specs for out-of-scope concepts (see boundary brief §4)
- Use only terms from the canonical glossary (see boundary brief §3)
- Target 300-600 lines
- Classify every feature as Implemented/Partial/Planned/Deprecated
```

### 7. LLM Proxy

```
You are writing a system spec for the Proliferate codebase.

READ THESE FILES FIRST (in order):
1. docs/specs/boundary-brief.md — boundary rules and glossary (MANDATORY)
2. docs/specs/template.md — spec template (follow exactly)
3. docs/specs/feature-registry.md — section 7 (LLM Proxy features)

YOUR ASSIGNMENT:
- Spec file: docs/specs/llm-proxy.md
- In scope:
  - Virtual key generation (per-session, per-org)
  - Key scoping model (team = org, user = session)
  - Key duration and lifecycle
  - LiteLLM API integration contract
  - Spend tracking and spend query APIs
  - LLM spend cursors (DB sync state)
  - Environment config (LLM_PROXY_URL, LLM_PROXY_MASTER_KEY, LLM_PROXY_KEY_DURATION)
  - How providers (Modal, E2B) pass the virtual key to sandboxes
- Out of scope:
  - LiteLLM service internals (external dependency, not our code)
  - Billing policy / credit gating / charging (billing-metering.md)
  - Sandbox boot mechanics (sandbox-providers.md)
  - Session lifecycle (sessions-gateway.md)

NOTE: The LLM proxy is an external LiteLLM service. This spec documents our integration contract with it, not the service itself. `apps/llm-proxy/` contains the Dockerfile and LiteLLM config.yaml for deploying the proxy.

KEY FILES TO READ:
- packages/shared/src/llm-proxy.ts (main integration)
- packages/environment/src/schema.ts (env var definitions — search for LLM_PROXY)
- packages/db/src/schema/billing.ts (llmSpendCursors table)
- packages/shared/src/providers/modal-libmodal.ts (how Modal passes LLM key)
- packages/shared/src/providers/e2b.ts (how E2B passes LLM key)
- packages/shared/src/sandbox/config.ts (env injection)

RULES:
- Document what is in main today, not aspirational design
- Cite file paths as evidence for every behavioral claim
- Link to other specs for out-of-scope concepts (see boundary brief §4)
- Use only terms from the canonical glossary (see boundary brief §3)
- This spec will likely be shorter than others (200-350 lines) given the scope is an integration contract
- Classify every feature as Implemented/Partial/Planned/Deprecated
```

### 8. CLI

```
You are writing a system spec for the Proliferate codebase.

READ THESE FILES FIRST (in order):
1. docs/specs/boundary-brief.md — boundary rules and glossary (MANDATORY)
2. docs/specs/template.md — spec template (follow exactly)
3. docs/specs/feature-registry.md — section 8 (CLI features)

YOUR ASSIGNMENT:
- Spec file: docs/specs/cli.md
- In scope:
  - CLI entry point and main flow
  - Device auth flow (OAuth device code → token persistence)
  - Local config management (.proliferate/ directory)
  - File sync (unidirectional: local → sandbox via rsync)
  - OpenCode launch
  - CLI-specific API routes (auth, repos, sessions, SSH keys, GitHub, configurations)
  - GitHub repo selection history
  - SSH key storage and management
  - CLI package structure and build
- Out of scope:
  - Session lifecycle after creation (sessions-gateway.md)
  - Sandbox boot (sandbox-providers.md)
  - Repo/configuration management beyond CLI-specific routes (repos-prebuilds.md)
  - Auth system internals / better-auth (auth-orgs.md)

KEY FILES TO READ:
- packages/cli/src/main.ts (entry point)
- packages/cli/src/state/auth.ts (device flow)
- packages/cli/src/state/config.ts (local config)
- packages/cli/src/lib/sync.ts (file sync)
- packages/cli/src/agents/opencode.ts (OpenCode launch)
- apps/web/src/server/routers/cli.ts (all CLI API routes)
- packages/db/src/schema/cli.ts (SSH keys, device codes, GitHub selections)
- packages/services/src/cli/

RULES:
- Document what is in main today, not aspirational design
- Cite file paths as evidence for every behavioral claim
- Link to other specs for out-of-scope concepts (see boundary brief §4)
- Use only terms from the canonical glossary (see boundary brief §3)
- Target 300-600 lines
- Classify every feature as Implemented/Partial/Planned/Deprecated
```

---

## Phase 3 (run after phase 2 specs exist)

### 9. Repos & Configurations

```
You are writing a system spec for the Proliferate codebase.

READ THESE FILES FIRST (in order):
1. docs/specs/boundary-brief.md — boundary rules and glossary (MANDATORY)
2. docs/specs/template.md — spec template (follow exactly)
3. docs/specs/feature-registry.md — section 9 (Repos/Configurations features)
4. docs/specs/sandbox-providers.md — cross-reference for snapshot resolution
5. docs/specs/sessions-gateway.md — cross-reference for configuration resolver

YOUR ASSIGNMENT:
- Spec file: docs/specs/repos-prebuilds.md
- In scope:
  - Repo CRUD and search
  - Repo connections (integration bindings)
  - Configuration CRUD
  - Configuration-repo associations (many-to-many)
  - Effective service commands resolution
  - Base snapshot build worker (queue, deduplication, status tracking)
  - Configuration resolver (resolves config at session start)
  - Service commands persistence (JSONB)
  - Configuration secret files
  - Base snapshot status tracking (building/ready/failed)
- Out of scope:
  - Snapshot resolution logic (sandbox-providers.md)
  - Session creation that uses configurations (sessions-gateway.md)
  - Secret values and bundles (secrets-environment.md)
  - Integration OAuth (integrations.md)

KEY FILES TO READ:
- apps/web/src/server/routers/repos.ts
- apps/web/src/server/routers/configurations.ts
- apps/worker/src/base-snapshots/index.ts
- apps/gateway/src/lib/configuration-resolver.ts
- packages/services/src/repos/
- packages/services/src/configurations/
- packages/services/src/base-snapshots/
- packages/db/src/schema/repos.ts
- packages/db/src/schema/schema.ts

RULES:
- Document what is in main today, not aspirational design
- Cite file paths as evidence for every behavioral claim
- Link to other specs for out-of-scope concepts (see boundary brief §4)
- Use only terms from the canonical glossary (see boundary brief §3)
- Target 300-600 lines
- Classify every feature as Implemented/Partial/Planned/Deprecated
```

### 10. Secrets & Environment

```
You are writing a system spec for the Proliferate codebase.

READ THESE FILES FIRST (in order):
1. docs/specs/boundary-brief.md — boundary rules and glossary (MANDATORY)
2. docs/specs/template.md — spec template (follow exactly)
3. docs/specs/feature-registry.md — section 10 (Secrets features)

YOUR ASSIGNMENT:
- Spec file: docs/specs/secrets-environment.md
- In scope:
  - Secret CRUD (create, delete, list, check)
  - Secret bundles CRUD (list, create, update meta, delete)
  - Bundle target path configuration
  - Bulk import (.env paste flow)
  - Secret encryption at rest
  - Per-secret persistence toggle
  - S3 integration for secret storage
  - How secrets flow from DB → gateway → sandbox (the data path, not the tool schema)
- Out of scope:
  - Secret file management (configurations-snapshots.md)
  - The request_env_variables tool schema (agent-contract.md)
  - Sandbox env var injection mechanics (sandbox-providers.md)
  - Configuration secret files (repos-prebuilds.md)

KEY FILES TO READ:
- apps/web/src/server/routers/secrets.ts
- packages/services/src/secrets/
- packages/db/src/schema/secrets.ts (look for secrets, secret_bundles tables)
- apps/gateway/src/lib/s3.ts
- apps/gateway/src/hub/capabilities/tools/save-env-files.ts (read for data flow understanding, but tool schema is agent-contract.md's scope)

RULES:
- Document what is in main today, not aspirational design
- Cite file paths as evidence for every behavioral claim
- Link to other specs for out-of-scope concepts (see boundary brief §4)
- Use only terms from the canonical glossary (see boundary brief §3)
- Target 300-600 lines
- Classify every feature as Implemented/Partial/Planned/Deprecated
```

### 11. Integrations

```
You are writing a system spec for the Proliferate codebase.

READ THESE FILES FIRST (in order):
1. docs/specs/boundary-brief.md — boundary rules and glossary (MANDATORY)
2. docs/specs/template.md — spec template (follow exactly)
3. docs/specs/feature-registry.md — section 11 (Integrations features)

YOUR ASSIGNMENT:
- Spec file: docs/specs/integrations.md
- In scope:
  - Integration list and update
  - GitHub OAuth (GitHub App via Nango)
  - Sentry OAuth (via Nango)
  - Linear OAuth (via Nango)
  - Slack OAuth (via Nango)
  - Nango callback handling
  - Integration disconnect
  - Slack installations (workspace-level)
  - Slack conversations cache
  - Connection binding to repos, automations, sessions
  - Sentry metadata queries
  - Linear metadata queries
  - GitHub auth (gateway-side token resolution)
- Out of scope:
  - What repos/automations/sessions DO with connections (those specs own runtime behavior)
  - Slack async client and message handling (automations-runs.md)
  - Action adapters for Linear/Sentry (actions.md)
  - Trigger providers for GitHub/Linear/Sentry (triggers.md)

KEY FILES TO READ:
- apps/web/src/server/routers/integrations.ts
- packages/services/src/integrations/
- packages/db/src/schema/integrations.ts (if exists, or look in main schema)
- packages/db/src/schema/slack.ts
- apps/gateway/src/lib/github-auth.ts
- apps/web/src/lib/nango.ts
- apps/web/src/lib/slack.ts
- packages/shared/src/contracts/integrations.ts

RULES:
- Document what is in main today, not aspirational design
- Cite file paths as evidence for every behavioral claim
- Link to other specs for out-of-scope concepts (see boundary brief §4)
- Use only terms from the canonical glossary (see boundary brief §3)
- Target 300-600 lines
- Classify every feature as Implemented/Partial/Planned/Deprecated
```

### 12. Auth, Orgs & Onboarding

```
You are writing a system spec for the Proliferate codebase.

READ THESE FILES FIRST (in order):
1. docs/specs/boundary-brief.md — boundary rules and glossary (MANDATORY)
2. docs/specs/template.md — spec template (follow exactly)
3. docs/specs/feature-registry.md — section 12 (Auth/Orgs features)

YOUR ASSIGNMENT:
- Spec file: docs/specs/auth-orgs.md
- In scope:
  - User auth via better-auth (email/password + OAuth)
  - Email verification flow
  - Org CRUD and org model
  - Member management
  - Invitation system (create, accept, expiry)
  - Domain suggestions (email-based org matching)
  - Onboarding flow (start trial, mark complete, finalize)
  - Trial activation (credit provisioning trigger — the trigger, not the billing logic)
  - API keys
  - Admin status check
  - Admin user/org listing
  - Admin impersonation (cookie management, super-admin checks)
  - Org switching
- Out of scope:
  - Trial credit amounts and billing policy (billing-metering.md)
  - Gateway auth middleware implementation (sessions-gateway.md)
  - CLI device auth flow (cli.md)
  - Integration OAuth (integrations.md)

KEY FILES TO READ:
- packages/shared/src/auth.ts
- packages/shared/src/verification.ts
- apps/web/src/server/routers/orgs.ts
- apps/web/src/server/routers/onboarding.ts
- apps/web/src/server/routers/admin.ts
- packages/services/src/orgs/
- packages/services/src/onboarding/
- packages/services/src/admin/
- packages/db/src/schema/auth.ts
- apps/web/src/app/invite/[id]/page.tsx (invitation acceptance — read for flow, don't document UI)

RULES:
- Document what is in main today, not aspirational design
- Cite file paths as evidence for every behavioral claim
- Link to other specs for out-of-scope concepts (see boundary brief §4)
- Use only terms from the canonical glossary (see boundary brief §3)
- Target 300-600 lines
- Classify every feature as Implemented/Partial/Planned/Deprecated
```

### 13. Billing & Metering

```
You are writing a system spec for the Proliferate codebase.

READ THESE FILES FIRST (in order):
1. docs/specs/boundary-brief.md — boundary rules and glossary (MANDATORY)
2. docs/specs/template.md — spec template (follow exactly)
3. docs/specs/feature-registry.md — section 13 (Billing features)

YOUR ASSIGNMENT:
- Spec file: docs/specs/billing-metering.md
- In scope:
  - Billing status, current plan, pricing plans
  - Billing settings update
  - Checkout flow (initiate payment)
  - Credit usage / deduction
  - Usage metering (real-time compute credit calculation)
  - Credit gating (gate features on balance)
  - Shadow balance (fast balance approximation)
  - Org pause on zero balance (auto-pause all sessions)
  - Trial credit provisioning
  - Billing reconciliation (manual adjustments with audit trail)
  - Billing events log
  - LLM spend sync (from LiteLLM via spend cursors)
  - Distributed locks for billing operations
  - Billing worker (interval-based reconciliation)
  - Autumn integration (external billing provider)
  - Overage policy (pause vs allow, per-org)
- Out of scope:
  - LLM virtual key generation (llm-proxy.md)
  - Onboarding flow that triggers trial activation (auth-orgs.md)
  - Session pause/terminate mechanics (sessions-gateway.md)

KEY FILES TO READ:
- apps/web/src/server/routers/billing.ts
- packages/services/src/billing/ (all files)
- packages/services/src/billing/metering.ts
- packages/services/src/billing/shadow-balance.ts
- packages/services/src/billing/org-pause.ts
- packages/services/src/billing/trial-activation.ts
- packages/shared/src/billing/ (Autumn client, gating, distributed locks)
- packages/db/src/schema/billing.ts
- apps/worker/src/billing/worker.ts
- apps/worker/src/billing/index.ts

RULES:
- Document what is in main today, not aspirational design
- Cite file paths as evidence for every behavioral claim
- Link to other specs for out-of-scope concepts (see boundary brief §4)
- Use only terms from the canonical glossary (see boundary brief §3)
- Target 300-600 lines
- Classify every feature as Implemented/Partial/Planned/Deprecated
```

---

## Phase 4 — Consistency Check

```
You are performing a consistency review of 13 system specs for the Proliferate codebase.

READ THESE FILES FIRST:
1. docs/specs/boundary-brief.md — the boundary rules and glossary
2. All 13 spec files in docs/specs/

CHECK FOR:
1. Overlapping ownership — two specs claiming the same file or DB table. Every file should belong to exactly one spec.
2. Contradictory statements — spec A says X, spec B says not-X.
3. Broken cross-references — "see sessions-gateway.md §6.2" pointing to a section that doesn't exist.
4. Glossary violations — terms used inconsistently (e.g., "environment" instead of "sandbox").
5. Missing cross-references — spec describes something owned by another spec without linking to it.
6. Depth imbalance — specs that are suspiciously short or long relative to their scope.
7. Status disagreements — feature-registry.md says Implemented but a spec says Partial (or vice versa).

OUTPUT:
- A checklist of issues found, grouped by spec file
- For each issue: what's wrong, which specs are involved, suggested fix
- Write the results to docs/specs/consistency-review.md
```
