# Agent Platform V1 (Centralized)

> Generated via bash from `README.md` + numbered subsystem specs.

---

<!-- Source: README.md -->

# Agent Platform V1 Specs (E2B-First)

## Why this folder exists
These docs define a concrete, plain-language V1 implementation plan for Proliferate.

This folder is intentionally practical:
- What users can do end to end
- What we are building now (E2B-first)
- Where code should live in this repo
- What "done" means for each subsystem
- Which files and DB models each subsystem owns

## V1 product shape
V1 has two main experiences:
1. **Interactive coding runs**: user asks agent to fix/build something now
2. **Persistent background agents**: agent keeps watching a job (for example Sentry), spawns worker runs, and reports progress

## Out of scope for this spec pack
- Building a custom proprietary compute orchestrator
- Non-engineering workflows (email support automation, generic business agents)
- Deep visual no-code workflow builder

## File tree (this spec pack)
```text
/docs/specs/agent-platform-v1/
  README.md
  00-system-file-tree.md
  01-required-functionality-and-ux.md
  02-e2b-interface-and-usage.md
  03-action-registry-and-org-usage.md
  04-long-running-agents.md
  05-trigger-services.md
  06-gateway-functionality.md
  07-cloud-billing.md
  08-coding-agent-harnesses.md
  09-notifications.md
  10-layering-and-mapping-rules.md
  11-streaming-preview-transport-v2.md
  12-reference-index-files-and-models.md
  13-self-hosting-and-updates.md
  14-boot-snapshot-contract.md
  15-llm-proxy-architecture.md
```

## Spec reading order
1. [00-system-file-tree.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/00-system-file-tree.md)
2. [01-required-functionality-and-ux.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/01-required-functionality-and-ux.md)
3. [06-gateway-functionality.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/06-gateway-functionality.md)
4. [02-e2b-interface-and-usage.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/02-e2b-interface-and-usage.md)
5. [03-action-registry-and-org-usage.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/03-action-registry-and-org-usage.md)
6. [04-long-running-agents.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/04-long-running-agents.md)
7. [05-trigger-services.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/05-trigger-services.md)
8. [08-coding-agent-harnesses.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/08-coding-agent-harnesses.md)
9. [09-notifications.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/09-notifications.md)
10. [07-cloud-billing.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/07-cloud-billing.md)
11. [10-layering-and-mapping-rules.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/10-layering-and-mapping-rules.md)
12. [11-streaming-preview-transport-v2.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/11-streaming-preview-transport-v2.md)
13. [12-reference-index-files-and-models.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/12-reference-index-files-and-models.md)
14. [13-self-hosting-and-updates.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/13-self-hosting-and-updates.md)
15. [14-boot-snapshot-contract.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/14-boot-snapshot-contract.md)
16. [15-llm-proxy-architecture.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/15-llm-proxy-architecture.md)

## Source references in current repo
These docs align with existing architecture and code:
- [sessions-gateway.md](/Users/pablo/proliferate/docs/specs/sessions-gateway.md)
- [sandbox-providers.md](/Users/pablo/proliferate/docs/specs/sandbox-providers.md)
- [actions.md](/Users/pablo/proliferate/docs/specs/actions.md)
- [triggers.md](/Users/pablo/proliferate/docs/specs/triggers.md)
- [billing-metering.md](/Users/pablo/proliferate/docs/specs/billing-metering.md)
- [agent-entity-design.md](/Users/pablo/proliferate/docs/agent-entity-design.md)

## V1 principles
- Gateway is the runtime action bus and policy checkpoint
- E2B is compute provider for V1 only
- DB-first UI for reliability, stream attach for live detail
- No privileged direct provider calls from sandbox
- Sandbox-native git operations use short-lived repo-scoped auth
- PR ownership mode defaults to `sandbox_pr` (future strict mode: `gateway_pr`)
- Keep harness pluggable (OpenCode default, others possible)
- Manager cognition runs in lean sandbox, not control-plane process
- Default idle timeout is `10m` (normal idle + approval-wait idle)
- Deployment support includes cloud, Docker self-host, and Kubernetes self-host
- Every subsystem spec should include implementation file tree + core data model section


---

<!-- Source: 00-system-file-tree.md -->

# System File Tree (V1)

This is the practical code map for the V1 agent platform.

## Top-level runtime systems
```text
/apps
  /web                 # Product UI + oRPC routes (metadata CRUD)
  /gateway             # Real-time runtime bus + action execution boundary
  /llm-proxy           # LiteLLM proxy service (virtual keys + provider routing)
  /worker              # Background jobs and orchestration
  /trigger-service     # Webhook ingestion and trigger processing

/packages
  /db                  # Schema and migrations
  /services            # Business logic + DB operations
  /shared              # Contracts, sandbox provider impls, opencode tooling
  /triggers            # Trigger provider registry + adapters
  /queue               # Queue wrappers/locking
  /gateway-clients     # Client libs used by web/worker

/charts
  /proliferate         # Self-host deployment chart

/infra
  /pulumi-k8s          # AWS EKS deployment IaC
  /pulumi-k8s-gcp      # GKE deployment IaC
```

## Key folders for each concern

### 1) Product UX and APIs
```text
/apps/web/src/server/routers
  actions.ts
  automations.ts
  billing.ts
  integrations.ts
  sessions.ts
  triggers.ts
```

### 2) Gateway runtime/action bus
```text
/apps/gateway/src
  /api/proliferate/http
    actions.ts
    sessions.ts
    tools.ts
  /hub
    session-hub.ts
    session-runtime.ts
    event-processor.ts
    migration-controller.ts
```

### 3) Trigger ingestion
```text
/apps/trigger-service/src
  /api
    webhooks.ts
    providers.ts
  /webhook-inbox
    worker.ts
  /polling
    worker.ts
```

### 4) Background orchestration
```text
/apps/worker/src/automation
  index.ts
  resolve-target.ts
  notifications.ts
  finalizer.ts
```

### 5) Policies, actions, credentials
```text
/packages/services/src
  /actions
    service.ts
    modes.ts
    modes-db.ts
    connectors/
  /integrations
    service.ts
    db.ts
    tokens.ts
  /notifications
    service.ts
    db.ts
  /outbox
    service.ts
```

### 6) Sandbox provider (E2B now)
```text
/packages/shared/src/providers
  e2b.ts               # V1 execution provider
  index.ts             # provider factory

/packages/shared/src/sandbox
  opencode.ts
  config.ts
  git-freshness.ts
```

### 7) Contracts and tool packs
```text
/packages/shared/src/contracts
/packages/shared/src/opencode-tools
  index.ts
```

### 8) Core data model
```text
/packages/db/src/schema
  schema.ts
  integrations.ts
  relations.ts
/packages/db/drizzle
  *.sql
```

## Planned additions for this spec pack
These are expected near-term additions, still inside existing structure:
```text
/ packages/services/src/credentials
  broker.ts
  access.ts
  types.ts
  providers/
```

## Rules for file ownership
- DB read/write logic belongs in `packages/services/src/**/db.ts`
- Gateway should call services, not raw DB SQL
- Web routers are thin wrappers around services/gateway clients
- Trigger-service should ingest and enqueue, not execute agent work inline
- Route handlers must not import Drizzle schema/client directly
- Mapping logic belongs in mapper modules, not routers

See: [10-layering-and-mapping-rules.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/10-layering-and-mapping-rules.md)

## Feature-to-system ownership map

| Product capability | Primary runtime owner | Primary files |
|---|---|---|
| Coworker creation/editing | Web + Services | `apps/web/src/server/routers/automations.ts`, `packages/services/src/automations/service.ts` |
| Long-running execution | Worker + Services | `apps/worker/src/automation/*`, `packages/services/src/runs/service.ts` |
| Trigger ingestion (webhook/polling) | Trigger-service | `apps/trigger-service/src/api/webhooks.ts`, `apps/trigger-service/src/polling/worker.ts` |
| Coding sessions + live runtime | Gateway + Providers | `apps/gateway/src/hub/session-runtime.ts`, `packages/shared/src/providers/e2b.ts` |
| Actions/approvals | Gateway + Actions service | `apps/gateway/src/api/proliferate/http/actions.ts`, `packages/services/src/actions/service.ts` |
| Integrations (OAuth + connectors) | Web + Integrations/Connectors services | `apps/web/src/server/routers/integrations.ts`, `packages/services/src/integrations/service.ts`, `packages/services/src/connectors/service.ts` |
| Notifications | Worker + Notifications service | `apps/worker/src/automation/notifications.ts`, `packages/services/src/notifications/service.ts` |
| Billing/metering | Web + Worker + Billing service | `apps/web/src/server/routers/billing.ts`, `apps/worker/src/billing/*`, `packages/services/src/billing/*` |
| LLM proxy runtime + key mgmt | LLM Proxy + Shared + Billing worker | `apps/llm-proxy/*`, `packages/shared/src/llm-proxy.ts`, `apps/worker/src/jobs/billing/llm-sync-*` |

## Core data model map (minimum to understand system behavior)

| Table/model | Purpose | Schema file |
|---|---|---|
| `sessions` | Runtime session state for coding/setup/automation-linked work | `packages/db/src/schema/sessions.ts` |
| `automations` | Long-running coworker definitions, prompts, notification destination | `packages/db/src/schema/automations.ts` |
| `triggers`, `trigger_events` | Trigger definitions + durable trigger event pipeline | `packages/db/src/schema/triggers.ts` |
| `integrations`, `repo_connections` | OAuth/GitHub-App integration records and repo bindings | `packages/db/src/schema/integrations.ts` |
| `action_invocations` | Side-effect execution audit and approval state | `packages/db/src/schema/schema.ts` (`actionInvocations`) |
| `org_connectors` | Org-scoped MCP connector catalog/config | `packages/db/src/schema/schema.ts` (`orgConnectors`) |
| `outbox` | Durable async dispatch queue for notifications/side effects | `packages/db/src/schema/schema.ts` (`outbox`) |
| `session_notification_subscriptions` | Per-session notification preferences and delivery state | `packages/db/src/schema/slack.ts` |
| `billing_events`, `billing_reconciliations` | Usage ledger + billing correction trail | `packages/db/src/schema/billing.ts` |

## Engineering guardrails (general best practices)

### File size limits (targets, not hard compiler limits)
- Service files (`service.ts`, `db.ts`, routers): target under 400 lines
- Gateway hub/runtime files: target under 500 lines
- UI components: target under 300 lines
- Specs/docs: target under 500 lines each
- If a file crosses limits, split by subdomain before adding new features

### Function and module boundaries
- Prefer small single-purpose functions (target under 60 lines)
- Keep request parsing, business logic, and persistence separated
- Keep provider SDK calls behind provider/broker adapters

### Naming and structure
- Use explicit names (`runAs`, `credentialOwnerType`, `bootSnapshot`)
- Keep one module per domain responsibility (actions, credentials, notifications, etc.)
- Put shared contracts in `packages/shared/src/contracts`

### Reliability defaults
- DB-first for lists/inbox dashboards; stream only for live detail
- Use idempotency keys for side-effecting actions
- Use outbox pattern for async delivery and retries
- Persist status transitions instead of in-memory-only state

### Security defaults
- No privileged long-lived tokens in sandbox by default
- Short-lived repo-scoped git auth is allowed for sandbox coding sessions
- Gateway is the only side-effect execution boundary
- Run policy checks before token resolution and execution
- Log actor + run-as + credential owner on every invocation


---

<!-- Source: 01-required-functionality-and-ux.md -->

# Required Functionality End to End (Including UX)

## Goal
Ship a product where users can rely on Proliferate as a real coworker:
- Long-running coworkers that keep working in the background
- High-quality coding sessions with strong runtime visibility
- Broad integrations (org-wide and personal) with safe action execution
- Clean onboarding that gets teams productive fast

This spec is the practical bar for V1 plus near-term parity direction (Cursor/Lovable/Claude cowork-style behavior).

## Product bar (plain language)
Users should feel:
- "I can ask this coworker to do real work, not just chat."
- "I can check status from anywhere, especially the web dashboard."
- "I can safely connect tools and know who is acting with which credentials."
- "Coding runs are transparent: I can see terminal, changes, preview, and outcomes."

## Must-have workflows (end to end)

### A) Clean setup and onboarding
User flow:
1. Connect GitHub
2. Pick repo
3. Paste `.env.local` (development env) or select existing env bundle
4. Run setup/onboarding job that prepares workspace and snapshot
5. Connect tools/integrations needed for this coworker
6. Set communication preferences
7. Start first task

Acceptance:
- Setup is guided and understandable by non-platform engineers
- First useful run starts without manual infra steps
- Onboarding produces a reusable baseline snapshot/config for follow-up runs
- Docs include a one-liner start path and clear troubleshooting
- Development env values are stored as encrypted env bundles; `boot_snapshot` stores env references only
- Action/integration secrets are managed separately from `.env.local` bundles

### B) Create a coworker in chat-first style
User flow:
1. User opens "Create coworker"
2. Describes goal in plain English (for example "watch Sentry and fix regressions")
3. System proposes sources, actions, cadence, and safety mode
4. User confirms and saves
5. Coworker starts and posts first status update

Acceptance:
- User can create a useful coworker without editing JSON/YAML
- Coworker definition includes objective, sources, allowed actions, and schedule
- Coworker can spawn child coding runs when needed

### C) Long-running coworker lifecycle
User flow:
1. Coworker wakes from webhook/cron
2. Triages new work
3. Spawns child runs for concrete tasks
4. Reports progress and outcomes in its thread/channel
5. User asks "what did you finish today?" and gets a concrete answer

Acceptance:
- Repeated wake/sleep cycles work without manual intervention
- Parent/child runs are linked and inspectable
- User can pause/resume/cancel and update coworker objectives

### D) Coding session UX quality
Session must expose:
- Live terminal output
- Code changes and git diff
- Preview URL/app status
- Services/logs visibility
- Final PR/outcome summary

Acceptance:
- Session stream is responsive and reconnect-safe
- Final output always includes summary + links + failure reason (if failed)
- Visual proof artifact exists when UI/runtime behavior is part of the task

### E) Action safety and approvals
User flow:
1. Coworker requests side-effect action (for example comment, ticket update, deploy trigger)
2. System checks mode (`allow`, `require_approval`, `deny`)
3. If approval needed, inbox/slack notification is sent
4. Runtime is marked waiting and continues through standard idle lifecycle
5. Approver accepts or rejects
6. Coworker resumes with decision

Acceptance:
- Approvals are DB-backed and auditable
- Post-approval revalidation runs before delayed execution
- All invocations show actor, run-as identity, and credential owner
- Idle timeout defaults to `10m` for approval waits and normal inactivity

### F) Query from anywhere
Entry points:
- Web dashboard (primary)
- Slack/GitHub mentions (secondary)
- Later desktop client

Acceptance:
- User can ask status/questions and receive actionable links
- Dashboard works from durable DB state even during stream interruptions

## Integration model requirements (org-wide + personal)

### Org-wide connections
- Admins can connect org integrations (GitHub org bot, Sentry org project access, PostHog, analytics, shared MCP tools)
- Used by default for background coworkers

### Personal connections
- Users can connect personal tools/accounts
- Personal credentials are not silently reused for shared templates
- Sharing a coworker template prompts recipient to attach their own personal integration where required

### Actions page expectations
- One place to manage both org-wide and personal sources
- Clear badges for "Org" vs "Personal"
- Clear warnings before sharing coworkers that depend on personal integrations

## Implementation file references (current code anchors)

### UX and orchestration
- `apps/web/src/server/routers/automations.ts`
- `apps/web/src/server/routers/sessions.ts`
- `apps/web/src/server/routers/triggers.ts`
- `apps/worker/src/automation/index.ts`
- `apps/worker/src/automation/finalizer.ts`

### Runtime/coding sessions
- `apps/gateway/src/hub/session-hub.ts`
- `apps/gateway/src/hub/session-runtime.ts`
- `packages/shared/src/providers/e2b.ts`
- `packages/shared/src/sandbox/opencode.ts`

### Actions/integrations/approvals
- `apps/gateway/src/api/proliferate/http/actions.ts`
- `packages/services/src/actions/service.ts`
- `apps/web/src/server/routers/integrations.ts`
- `packages/services/src/integrations/service.ts`
- `packages/services/src/connectors/service.ts`

### Notifications and inbox
- `packages/services/src/notifications/service.ts`
- `apps/worker/src/automation/notifications.ts`
- `packages/services/src/outbox/service.ts`

## Key UX surfaces

### 1) Mission Control (org-level)
Shows:
- Active coworkers
- Running/failed/pending runs
- Approval queue
- Recent outcomes and links to PRs/issues

### 2) Coworker detail page
Shows:
- Objective, schedule, and source bindings
- Current status + last wake time
- Recent runs and spawned child runs
- Conversation/history ("what it did and why")

### 3) Session/run detail page
Shows:
- Live stream (terminal/events)
- Persisted timeline
- Tool/action outputs
- Git state, previews, logs, artifacts

### 4) Approval inbox
Shows:
- Pending action invocations
- Why action was requested
- Approve/deny controls
- Audit trail after decision

## Data model requirements (plain language)
Minimum durable records:
- Coworker/Agent
- Session
- Run (if separate)
- Action invocation
- Trigger event
- Inbox event
- Notification preference + channel target

Additional immutable runtime record:
- `boot_snapshot` on each session/run (prompt, model, grants, identity, env bundle references)

Why:
- Running work must not change behavior when live config edits happen
- Audit/replay must reflect exact allowed behavior at run start

Core tables that back this UX:
- `automations` (coworker identity, prompt, notification destination) — `packages/db/src/schema/automations.ts`
- `sessions` (interactive/child run state, runtime metadata) — `packages/db/src/schema/sessions.ts`
- `triggers` + `trigger_events` (wake pipeline, dedup, processing status) — `packages/db/src/schema/triggers.ts`
- `integrations` + `org_connectors` (OAuth and MCP source access) — `packages/db/src/schema/integrations.ts`, `packages/db/src/schema/schema.ts`
- `action_invocations` (approval and side-effect audit) — `packages/db/src/schema/schema.ts`
- `outbox` + `session_notification_subscriptions` (delivery and subscriber preferences) — `packages/db/src/schema/schema.ts`, `packages/db/src/schema/slack.ts`

## Non-goals (for V1)
- Full no-code workflow builder
- Arbitrary business-process automation marketplace
- Fully autonomous deploy/merge with zero guardrails

## Definition of done checklist
- [ ] Setup flow works from repo connect to first successful run
- [ ] Coworker can be created conversationally and run on schedule
- [ ] Persistent coworker wakes repeatedly and can spawn child runs
- [ ] Org + personal integration model is visible and safe
- [ ] Approval queue gates risky actions with auditability
- [ ] Dashboard is DB-first and resilient; detail views stream live state
- [ ] Session/run stores immutable `boot_snapshot` at creation time
- [ ] Coding runs publish visual proof artifact when task requires it


---

<!-- Source: 02-e2b-interface-and-usage.md -->

# E2B Interface and Usage Pattern (V1)

## Goal
Use E2B as the only execution provider in V1, while keeping code structured so we can add Docker/K8s later without rewriting control-plane logic.

## Hard boundary
- Control plane decides **when** to run
- E2B provider decides **how** to start/stop/exec in sandbox
- Business logic must not call E2B SDK directly outside provider layer

Primary code path today:
- [e2b.ts](/Users/pablo/proliferate/packages/shared/src/providers/e2b.ts)
- [providers/index.ts](/Users/pablo/proliferate/packages/shared/src/providers/index.ts)
- [gateway session runtime](/Users/pablo/proliferate/apps/gateway/src/hub/session-runtime.ts)
- [gateway session hub](/Users/pablo/proliferate/apps/gateway/src/hub/session-hub.ts)
- [snapshot resolution helper](/Users/pablo/proliferate/packages/shared/src/snapshot-resolution.ts)

## File tree for provider boundary

```text
packages/shared/src/providers/
  e2b.ts                    # E2B implementation
  modal-libmodal.ts         # existing alt provider reference
  index.ts                  # provider factory/selection

apps/gateway/src/hub/
  session-runtime.ts        # asks provider to ensure sandbox, tracks readiness
  session-hub.ts            # stream lifecycle, reconnect, runtime fanout

packages/services/src/sessions/
  db.ts                     # durable session metadata updates (sandbox ids, status)
```

## Core data models touched by provider lifecycle

| Model | Why it matters | File |
|---|---|---|
| `sessions` | Stores `sandboxId`, provider, status, tunnel URLs, pause state | `packages/db/src/schema/sessions.ts` |
| `configurations` | Default snapshot/config selection for faster start | `packages/db/src/schema/configurations.ts` |
| `repos` | Repo identity and setup context used during boot | `packages/db/src/schema/repos.ts` |

## Provider contract (V1 expected behavior)
Provider must support:
- Ensure sandbox exists
- Execute command(s)
- Stream output/events via gateway runtime path
- Pause/resume by sandbox id when available
- Destroy sandbox

Control-plane code should only call provider abstraction, not vendor SDK types.

## Boot flow (E2B)
1. Session runtime asks provider to ensure sandbox
2. Provider resolves sandbox identity (`currentSandboxId` or create new)
3. Provider injects runtime env (session id, gateway URL/token, env bundle values, non-sensitive config)
4. Provider may inject short-lived repo-scoped git credential for sandbox-native git operations
5. Sandbox starts `sandbox-daemon` and runtime processes
6. Provider resolves ingress host by explicit daemon port (E2B `getHost(port)`)
7. Gateway performs signed readiness probe against daemon ingress endpoint and marks runtime ready

Transport direction rule:
- Runtime transport uses Gateway -> Sandbox ingress over provider tunnel.
- Browser never receives provider hostnames directly.

## Pause/Resume flow (E2B)
- Pause:
  - Triggered by idle policy (default `10m`), including approval-wait idle periods
  - Provider pause call executed (`betaPause` path in E2B SDK)
  - Session row updated with paused state and snapshot/sandbox reference
- Resume:
  - Resolve pinned compute identity from run/session `boot_snapshot` (`provider/templateId/imageDigest`)
  - Provider reconnect by stored id (`connect()` resumes paused E2B sandboxes)
  - Re-hydrate fresh short-lived credentials (git/app tokens, virtual LLM key) via control plane before resuming task execution
  - Runtime restarts stream
  - Session continues from durable DB context

Network caveat from E2B behavior:
- Paused sandboxes drop active network connections.
- On resume, terminal/preview clients must reattach.

## Snapshot/setup strategy (V1)
Use E2B capabilities pragmatically:
- Snapshot is optimization, not correctness dependency
- Correctness comes from DB state + reproducible workspace steps

Recommended V1 behavior:
- On first repo setup, let setup run complete and persist metadata
- For recurring work, resume existing sandbox when possible
- If sandbox missing/expired, rebuild quickly from known setup path
- Use a "fat" E2B template for coding runs (Playwright + browser support) so final outputs can include visual proof artifacts
- Always run a git freshness step before task execution (`git fetch` + reset/rebase policy) so cached sandbox state does not drift from remote

## Setup snapshot refresh policy
To avoid stale snapshots:

1. Detect dependency-shape changes on default branch (`package-lock`, `pnpm-lock`, `poetry.lock`, `requirements*`, `Dockerfile`, `.devcontainer/*`).
2. Mark configuration snapshot stale.
3. Rebuild baseline setup snapshot asynchronously.
4. New sessions use refreshed snapshot; existing active sessions continue until completion.

## Security requirements
- Do not inject privileged long-lived tokens into sandbox by default
- Sandbox-native git operations may use short-lived, repo-scoped credentials (ephemeral)
- Ephemeral credentials must be minted/refreshed on cold boot and resume; never restored from frozen snapshot values
- Keep non-git action/integration execution server-side
- Sandbox can request actions; gateway approves/executes

## Failure handling
Common failures and expected response:
- Sandbox create fails: mark session failed with retry metadata
- Sandbox pause fails: log and continue with stop fallback
- Resume id not found: create new sandbox and recover from durable state
- Stream disconnect: retry attach with bounded backoff

## Telemetry required for E2B V1
Track per session:
- Sandbox create latency
- Time to first output
- Resume latency
- Pause success rate
- Failures by class (create, exec, resume, stream)
- Reattach success rate after pause/resume

## Non-goals (V1)
- Cross-provider state portability
- Kubernetes scheduling features
- Full snapshot productization UI

## Definition of done checklist
- [ ] All runtime execution goes through provider abstraction
- [ ] E2B boot/exec/pause/resume/destroy implemented reliably
- [ ] Failure paths are explicit with retries/fallbacks
- [ ] Security boundary preserved (server-side credential execution)
- [ ] Basic E2B telemetry emitted and queryable
- [ ] Runtime readiness is based on signed inbound daemon readiness check via provider tunnel
- [ ] Snapshot refresh path exists for dependency and environment drift


---

<!-- Source: 03-action-registry-and-org-usage.md -->

# Action Registry and Org Usage

## Goal
Create one execution boundary for all side effects (GitHub, Sentry, Linear, Slack, MCP tools) where policy, identity, OAuth resolution, approval, and audit are handled consistently.

This is the main difference between "agent can think" and "agent can safely do work".

## Scope
In scope:
- Action catalog listing for a session/coworker
- Action invocation + mode resolution (`allow`, `require_approval`, `deny`)
- OAuth token resolution and MCP connector auth resolution
- Sandbox-native git credential policy (short-lived, repo-scoped)
- GitHub PR ownership mode policy (`sandbox_pr` vs `gateway_pr`)
- Org-wide vs personal integration behavior
- Approval and post-approval revalidation
- Audit and status visibility

Out of scope:
- Trigger ingestion mechanics (see `05-trigger-services.md`)
- Session boot/runtime internals (see `06-gateway-functionality.md` and `11-streaming-preview-transport-v2.md`)

## Implementation file tree (must-read)

```text
apps/gateway/src/api/proliferate/http/
  actions.ts                 # invoke/approve/deny/status surfaces

packages/services/src/actions/
  service.ts                 # mode resolution + invocation lifecycle
  db.ts                      # action invocation persistence
  modes.ts                   # policy source resolution
  connectors/                # MCP connector action source adapters

packages/services/src/integrations/
  service.ts                 # integration lifecycle
  tokens.ts                  # OAuth token resolution boundary
  github-app.ts              # GitHub App installation token path

packages/services/src/connectors/
  service.ts                 # org connector CRUD and validation
  db.ts                      # org connector persistence

packages/services/src/secrets/
  service.ts                 # secret resolution for connector auth
```

Reference docs:
- `docs/specs/actions.md`
- `docs/specs/integrations.md`
- `docs/sim-architecture-spec.md` (for control-plane credential handling pattern)

## Core data models

| Model | Purpose | File |
|---|---|---|
| `action_invocations` | Durable record of requested/executed/approved/denied side effects | `packages/db/src/schema/schema.ts` (`actionInvocations`) |
| `integrations` | OAuth/GitHub-App references by org | `packages/db/src/schema/integrations.ts` |
| `org_connectors` | Org-scoped MCP connector definitions | `packages/db/src/schema/schema.ts` (`orgConnectors`) |
| `organization.action_modes` | Org policy overrides for `sourceId:actionId` keys | `packages/db/src/schema/schema.ts` |
| `automations.action_modes` | Coworker-level stricter policy overrides | `packages/db/src/schema/schema.ts` |
| `outbox` | Async notifications for approval/state transitions | `packages/db/src/schema/schema.ts` (`outbox`) |

Minimum invocation fields to persist:
- `organizationId`, `sessionId`, `sourceId`, `actionId`, `params`
- `mode`, `modeSource`
- `actorUserId`, `requestedRunAs`, `credentialOwnerType`
- `status`, `approvedBy`, `approvedAt`, `executedAt`, `error`

## Action source architecture

### One catalog, two source types
1. Provider actions:
- Built-in adapters for GitHub/Linear/Sentry/Slack class operations
- Definitions and schemas owned in provider/action modules

2. Connector actions (MCP):
- Discovered from org connector tools list (`tools/list`)
- Wrapped into the same `sourceId/actionId` runtime contract
- Executed through server-side connector client, never direct sandbox secret use

The runtime pipeline is unified after source resolution.

## OAuth and MCP credential path (required behavior)

### OAuth-backed actions
- Integration rows store connection references, not raw token material for Nango-managed providers.
- Runtime obtains fresh token server-side via `packages/services/src/integrations/tokens.ts:getToken`.
- GitHub App path mints short-lived installation tokens server-side (`github-app.ts`).
- Sandbox never receives long-lived OAuth secrets.

### MCP connector-backed actions
- Connector config is org-owned (`org_connectors`).
- Auth material resolves from server-side secret storage (`packages/services/src/secrets/service.ts`).
- Gateway/service opens MCP client session and executes tool call.
- Sandbox only receives action results, not connector credentials.

This follows the same control-plane secret boundary that strong enterprise systems use.

## Sandbox-native git operations (explicit V1 exception)

Allowed in sandbox:
- `git fetch/pull/commit/push`
- PR creation from sandbox tooling (default mode)

Required constraints:
- Credentials must be short-lived and repo-scoped.
- Credentials are minted server-side and injected only for session runtime.
- Credentials must be refreshed on resume/rehydration paths; expired credentials must not be replayed from stored runtime snapshots.
- No long-lived org action secrets are injected for this path.
- Non-git side effects (for example ticket changes, deploy actions, analytics writes) stay in gateway action execution path.
- Audit must still record actor, run identity, repo, and resulting PR metadata.

## GitHub PR ownership mode (policy toggle)

`sandbox_pr` (V1 default):
- Sandbox creates PR directly after push using short-lived repo-scoped credential.
- Fastest path; minimal control-plane orchestration.

`gateway_pr` (future strict mode):
- Sandbox pushes branch only.
- Sandbox emits PR-create request to gateway action boundary.
- Gateway creates PR server-side with policy-controlled identity.

Mode requirements:
- PR ownership mode is explicit and must be frozen in run/session `boot_snapshot`.
- Mid-run mode changes do not affect in-flight run behavior.

## Invocation flow (end to end)

### 1) List available actions
1. Resolve session org + identity
2. Load built-in provider actions
3. Load enabled org connectors and discover tools
4. Apply source/user visibility and policy hints
5. Return normalized list with schema + mode hints

### 2) Invoke action
1. Validate input schema
2. Resolve mode in deterministic order:
- automation override
- org override
- default risk mode
3. Create invocation row
4. If `deny`: persist denied + return
5. If `require_approval`: persist pending + emit notification + return suspended response immediately
6. If `allow`: execute immediately via provider/connector adapter
7. Persist final status and output summary

### 3) Approve/deny pending invocation
1. Validate approver role
2. Transition pending row
3. Revalidate before execution (TOCTOU)
- token still valid
- target state still valid
- policy still permits this exact request
4. Execute or fail with revalidation error
5. Persist final state + broadcast update

Revalidation precedence contract (required):
- Frozen `boot_snapshot` remains source-of-truth for run intent (prompt/tooling/run identity defaults).
- Live org security state is source-of-truth at execution time:
  - integration/token revocations
  - org kill switches / connector disablement
  - credential validity/expiry
- If live security state is stricter than frozen snapshot, execution must fail closed.

## Invocation state machine and idempotency

Allowed transitions:
- `pending` -> `approved` -> `executing` -> `completed|failed`
- `pending` -> `denied`
- `pending` -> `expired`
- `approved` -> `failed` (revalidation or execution failure)
Idempotency requirements:
- Every invocation must carry an `idempotencyKey` unique per org + action intent.
- Retry of the same request must return existing invocation/result instead of duplicating side effects.
- External provider request IDs should be stored when available for reconciliation.

## Org-wide vs personal integration behavior

Two separate decisions must always be explicit:
1. `run_as`: who the coworker is acting as
2. `credential_owner`: whose token/connector auth will be used

Default policy for V1:
- Interactive runs: prefer personal credential when available
- Long-running coworkers: prefer org/system credential
- Personal -> org fallback only when explicitly allowed by policy

Fail-safe rule:
- If required personal credential is missing, fail with actionable message.
- Do not silently escalate to org admin credentials.

## Sharing behavior for coworkers/templates

Required UX semantics:
- Coworkers can be shared, but integrations must declare ownership type (`org` vs `personal-required`).
- On import/share, personal-required integrations prompt the recipient to bind their own account.
- Warning banner must explain when a coworker currently depends on personal credentials.

## Security invariants

- Every non-git external side effect runs through gateway/service invocation path.
- Sandbox git push/PR path is the only V1 exception and is constrained to short-lived repo-scoped credentials.
- V1 default PR mode is `sandbox_pr`; strict `gateway_pr` is reserved for policy hardening without architecture rewrite.
- No direct sandbox -> third-party privileged writes with raw org credentials.
- All invocations are auditable and queryable by session/coworker/org.
- Approval-required actions must be durable and recoverable across restarts.
- Connector and OAuth auth materials are resolved server-side only.

## Definition of done checklist
- [ ] Single invocation lifecycle covers provider and MCP connector actions
- [ ] Input schemas validated before execution
- [ ] Mode resolution and source attribution persisted on each invocation
- [ ] OAuth and connector auth resolved server-side only
- [ ] Org vs personal credential behavior is explicit and visible
- [ ] Approval/deny + revalidation paths are implemented and auditable
- [ ] Sharing UX warns and remaps personal integrations on import
- [ ] PR ownership mode is explicit per run (`sandbox_pr` default, `gateway_pr` available for future strict mode)


---

<!-- Source: 04-long-running-agents.md -->

# Long-Running Agents

## Goal
Support persistent agents that keep working over time, can spawn child coding runs, survive restarts, and remain inspectable by humans.

## Product behavior
A long-running agent should feel like a teammate that owns a job.

Example:
- "Sentry Auto-Fixer" runs all day
- It checks new issues, spawns child coding runs, and reports results
- User can ask "what got fixed?" and get concrete links

## Runtime model

### A) Manager agent (supervisor role)
- Runs as an isolated "lean" sandbox agent (not inside control-plane Node.js process)
- Durable identity and objective
- Reads grouped inbox summaries (chat, webhook, cron wake) via gateway tools
- Decides what to do next
- Spawns child runs for concrete work

Efficiency constraints:
- Manager sessions should be burst-oriented and short-lived (triage/decide/dispatch, then exit).
- Do not keep lean manager sandboxes idling for long periods when no work remains.
- Deterministic pre-processing (dedupe/grouping/routing prep) may run in trigger-service/worker before manager boot.

### B) Child runs
- Isolated coding sessions
- One task per run
- Produce reviewable outputs (PR, logs, summary)

### C) Durable state in DB
Persist:
- Agent status and intent
- Run graph (parent/child links)
- Progress summaries
- Approvals and action results
- Source cursors/checkpoints (for polling sources)

Do not rely on in-memory gateway state for long-running correctness.

### D) Control plane backend responsibilities (no LLM loop)
- Route events to inbox
- Orchestrate session/run lifecycle
- Enforce policy/approvals
- Persist and broadcast runtime state

The control plane does not run open-ended LLM planning logic directly.

Lease/locking requirement:
- Only one manager harness instance may be active per coworker at a time.
- Claim must use durable lock/lease semantics to prevent duplicate orchestration loops.
- Trigger wake events must be coalesced to avoid duplicate manager boots.

## Implementation file tree (current and planned owners)

```text
apps/worker/src/automation/
  index.ts                  # run execution orchestration
  resolve-target.ts         # target repo/config resolution
  finalizer.ts              # completion + side effects
  notifications.ts          # run status notifications

apps/trigger-service/src/
  api/webhooks.ts           # webhook ingestion
  polling/worker.ts         # cron polling ingestion

packages/services/src/
  automations/service.ts    # coworker definitions and config
  runs/service.ts           # run lifecycle + transitions
  sessions/service.ts       # session lifecycle linkage
  outbox/service.ts         # durable async dispatch
```

## Core data models for long-running behavior

| Model | Purpose | File |
|---|---|---|
| `automations` | Coworker identity, instructions, enabled state, notification destination | `packages/db/src/schema/automations.ts` |
| `triggers` | What wakes the coworker and with which provider/cadence | `packages/db/src/schema/triggers.ts` |
| `trigger_events` | Durable queue/history of incoming wake events | `packages/db/src/schema/triggers.ts` |
| `automation_runs` | Per-wake execution record and status transitions | `packages/db/src/schema/schema.ts` (`automationRuns`) |
| `sessions` | Child coding session runtime and sandbox linkage | `packages/db/src/schema/sessions.ts` |
| `outbox` | Follow-up dispatch for notifications/side effects | `packages/db/src/schema/schema.ts` (`outbox`) |

## Wake model
Use hybrid wake strategy:
- Webhooks for interactive/near-real-time events (GitHub mentions, Slack)
- Cron polling for periodic batch checks (for example Sentry triage sweep)

Internally both become inbox events.

## Query-from-anywhere contract
Users should be able to ask coworkers for status from web (primary) and Slack/GitHub (secondary).

Required behavior:
- A status query resolves from durable run/session rows first.
- If manager agent is currently running, include live addendum from current context.
- Response always includes concrete links (run details, PRs, approvals).

## Idle/suspend behavior
When agent has no immediate work:
- Persist current state and summary
- Pause sandbox (E2B) or stop safely
- Resume on next wake event

Default idle timeout:
- `10m` for both normal idle periods and approval-wait idle periods.

Cost guardrail:
- Prefer stopping completed/idle manager sessions rather than hibernating them.
- Reserve pause/hibernate primarily for worker coding sessions with expensive warm state.

## User controls
Required controls:
- Pause agent
- Resume agent
- Cancel current child run
- Reprioritize objective (chat command)
- See current status and recent outcomes

## Safety controls
- Concurrency cap per agent and per org
- Retry limits and backoff
- Idempotency on side effects
- Budget/time limits per run

## Practical V1 constraints
- Keep one clear parent/child model (avoid deep recursive fanout)
- Keep child run objective small and explicit
- Prefer deterministic run completion criteria (tests pass, PR created)

## Definition of done checklist
- [ ] Persistent agent can wake repeatedly from inbox events
- [ ] Agent can spawn and track child runs
- [ ] Parent/child statuses are visible in UI
- [ ] Agent survives process restart without losing control state
- [ ] Pause/resume behavior is stable for day-scale workflows
- [ ] Manager/supervisor cognition runs in isolated sandbox, not control-plane process
- [ ] Status queries are available from dashboard and at least one external channel (Slack/GitHub)


---

<!-- Source: 05-trigger-services.md -->

# Trigger Services (GitHub, Linear, Sentry, Slack)

## Goal
Turn external events into reliable internal work requests for agents.

## Core rule
Trigger-service ingests and persists events quickly, then async workers process them.
Do not run heavy agent logic directly in webhook HTTP handlers.

Current key files:
- [webhooks ingestion](/Users/pablo/proliferate/apps/trigger-service/src/api/webhooks.ts)
- [webhook inbox worker](/Users/pablo/proliferate/apps/trigger-service/src/webhook-inbox/worker.ts)
- [polling worker](/Users/pablo/proliferate/apps/trigger-service/src/polling/worker.ts)
- [trigger services](/Users/pablo/proliferate/packages/services/src/triggers)

## Trigger subsystem file tree

```text
apps/trigger-service/src/
  api/webhooks.ts               # provider webhook entrypoints
  webhook-inbox/worker.ts       # async processing from durable inbox
  polling/worker.ts             # scheduled pull-based events

packages/services/src/triggers/
  service.ts                    # trigger CRUD + orchestration rules
  db.ts                         # trigger and trigger event persistence
  mapper.ts                     # API shape mapping

packages/services/src/webhook-inbox/
  db.ts                         # raw inbox persistence + claim/retry
```

## Core data models

| Model | Purpose | File |
|---|---|---|
| `triggers` | Trigger definitions (provider, type, config, integration binding) | `packages/db/src/schema/triggers.ts` |
| `trigger_events` | Durable event records before/after processing | `packages/db/src/schema/triggers.ts` |
| `trigger_event_actions` | Audit of tool actions from trigger processing | `packages/db/src/schema/triggers.ts` |
| `trigger_poll_groups` | Polling fan-in by org/provider/integration for scale | `packages/db/src/schema/schema.ts` |
| `webhook_inbox` | Raw webhook durability and retry safety | `packages/db/src/schema/schema.ts` |

## V1 trigger scope
Required:
- GitHub (mentions, issue/PR events, CI signal entrypoints)
- Linear (issue updates/comments)
- Sentry (issue events)
- Slack (mentions/commands)

Optional/later:
- PostHog batch analysis
- Jira parity for enterprise bundles
- Docs/productivity sources (for example Google Docs) via connector-backed triggers

## Wake model (recommended)
Use both methods:
- Webhooks for immediate user/issue events
- Polling for periodic backlog scans and resilience

Why both:
- Webhooks are fast but can miss events
- Polling is reliable but slower and rate-limited
- Together they provide speed + recovery

## Event pipeline
1. Receive event from provider
2. Validate source/signature
3. Persist inbox row
4. Ack provider quickly
5. Worker claims inbox row
6. Match to target agent(s)
7. Create trigger event + manager wake request (not child coding run)
8. Dispatch wake via outbox/worker pipeline

Run-storm prevention rule:
- Trigger-service must not spawn child coding runs directly.
- If manager is already running/queued for a coworker, coalesce additional wake events into inbox.
- Trigger-service performs deterministic pre-LLM grouping so manager receives summarized batches, not raw firehose payloads.
- Manager harness decides child run fanout from grouped summaries.

Deterministic grouping requirements (before manager inbox):
- Group by provider-specific stable keys (for example `sentry_issue_id`, `linear_issue_id`, `github_repo+pr+event_type`).
- Maintain counters and first/last occurrence timestamps per group.
- Store representative payload sample (or normalized summary) instead of every duplicate event body.
- Enforce max grouped items per inbox wake payload; overflow items remain queued for subsequent wakes.

## Dedup and idempotency
Must dedupe on:
- Provider event id
- Content hash + source + time window

Must support safe reprocessing if worker crashes.

## Trigger-to-agent mapping
Mapping model should support:
- Org-level agent owning source (for example global Sentry triager)
- Repo/project scoped agent binding
- Manual override in UI

Routing precedence (required):
1. Explicit trigger -> coworker binding
2. Repo/project scoped coworker binding
3. Org default coworker for provider

Fanout/backpressure rules (required):
- Default fanout is one target coworker per trigger event unless explicitly configured.
- If multiple targets are allowed, enforce max fanout per event.
- When org concurrency cap is reached, queue events and mark as delayed (not dropped).

## UX expectations
Users should not configure brittle technical trigger graphs for V1.
They should configure:
- Which sources this agent watches
- Which projects/repos are included
- Poll cadence (if applicable)
- Per-source cron tabs with defaults (`every 5m`, `hourly`, `daily`) and custom cron option
- \"Run now\" test action for each configured trigger

## Definition of done checklist
- [ ] Webhook ingestion is durable and async
- [ ] Polling path exists for at least one provider batch source
- [ ] Dedup prevents duplicate run storms
- [ ] Trigger events map cleanly to target agents
- [ ] Trigger failures are visible and retryable
- [ ] Trigger setup UX supports both webhook and cron-style workflows without manual JSON editing


---

<!-- Source: 06-gateway-functionality.md -->

# Gateway Functionality (Runtime Bus)

## Goal
Make gateway the single runtime execution layer for agent actions and session streaming.

## Product-level role
Gateway is where "work" happens at runtime:
- Accept tool/action requests from running sessions
- Resolve policy and approvals
- Execute integrations server-side
- Persist invocation results
- Push live status to connected viewers

Current code anchors:
- [HTTP actions surface](/Users/pablo/proliferate/apps/gateway/src/api/proliferate/http/actions.ts)
- [tools route](/Users/pablo/proliferate/apps/gateway/src/api/proliferate/http/tools.ts)
- [session runtime](/Users/pablo/proliferate/apps/gateway/src/hub/session-runtime.ts)
- [session hub](/Users/pablo/proliferate/apps/gateway/src/hub/session-hub.ts)
- [event processor](/Users/pablo/proliferate/apps/gateway/src/hub/event-processor.ts)

## Gateway file tree (runtime-critical paths)

```text
apps/gateway/src/
  api/proliferate/http/
    actions.ts                # action invoke/approve/deny
    sessions.ts               # session lifecycle endpoints used by clients
    tools.ts                  # tool surface and callback handling
  api/proxy/
    devtools.ts               # runtime proxy surfaces
    terminal.ts               # terminal websocket proxy
  hub/
    session-hub.ts            # per-session fanout and client coordination
    session-runtime.ts        # provider runtime ensure/reconnect
    event-processor.ts        # stream normalization + telemetry/compute metering intercept
    backplane.ts              # cross-replica pub/sub fanout bridge
```

## Core data models gateway reads/writes

| Model | Gateway usage | File |
|---|---|---|
| `sessions` | status transitions, runtime metadata (`sandboxId`, tunnel urls, telemetry) | `packages/db/src/schema/sessions.ts` |
| `action_invocations` | side-effect lifecycle and approvals | `packages/db/src/schema/schema.ts` (`actionInvocations`) |
| `integrations` / `org_connectors` | action source resolution and auth lookup context | `packages/db/src/schema/integrations.ts`, `packages/db/src/schema/schema.ts` |
| `outbox` | downstream async notifications/events after runtime transitions | `packages/db/src/schema/schema.ts` (`outbox`) |

## Required responsibilities

### 1) Session runtime control
- Ensure sandbox runtime is ready
- Maintain stream lifecycle and reconnect behavior
- Expose runtime status to clients
- Enforce immutable run/session `boot_snapshot` during runtime and policy checks

### 2) Action invocation boundary
- List available actions
- Invoke action
- Approve/deny invocation
- Emit invocation status updates
- Applies to non-git side effects; sandbox-native git push/PR path follows coding harness contract
- If PR ownership mode is `gateway_pr` (future strict mode), gateway also owns PR creation side effect

### 3) Policy/identity checkpoint
Before side effects:
- Validate action params
- Resolve mode (`allow`, `require_approval`, `deny`)
- Resolve execution identity/credential owner
- Revalidate delayed invocations after approval and before execution

Approval-wait response contract:
- On `require_approval`, gateway persists pending state and returns immediate suspended response (`202` semantic).
- Session may remain running until idle timeout; standard idle pause (`10m`) handles hibernation.
- On approval/deny, gateway emits a deterministic resume event (`sys_event.tool_resume`) with invocation outcome for harness continuation.
- Because paused sandboxes drop connections, harness/daemon must reconcile pending invocation states on reconnect (pull-based sync), not rely only on pushed resume events.

### 4) Durable persistence
- Persist invocation rows and status transitions
- Persist tool/action outputs needed for audit and UI replay

### 5) Live fanout
- Broadcast runtime and invocation updates over websocket
- Allow multi-viewer visibility for same session

Horizontal scale contract:
- Split runtime traffic into:
  - Control stream: low-volume lifecycle/invocation events (approval state, status changes, coordination).
  - Data stream: high-volume PTY/FS/runtime byte streams.
- Use shared backplane (Redis Pub/Sub or equivalent) for control stream only.
- Do not publish raw PTY/FS high-throughput frames to Redis backplane by default.
- Each session has an owner gateway replica for daemon data-plane connection.
- Browser stream attachment must route to owner gateway (consistent hash, owner lookup + redirect/proxy, or equivalent).
- Sticky sessions may be used as optimization but are not sufficient as sole correctness mechanism.
- On owner failover, new owner reattaches runtime and resumes using replay/reconciliation semantics.

### 6) Metering and telemetry intercept
- Parse runtime `agent_event` frames for observability and realtime UX telemetry
- Persist deterministic compute lifecycle cut points (`start`, `pause`, `resume`, `end`) for billing
- Do not create billable LLM token events from stream frames
- LLM token billing truth comes from LiteLLM spend ingestion (`15-llm-proxy-architecture.md`)

## DB-first + stream-attach UX split

### Org and inbox pages
- Read durable tables first
- No streaming dependency for basic visibility

### Session detail page
- Load persisted state first
- Attach websocket stream for live detail

This prevents dashboards from breaking when streams reconnect.

Streaming contracts for terminal/code/preview transport are detailed in:
- [11-streaming-preview-transport-v2.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/11-streaming-preview-transport-v2.md)
- [canonical streaming spec](/Users/pablo/proliferate/docs/specs/streaming-preview.md)

## Failure behavior
Gateway must be explicit about:
- Disconnected runtime
- Invocation pending approval
- Invocation denied
- Provider/integration execution error
- Suspended-waiting-for-approval status with deterministic resume path
- Reconnect reconciliation failures (for pending invocation/status pull)

Each must have clear status and retry path.

## Non-goals (V1)
- Turn gateway into main CRUD API surface
- Embed business policy in frontend code
- Direct sandbox-to-external integration calls

## Definition of done checklist
- [ ] Gateway is the only runtime action bus
- [ ] Side effects require policy resolution before execution
- [ ] Invocation rows persist all status transitions
- [ ] Websocket broadcasts include pending/completed/failed states
- [ ] DB-first org dashboard + live session detail split is implemented
- [ ] Gateway evaluates runtime permissions against immutable `boot_snapshot`
- [ ] Post-approval revalidation is enforced before executing pending actions
- [ ] Gateway route handlers remain transport-only and do not import Drizzle models directly
- [ ] Gateway stream telemetry does not directly write billable LLM token events


---

<!-- Source: 07-cloud-billing.md -->

# Billing on Cloud (V1)

## Goal
Bill managed-cloud customers in a way that is simple, explainable, and tied to real agent usage.

Current code anchors:
- [web billing router](/Users/pablo/proliferate/apps/web/src/server/routers/billing.ts)
- [billing services](/Users/pablo/proliferate/packages/services/src/billing)
- [metering](/Users/pablo/proliferate/packages/services/src/billing/metering.ts)
- [billing worker](/Users/pablo/proliferate/apps/worker/src/billing/worker.ts)
- [billing outbox processor](/Users/pablo/proliferate/apps/worker/src/jobs/billing/outbox.job.ts)

## Billing file tree

```text
apps/web/src/server/routers/
  billing.ts                  # customer-facing billing APIs

apps/worker/src/billing/
  worker.ts                   # recurring billing jobs

apps/worker/src/jobs/billing/
  outbox.job.ts               # outbox posting/sync jobs
  fast-reconcile.job.ts       # on-demand reconciliation

packages/services/src/billing/
  metering.ts                 # usage event creation
  gate.ts                     # runtime gating checks
  org-pause.ts                # pause org on policy/credit rules
  shadow-balance.ts           # fast balance approximation
  outbox.ts                   # outbox posting helpers
```

## Core data models

| Model | Purpose | File |
|---|---|---|
| `billing_events` | Usage ledger + outbox posting state (`pending`, `posted`, `failed`) | `packages/db/src/schema/billing.ts` |
| `llm_spend_cursors` | Incremental sync cursor for LLM spend ingestion | `packages/db/src/schema/billing.ts` |
| `billing_reconciliations` | Manual/automatic corrections with audit trail | `packages/db/src/schema/billing.ts` |
| `sessions` | Runtime duration and lifecycle timestamps used for compute metering | `packages/db/src/schema/sessions.ts` |
| `organization` billing fields | Current balance/plan and gating behavior | `packages/db/src/schema/schema.ts` / auth schema |

## V1 pricing model (recommended)
Two-part model:
1. Platform fee (seat/base)
2. Usage fee (runtime and model usage)

Keep invoicing transparent:
- Session runtime minutes
- Model token spend proxy
- Optional premium for heavy sandbox usage

## What to meter in V1
Required metering dimensions:
- Session/runtime duration
- Run count
- Invocation count for expensive connectors
- LLM token usage (from LiteLLM spend logs)

If LLM proxy spend data is unavailable for a path, meter runtime minutes as fallback and label estimate in reporting.

## Metering source-of-truth rules
- LLM token usage source-of-truth is LiteLLM spend ingestion (`llm-sync-*` worker jobs, per-org cursor).
- Gateway runtime stream usage frames are advisory telemetry only (not billable token truth).
- Session compute duration is derived from durable lifecycle timestamps (`startedAt`, `pausedAt`, `endedAt`) with pause windows excluded.
- Pause/resume boundaries must create deterministic metering cut points to avoid double counting.
- Approval-wait time is billable only while session is still running; once idle pause triggers, paused window is not billable.

Budget enforcement split (required):
- Ledger truth remains async (spend ingestion).
- Hard budget/rate enforcement must happen synchronously at LLM proxy virtual-key layer.
- Billing worker reconciliation must not be the first line of budget defense for runaway loops.

## Metering event model
Create durable usage records when:
- Session starts/stops
- Run completes/fails
- Invocation executes expensive side effects

Each usage row needs:
- org id
- source (session/run/invocation)
- quantity + unit
- timestamp
- correlation id for debugging
- provider/model metadata when applicable

## Billing UX requirements
Customer can see:
- Current billing period usage summary
- Top cost drivers (by agent/repo/workflow)
- Recent billable events
- Plan limits and nearing-limit warnings

## Entitlement gates (cloud only)
Need soft/hard gates for:
- Max concurrent runs
- Max active background agents
- Monthly usage thresholds

Gates should fail with clear reason and upgrade path.

## Metering event contract (minimum fields)
Every billable event must include:
- `organizationId`
- `eventType` (`compute` or `llm`)
- `quantity`, `credits`
- `idempotencyKey`
- `sessionIds` (where relevant)
- `metadata` for debugging/explaining invoices

## Non-goals (V1)
- Highly complex pricing permutations
- Per-action micro-pricing for every connector
- Full finance-grade cost attribution by every subcomponent

## Definition of done checklist
- [ ] Metering records are durable and queryable
- [ ] Billing UI shows usage and recent billable activity
- [ ] Plan limits are enforced with clear user messaging
- [ ] Invoices/charges can be explained from recorded events
- [ ] Outbox/reconciliation jobs can recover from transient posting failures


---

<!-- Source: 08-coding-agent-harnesses.md -->

# Coding Agent Harnesses

## Goal
Support strong coding execution today with OpenCode, while keeping the system harness-agnostic so teams can use other coding agents later.

## Product requirement
Users should be able to:
- Run coding tasks with a default harness (OpenCode)
- Keep long-running orchestration independent of harness choice
- Eventually switch harness per agent/profile without replacing control plane

## Clear responsibility split

### Control plane + gateway
Owns:
- Session lifecycle
- Policy and approvals
- Credential resolution
- Audit and live events

### Coding harness inside sandbox
Owns:
- Code reasoning loop
- File edits
- Command/test execution
- Producing patch/commit output
- Sandbox-native git push and PR creation for repo tasks (with short-lived repo-scoped auth)

This keeps orchestration stable even if harness changes.

## V1 harness mode
Default only:
- OpenCode as coding harness
- PR ownership mode defaults to `sandbox_pr` (sandbox pushes + creates PR)

Relevant code paths:
- [opencode config helpers](/Users/pablo/proliferate/packages/shared/src/sandbox/opencode.ts)
- [opencode tools package](/Users/pablo/proliferate/packages/shared/src/opencode-tools/index.ts)
- [gateway tool route](/Users/pablo/proliferate/apps/gateway/src/api/proliferate/http/tools.ts)
- [agent contract spec](/Users/pablo/proliferate/docs/specs/agent-contract.md)
- [sandbox provider spec](/Users/pablo/proliferate/docs/specs/sandbox-providers.md)

## Harness file tree (V1)

```text
packages/shared/src/sandbox/
  opencode.ts                 # OpenCode runtime config and launch helpers
  config.ts                   # sandbox bootstrap files + defaults

packages/shared/src/opencode-tools/
  index.ts                    # tool injection contracts for coding runs

apps/gateway/src/api/proliferate/http/
  tools.ts                    # tool callback boundary into control plane

packages/services/src/actions/
  service.ts                  # side-effect path for tool-requested actions
```

## Core data models used by harness flows

| Model | Harness relevance | File |
|---|---|---|
| `sessions` | Run identity, prompt context, runtime status | `packages/db/src/schema/sessions.ts` |
| `action_invocations` | Actions requested by harness and approval outcomes | `packages/db/src/schema/schema.ts` (`actionInvocations`) |
| `integrations` / `org_connectors` | Source auth lookup done by gateway/services | `packages/db/src/schema/integrations.ts`, `packages/db/src/schema/schema.ts` |
| `outbox` | Notifications from terminal run state changes | `packages/db/src/schema/schema.ts` (`outbox`) |

## Future harness-agnostic contract
Plan for simple adapter surface:
- start(task, context)
- stream events
- stop
- collect outputs

Each harness adapter should map to common run output format:
- summary
- changed files
- checks run + results
- PR metadata links
- artifacts

## Worker profiles (recommended)
Two profiles are required:
- **Worker harness (fat sandbox):** OpenCode for coding tasks (edit/test/git flows)
- **Manager harness (lean sandbox):** lightweight orchestration loop for inbox triage, status queries, and spawning child coding runs

Manager harness responsibilities:
- read coworker inbox/events
- summarize progress and answer \"what happened\" queries
- call control-plane tools to spawn coding child runs
- avoid heavy code-editing loops

Worker harness responsibilities:
- execute concrete coding task
- run checks/tests
- produce deterministic output bundle (summary, diff, artifacts, PR metadata)
- handle git fetch/commit/push/PR using ephemeral repo credentials

PR ownership mode support:
- `sandbox_pr` (default now): worker harness creates PR from sandbox.
- `gateway_pr` (future strict mode): worker harness pushes branch; gateway creates PR.

## Async approval handoff contract

When harness requests a gateway action and receives suspended approval response (`202` semantic):
- Harness must treat it as "waiting", not failure.
- Harness should yield/idle its reasoning loop without busy polling.
- Session follows normal idle policy (default `10m`) and may pause.
- On approval/deny resolution, gateway emits resume event with invocation outcome.
- Harness continues with injected tool result/error context on resume.

## Security constraints for harnesses
- Harness never receives privileged org tokens by default
- Harness may receive short-lived repo-scoped git auth for coding session lifecycle
- External side effects use gateway action invocation path
- Harness may request actions; gateway decides and executes
- OAuth and MCP credentials are resolved in control-plane services, not inside sandbox

## UX implications
Users should not need to know harness internals.
They should configure:
- Agent purpose
- Allowed tools/capabilities
- Output/review expectations

Harness choice is advanced setting.

## Non-goals (V1)
- Perfect abstraction over all coding tools now
- Full bring-your-own harness support in first release
- Deep harness-specific UI customizations

## Definition of done checklist
- [ ] OpenCode-based coding runs are stable in E2B
- [ ] Harness logic does not bypass gateway action boundary
- [ ] Run outputs are normalized for UI and audits
- [ ] Codebase is structured to add new harness adapters later


---

<!-- Source: 09-notifications.md -->

# Notification Mechanisms for Agents

## Goal
Make notifications reliable, low-noise, and actionable for both interactive runs and long-running coworkers.

## Product behavior
Notifications should answer:
- What happened?
- Does a human need to act?
- Where do I click to inspect/fix/approve?

They should also support a coworker-style communication model:
- Per-coworker thread/channel destination
- Optional "ping me on every meaningful update" mode
- Immediate escalation for blocked/approval-required states

## Notification event types (V1)
Required:
- `approval_required`
- `run_started`
- `run_blocked`
- `run_failed`
- `run_completed`
- `agent_health_degraded`

Optional in V1.1:
- `digest_daily`
- `digest_weekly`

## Delivery channels
V1 required channels:
- In-app inbox (durable source of truth)
- Slack (primary external channel)

V1.1+ channels:
- Email
- Webhook sink
- Desktop push

## Architecture model
Use durable outbox + async dispatch.

Current code anchors:
- [notifications service](/Users/pablo/proliferate/packages/services/src/notifications/service.ts)
- [notifications db](/Users/pablo/proliferate/packages/services/src/notifications/db.ts)
- [outbox service](/Users/pablo/proliferate/packages/services/src/outbox/service.ts)
- [worker notification dispatch](/Users/pablo/proliferate/apps/worker/src/automation/notifications.ts)

## Notifications file tree

```text
packages/services/src/notifications/
  service.ts                  # notification intents + enqueue
  db.ts                       # subscriptions and notify markers

packages/services/src/outbox/
  service.ts                  # claim/retry/dispatched/failed transitions

apps/worker/src/automation/
  notifications.ts            # run notification formatting + delivery
  outbox-dispatch.ts          # generic outbox dispatch loop
```

## Core data models

| Model | Purpose | File |
|---|---|---|
| `outbox` | Durable queue and retry/lease state for notification delivery | `packages/db/src/schema/schema.ts` (`outbox`) |
| `session_notification_subscriptions` | Per-user per-session subscription preferences and delivery marker | `packages/db/src/schema/slack.ts` |
| `automations.notification_*` fields | Coworker-level destination defaults | `packages/db/src/schema/automations.ts` |
| `automation_runs` / `sessions` | Source state for notification content and deep links | `packages/db/src/schema/schema.ts`, `packages/db/src/schema/sessions.ts` |

## End-to-end flow
1. Runtime status changes (or approval requirement occurs)
2. System writes durable notification intent (outbox + subscription state)
3. Dispatcher claims pending outbox rows
4. Channel delivery attempt runs
5. Delivery result stored (`sent`, `failed`, `retrying`, `dead_letter`)
6. UI reflects latest state from DB

## Recipient resolution model
Resolve recipients by precedence:
1. Run/session-level override
2. Coworker-level notification config
3. Org defaults
4. User notification preferences (mute/escalation)

## Required payload fields
Every notification should include:
- organizationId
- agentId and/or sessionId/runId
- event type
- short title
- human-readable summary
- deep link(s) to run/session/approval
- severity
- createdAt

For approvals, include:
- requested action
- reason
- approval buttons/links

## Reliability rules
- Use idempotency key per notification intent
- Retries with backoff for transient channel errors
- Dead-letter after max attempts
- Never lose notifications due to websocket disconnects (DB is source of truth)

## Noise control rules
- Coalesce repeated events for same run in short window
- Avoid sending both "started" and immediate "failed" spam chains
- Use digest mode for low-priority updates
- Always send `approval_required` immediately

## Security and privacy rules
- Do not include secrets in notification payloads
- Limit sensitive stack traces in external channels
- Keep full details in app (linked secure page)
- Record who approved/denied in audit trail

## UX requirements

### In-app inbox
Must support:
- Filter by status/severity/type
- Mark read/unread
- Approve/deny from notification context where applicable
- Clear link to session detail and artifacts

### Slack
Must support:
- Human-readable summary
- Button/link to "View Run"
- For approval-required, clear call-to-action with one-click deep link
- Stable thread/channel targeting for each coworker when configured

## Cloud billing tie-in
Notification usage may become billable later, but V1 treats notification dispatch as operational cost, not primary billing dimension.

## Non-goals (V1)
- Full campaign-style notification rules engine
- Arbitrary user-built workflows for notification routing
- Multi-channel fanout policies with complex conditional trees

## Definition of done checklist
- [ ] Notification intents are written durably
- [ ] Dispatcher retries and marks final delivery status
- [ ] In-app inbox shows reliable DB-backed notifications
- [ ] Slack notifications include actionable deep links
- [ ] Approval-required notifications are immediate and auditable
- [ ] Coworker-level destination preferences are respected


---

<!-- Source: 10-layering-and-mapping-rules.md -->

# Layering and Mapping Rules (No DB in Routers)

## Goal
Keep architecture clean and maintainable by enforcing strict boundaries between transport, business logic, persistence, and mapping.

## Required layer order
All request paths should follow this flow:

```text
Router/Handler -> Service -> DB Module -> Mapper -> Contract DTO -> Response
```

## Hard rules

### 1) Routers/handlers do transport only
Routers may:
- Validate auth/session context
- Parse request input
- Call service methods
- Return contract-shaped responses

Routers may **not**:
- Execute DB queries
- Build SQL
- Import Drizzle table objects
- Perform business policy decisions
- Contain connector/provider calls

### 2) Services own business logic
Services must:
- Enforce domain rules and policy decisions
- Orchestrate multiple DB calls in a coherent operation
- Call providers/adapters via clean interfaces
- Decide which mapper/DTO shape is returned

Services should not:
- Parse HTTP request objects
- Depend on framework transport types

### 3) DB modules own persistence
`db.ts` modules must contain:
- All DB reads/writes for that domain
- Transaction boundaries
- Necessary raw SQL helpers when unavoidable

`db.ts` modules should not:
- Know about HTTP, websocket, or UI concerns
- Build user-facing response strings

### 4) Mappers own shape conversion
Mapper modules convert:
- DB rows -> domain objects
- Domain objects -> contract DTOs

Mappers should be pure and deterministic.
No network, DB, or side effects inside mappers.

## Canonical file pattern (per domain)
```text
/packages/services/src/<domain>/
  db.ts          # persistence only
  service.ts     # business logic only
  mapper.ts      # row/domain/DTO conversion only
  index.ts       # exports
```

## Concrete domain examples in this repo

```text
packages/services/src/actions/
  db.ts
  service.ts

packages/services/src/integrations/
  db.ts
  service.ts
  tokens.ts        # provider token resolution helper used by service layer

packages/services/src/triggers/
  db.ts
  service.ts
  mapper.ts

packages/services/src/notifications/
  db.ts
  service.ts
```

## Web and Gateway usage pattern

### Web router pattern
```text
apps/web/src/server/routers/*.ts
  -> calls packages/services/src/<domain>/service.ts
```

### Gateway runtime/API pattern
```text
apps/gateway/src/api/*
  -> calls services actions/sessions/integrations APIs
  -> no direct DB queries in route handlers
```

## Core data model ownership rule
All table access still belongs to service `db.ts` modules, even when schemas live in multiple files:
- Sessions/runtime: `packages/db/src/schema/sessions.ts`
- Integrations/connectors: `packages/db/src/schema/integrations.ts`, `packages/db/src/schema/schema.ts` (`orgConnectors`)
- Actions/approvals: `packages/db/src/schema/schema.ts` (`actionInvocations`)
- Triggers/events: `packages/db/src/schema/triggers.ts`
- Billing ledger: `packages/db/src/schema/billing.ts`

## Mapping logic requirements
- Keep contract schemas in `packages/shared/src/contracts`
- Keep field naming consistent across layers (`runAs`, `credentialOwnerType`, etc.)
- Handle nullable/optional fields in mappers, not in UI route handlers
- Centralize timestamp/status normalization in mappers

## Anti-patterns to ban
- Drizzle imports in routers
- `db.select(...)` directly in route files
- Returning raw DB rows to clients
- Copy-pasting mapping logic across routers
- Business policy checks scattered across handlers

## Example: good vs bad

### Bad
- Router validates input, queries DB, checks policy, calls Slack API, formats response

### Good
- Router validates input and calls service
- Service checks policy and calls db + connector + mapper
- DB module does queries only
- Mapper returns stable DTO for router response

## Why this matters
- Easier testing (unit test service and mapper layers independently)
- Safer refactors (transport changes do not break DB logic)
- Better security review (policy logic in one place)
- Cleaner API contracts (no accidental DB leakage)

## Enforcement checklist
- [ ] No DB imports in routers/handlers
- [ ] Every domain has db/service/mapper split
- [ ] Routes return mapped DTOs, not DB rows
- [ ] Policy logic is centralized in services/actions
- [ ] Side-effecting connector calls happen outside router layer
- [ ] OAuth token resolution and MCP secret resolution happen in services, never in routers


---

<!-- Source: 11-streaming-preview-transport-v2.md -->

# Streaming & Preview Transport — System Spec (V2 "AnyRun" Architecture)

**Status:** `ACTIVE_IMPLEMENTATION_SPEC`

**Objective:** A unified, event-driven, zero-trust transport architecture for real-time agent devboxes. This replaces HTTP polling, embedded IDE servers, and direct browser-to-provider routing with a gateway-controlled daemon transport.

## 0. Clean-Slate Mandate

- **VS Code server is removed** from the target architecture.
- **HTTP polling is banned** for runtime freshness surfaces (terminal, changes, services, preview readiness).
- **Browser never sees provider tunnel URLs** (`*.e2b.dev` or equivalent).
- **`sandbox-daemon` replaces `sandbox-mcp` and in-sandbox Caddy** as the runtime transport/control component.

## 1. Transport Topology Decision (Single Source of Truth)

This spec uses one network model for runtime transport:

1. **Browser -> Gateway (Hop 1):**
- Browser uses stable Gateway endpoints only:
- `WSS /v1/sessions/:sessionId/stream`
- `HTTPS /v1/sessions/:sessionId/fs/*`
- `HTTPS :previewPort-:sessionId--preview.<gateway-domain>/*` (wildcard preview host)

2. **Gateway -> Sandbox (Hop 2):**
- Gateway dials sandbox ingress via provider tunnel host.
- For E2B, host is resolved by port using `sandbox.getHost(port)`.
- Gateway signs each request with `X-Proliferate-Sandbox-Signature` (`HMAC(method + path + body_hash + exp + nonce)`).
- `sandbox-daemon` validates signature + expiry + nonce replay cache.

Important:
- This V2 transport **does not** depend on a sandbox-initiated outbound control websocket for runtime readiness.
- Readiness is based on successful signed health check over provider ingress.
- For Kubernetes self-host mode, gateway must route to sandbox-daemon over internal cluster networking (service DNS/pod IP), not per-session public ingress.

## 2. `sandbox-daemon` Responsibilities

`/sandbox-daemon` runs as PID 1 and owns runtime transport.

Process supervision requirement:
- Sandbox runtime must correctly reap child processes and forward signals.
- Acceptable patterns:
  - `tini`/`dumb-init` as PID 1 launching `sandbox-daemon`, or
  - daemon implementation explicitly handling init-style reaping/signal duties.

### 2.1 Unified in-sandbox router (no Caddy)
`/sandbox-daemon` binds to one exposed sandbox port and routes in memory:
- `/_proliferate/pty/*` -> PTY attach/input/replay APIs
- `/_proliferate/fs/*` -> file tree/read/write APIs
- `/_proliferate/events` -> unified event stream feed
- `/*` -> dynamic reverse proxy to active preview app port

No runtime Caddyfile rewrite/reload loop in target architecture.

Preview proxy compatibility requirements:
- Daemon reverse proxy must preserve `Host` and forwarding headers needed by modern dev servers.
- Daemon reverse proxy must support HTTP upgrade and bidirectional websocket proxying for HMR (Vite/Next.js/Fast Refresh).

### 2.2 PTY replay contract
- Per-process ring buffer: max `10,000` lines OR `8MB`.
- Max line length: `16KB` (truncate over limit).
- Reconnect uses `last_seq` for delta replay.
- Cold restart resets daemon buffer; client falls back to durable DB history surfaces.

### 2.3 FS jail contract
- Workspace root is canonicalized by `realpath`.
- Reject null byte paths.
- Resolve target via workspace-relative path.
- Reject traversal (`..`) and absolute escapes.
- Re-check resolved symlink targets under workspace before read/write.
- `/fs/write` max payload: `10MB`.

### 2.4 Dynamic preview port discovery
- Preferred path: harness/runner explicitly registers preview intent with daemon (port + intent metadata).
- Fallback path: daemon polls `ss -tln` every `500ms` when explicit registration is unavailable.
- Track safe candidate ports and select active preview target with stability gating.
- Only proxy allowlisted preview port ranges by policy (default `3000-9999`).
- Never proxy denylisted infra/internal ports (`22`, `2375`, `2376`, `4096`, `26500`) even if in range.
- Emit `port_opened` only after stability window/health check to avoid short-lived test-port flicker.
- Emit `port_closed` on durable closure.
- Gateway maps preview requests by host pattern (`:previewPort-:sessionId--preview`) to target session and safe port.

### 2.5 Daemon runtime modes
- `sandbox-daemon --mode=worker`:
  - Full PTY + FS + preview port watchers + agent stream ingestion.
- `sandbox-daemon --mode=manager`:
  - Minimal transport/control mode for lean manager sandboxes.
  - No FS watcher and no preview port watcher loops by default.

## 3. Unified Event Protocol

All runtime streams are multiplexed through one versioned envelope:

```json
{
  "v": "1",
  "stream": "pty_out | fs_change | agent_event | port_opened | sys_event",
  "seq": 1045,
  "event": "data | close | error",
  "payload": { "text": "npm install complete\\n" },
  "ts": 1708123456789
}
```

Backpressure:
- Per-client queue cap in Gateway: `1000` messages OR `2MB`.
- On overflow, disconnect slow consumer (`1011`) without affecting other viewers.

Gateway horizontal scale contract:
- Separate control-plane and data-plane streaming:
  - Control-plane events (invocation status, approvals, session state) may use shared backplane.
  - Data-plane events (`pty_out` and other high-frequency runtime streams) stay on session owner gateway path.
- Multiple gateway replicas require a shared control backplane (Redis Pub/Sub or equivalent).
- Session owner gateway maintains primary daemon data stream attachment.
- Browser connections must resolve to session owner gateway (owner lookup + redirect/proxy/consistent-hash strategy).
- Sticky sessions can improve locality but are not a complete correctness mechanism.
- On owner loss, ownership transfers and new owner reattaches using replay/reconciliation contracts.

Initial hydration requirement:
- Before applying websocket deltas, UI must fetch baseline runtime state:
  - `GET /v1/sessions/:id/fs/tree`
  - `GET /v1/sessions/:id/preview/ports`
- Websocket events are deltas layered on top of this baseline.

Reconnect reconciliation requirement:
- On daemon/harness reconnect after pause/resume, runtime must fetch pending invocation outcomes from gateway (for example approvals resolved while sandbox slept).
- Resume correctness must not depend solely on in-flight websocket push events.

## 4. E2B-Specific Contracts (from docs)

### 4.1 Ingress host resolution
- E2B requires explicit port host resolution (`getHost(port)`).
- Gateway resolves host by daemon ingress port for runtime transport.
- Preview traffic is routed through daemon reverse-proxy path on the same ingress endpoint.

### 4.2 Pause/resume behavior
- `betaPause()` persists filesystem + memory state.
- Reconnect via `connect()` resumes paused sandbox.
- While paused, in-sandbox services are unreachable and client connections are dropped.
- After resume, clients must re-establish stream/proxy connections.

### 4.3 Auto-pause
- Auto-pause may be enabled for idle cost control.
- Default idle timeout for this spec pack is `10m`.
- Gateway/runtime must treat paused sandboxes as expected reconnect events, not hard failures.

## 5. Provider Contract (Agnostic, but strict)

Any provider used with this architecture must support:
- inbound HTTP/WS tunnel to sandbox daemon port,
- websocket upgrades,
- low-latency request/response for interactive transport.

If provider cannot satisfy these transport primitives, it is out of contract.

Kubernetes self-host contract:
- Gateway must run in the same cluster/VPC network plane as sandbox pods.
- Gateway reaches sandbox-daemon via internal addresses (K8s Service DNS or pod IP), without dynamic external ingress objects per session.

## 6. Billing and Telemetry Intercept Requirements

Gateway is not a dumb pipe. `event-processor` must extract runtime telemetry from `agent_event` frames for UX/observability and compute lifecycle accounting.

Metering contract:
- LLM token billing truth is owned by LiteLLM spend ingestion (`15-llm-proxy-architecture.md`).
- Gateway stream frames must not be the source-of-truth for billable token usage.
- Gateway records compute lifecycle cut points and correlation metadata.

On terminal/final state, Gateway writes compute-side billing outbox/event rows for worker reconciliation.

## 7. Success Metrics (SLOs)

Measured at Gateway with OpenTelemetry, aggregated in Datadog/Prometheus (rolling 5-minute windows):

1. Attach time (`p95`) < `150ms`
2. PTY replay recovery (`p95`) < `100ms`
3. FS read roundtrip (`p95`) < `150ms`
4. FS change -> UI event delivery (`p95`) < `50ms`
5. Idle memory reduction vs old code-server baseline > `150MB`

## 8. Implementation File Map (Target-State Owners)

```text
apps/gateway/src/
  api/proliferate/ws/           # unified stream endpoint
  api/proxy/                    # fs/preview/terminal proxy surfaces
  api/proliferate/http/         # runtime reconciliation endpoints
  hub/session-runtime.ts        # runtime ensure + reconnect
  hub/event-processor.ts        # event normalization + metering intercept
  hub/backplane.ts              # cross-replica stream fanout

packages/shared/src/providers/
  e2b.ts                        # provider tunnel host resolution
  modal-libmodal.ts             # alternate provider parity

packages/sandbox-daemon/        # new daemon package (replaces sandbox-mcp)
  src/server.ts
  src/pty.ts
  src/fs.ts
  src/ports.ts
  src/router.ts
```

## 9. Core Data Model Surfaces

| Model | Why transport cares | File |
|---|---|---|
| `sessions` | runtime tunnel/daemon metadata, status, reconnect context | `packages/db/src/schema/sessions.ts` |
| `action_invocations` | streamed approval/completion transitions | `packages/db/src/schema/schema.ts` (`actionInvocations`) |
| `automation_runs` | streamed long-running run updates | `packages/db/src/schema/schema.ts` (`automationRuns`) |
| `billing_events` | transport-level usage metering persistence | `packages/db/src/schema/billing.ts` |


---

<!-- Source: 12-reference-index-files-and-models.md -->

# Reference Index: Files and Data Models

## Purpose
This index is the enforcement layer for "fully referenced" specs.

Use this to verify that each subsystem spec points to concrete implementation files and concrete data models.

## 1) System map

Spec:
- [00-system-file-tree.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/00-system-file-tree.md)

Primary implementation files:
- `/Users/pablo/proliferate/apps/web/src/server/routers/actions.ts`
- `/Users/pablo/proliferate/apps/web/src/server/routers/automations.ts`
- `/Users/pablo/proliferate/apps/web/src/server/routers/integrations.ts`
- `/Users/pablo/proliferate/apps/web/src/server/routers/sessions.ts`
- `/Users/pablo/proliferate/apps/web/src/server/routers/triggers.ts`
- `/Users/pablo/proliferate/apps/gateway/src/hub/session-hub.ts`
- `/Users/pablo/proliferate/apps/gateway/src/hub/session-runtime.ts`
- `/Users/pablo/proliferate/apps/worker/src/automation/index.ts`
- `/Users/pablo/proliferate/apps/trigger-service/src/api/webhooks.ts`

Primary data models:
- `sessions` (`packages/db/src/schema/sessions.ts`)
- `automations` (`packages/db/src/schema/automations.ts`)
- `triggers`, `trigger_events` (`packages/db/src/schema/triggers.ts`)
- `integrations`, `repo_connections` (`packages/db/src/schema/integrations.ts`)
- `action_invocations`, `org_connectors`, `outbox` (`packages/db/src/schema/schema.ts`)
- `billing_events` (`packages/db/src/schema/billing.ts`)

## 2) Required functionality and UX

Spec:
- [01-required-functionality-and-ux.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/01-required-functionality-and-ux.md)

Primary implementation files:
- `/Users/pablo/proliferate/apps/web/src/server/routers/automations.ts`
- `/Users/pablo/proliferate/apps/web/src/server/routers/sessions.ts`
- `/Users/pablo/proliferate/apps/gateway/src/hub/session-runtime.ts`
- `/Users/pablo/proliferate/apps/worker/src/automation/finalizer.ts`

Primary data models:
- `automations`, `sessions`, `triggers`, `trigger_events`
- `action_invocations`, `outbox`, `org_connectors`
- `session_notification_subscriptions`

## 3) E2B interface and usage

Spec:
- [02-e2b-interface-and-usage.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/02-e2b-interface-and-usage.md)

Primary implementation files:
- `/Users/pablo/proliferate/packages/shared/src/providers/e2b.ts`
- `/Users/pablo/proliferate/packages/shared/src/providers/index.ts`
- `/Users/pablo/proliferate/packages/shared/src/snapshot-resolution.ts`
- `/Users/pablo/proliferate/apps/gateway/src/hub/session-runtime.ts`

Primary data models:
- `sessions`
- `configurations`
- `repos`

## 4) Actions, OAuth, MCP, and org usage

Spec:
- [03-action-registry-and-org-usage.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/03-action-registry-and-org-usage.md)

Primary implementation files:
- `/Users/pablo/proliferate/apps/gateway/src/api/proliferate/http/actions.ts`
- `/Users/pablo/proliferate/packages/services/src/actions/service.ts`
- `/Users/pablo/proliferate/packages/services/src/actions/db.ts`
- `/Users/pablo/proliferate/packages/services/src/actions/modes.ts`
- `/Users/pablo/proliferate/packages/services/src/actions/connectors/`
- `/Users/pablo/proliferate/packages/services/src/integrations/tokens.ts`
- `/Users/pablo/proliferate/packages/services/src/connectors/service.ts`
- `/Users/pablo/proliferate/packages/services/src/secrets/service.ts`

Primary data models:
- `action_invocations`
- `integrations`
- `org_connectors`
- `organization.action_modes`
- `automations.action_modes`
- `outbox`
- `sessions` (for session-scoped git/identity context and audit linkage)

## 5) Long-running coworkers

Spec:
- [04-long-running-agents.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/04-long-running-agents.md)

Primary implementation files:
- `/Users/pablo/proliferate/apps/worker/src/automation/index.ts`
- `/Users/pablo/proliferate/apps/worker/src/automation/resolve-target.ts`
- `/Users/pablo/proliferate/apps/worker/src/automation/finalizer.ts`
- `/Users/pablo/proliferate/apps/trigger-service/src/polling/worker.ts`
- `/Users/pablo/proliferate/packages/services/src/runs/service.ts`

Primary data models:
- `automations`
- `triggers`, `trigger_events`
- `automation_runs`
- `sessions`
- `outbox`

## 6) Trigger services

Spec:
- [05-trigger-services.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/05-trigger-services.md)

Primary implementation files:
- `/Users/pablo/proliferate/apps/trigger-service/src/api/webhooks.ts`
- `/Users/pablo/proliferate/apps/trigger-service/src/webhook-inbox/worker.ts`
- `/Users/pablo/proliferate/apps/trigger-service/src/polling/worker.ts`
- `/Users/pablo/proliferate/packages/services/src/triggers/service.ts`
- `/Users/pablo/proliferate/packages/services/src/triggers/db.ts`
- `/Users/pablo/proliferate/packages/services/src/webhook-inbox/db.ts`

Primary data models:
- `triggers`
- `trigger_events`
- `trigger_event_actions`
- `trigger_poll_groups`
- `webhook_inbox`

## 7) Gateway runtime

Spec:
- [06-gateway-functionality.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/06-gateway-functionality.md)

Primary implementation files:
- `/Users/pablo/proliferate/apps/gateway/src/hub/session-hub.ts`
- `/Users/pablo/proliferate/apps/gateway/src/hub/session-runtime.ts`
- `/Users/pablo/proliferate/apps/gateway/src/hub/event-processor.ts`
- `/Users/pablo/proliferate/apps/gateway/src/api/proliferate/http/actions.ts`
- `/Users/pablo/proliferate/apps/gateway/src/api/proliferate/http/tools.ts`

Primary data models:
- `sessions`
- `action_invocations`
- `integrations`, `org_connectors`
- `outbox`

## 8) Cloud billing

Spec:
- [07-cloud-billing.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/07-cloud-billing.md)

Primary implementation files:
- `/Users/pablo/proliferate/apps/web/src/server/routers/billing.ts`
- `/Users/pablo/proliferate/apps/worker/src/billing/worker.ts`
- `/Users/pablo/proliferate/apps/worker/src/jobs/billing/outbox.job.ts`
- `/Users/pablo/proliferate/packages/services/src/billing/metering.ts`
- `/Users/pablo/proliferate/packages/services/src/billing/gate.ts`

Primary data models:
- `billing_events`
- `llm_spend_cursors`
- `billing_reconciliations`
- `sessions` (metering context)

## 9) Coding harnesses

Spec:
- [08-coding-agent-harnesses.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/08-coding-agent-harnesses.md)

Primary implementation files:
- `/Users/pablo/proliferate/packages/shared/src/sandbox/opencode.ts`
- `/Users/pablo/proliferate/packages/shared/src/sandbox/config.ts`
- `/Users/pablo/proliferate/packages/shared/src/opencode-tools/index.ts`
- `/Users/pablo/proliferate/apps/gateway/src/api/proliferate/http/tools.ts`

Primary data models:
- `sessions`
- `action_invocations`
- `integrations`, `org_connectors`
- `outbox`

## 10) Notifications

Spec:
- [09-notifications.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/09-notifications.md)

Primary implementation files:
- `/Users/pablo/proliferate/packages/services/src/notifications/service.ts`
- `/Users/pablo/proliferate/packages/services/src/notifications/db.ts`
- `/Users/pablo/proliferate/packages/services/src/outbox/service.ts`
- `/Users/pablo/proliferate/apps/worker/src/automation/notifications.ts`

Primary data models:
- `outbox`
- `session_notification_subscriptions`
- `automations.notification_*`
- `automation_runs`, `sessions`

## 11) Layering and mapping

Spec:
- [10-layering-and-mapping-rules.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/10-layering-and-mapping-rules.md)

Primary implementation files:
- `/Users/pablo/proliferate/apps/web/src/server/routers/*`
- `/Users/pablo/proliferate/apps/gateway/src/api/*`
- `/Users/pablo/proliferate/packages/services/src/**/service.ts`
- `/Users/pablo/proliferate/packages/services/src/**/db.ts`
- `/Users/pablo/proliferate/packages/services/src/**/mapper.ts`

Primary data model ownership map:
- Sessions/runtime -> `packages/db/src/schema/sessions.ts`
- Integrations/connectors -> `packages/db/src/schema/integrations.ts`, `packages/db/src/schema/schema.ts`
- Actions/approvals -> `packages/db/src/schema/schema.ts`
- Triggers/events -> `packages/db/src/schema/triggers.ts`
- Billing -> `packages/db/src/schema/billing.ts`

## 12) Streaming and preview transport

Spec:
- [11-streaming-preview-transport-v2.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/11-streaming-preview-transport-v2.md)

Primary implementation files:
- `/Users/pablo/proliferate/apps/gateway/src/api/proliferate/ws/`
- `/Users/pablo/proliferate/apps/gateway/src/api/proxy/`
- `/Users/pablo/proliferate/apps/gateway/src/hub/session-runtime.ts`
- `/Users/pablo/proliferate/packages/shared/src/providers/e2b.ts`
- `/Users/pablo/proliferate/packages/sandbox-daemon/`

Primary data models:
- `sessions`
- `action_invocations`
- `automation_runs`
- `billing_events`

## 13) Self-hosting and updates

Spec:
- [13-self-hosting-and-updates.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/13-self-hosting-and-updates.md)

Primary implementation files:
- `/Users/pablo/proliferate/charts/proliferate/`
- `/Users/pablo/proliferate/infra/pulumi-k8s/`
- `/Users/pablo/proliferate/infra/pulumi-k8s-gcp/`
- `/Users/pablo/proliferate/packages/environment/src/schema.ts`
- `/Users/pablo/proliferate/packages/db/drizzle/`

Primary data models:
- `sessions`
- `action_invocations`
- `automation_runs`
- `outbox`
- `billing_events`

## 14) Boot snapshot contract

Spec:
- [14-boot-snapshot-contract.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/14-boot-snapshot-contract.md)

Primary implementation files:
- `/Users/pablo/proliferate/apps/gateway/src/hub/session-runtime.ts`
- `/Users/pablo/proliferate/apps/gateway/src/api/proliferate/http/actions.ts`
- `/Users/pablo/proliferate/packages/services/src/actions/service.ts`
- `/Users/pablo/proliferate/packages/services/src/sessions/service.ts`

Primary data models:
- `sessions`
- `automation_runs`
- `action_invocations`
- env bundle reference fields resolved at runtime (see `14-boot-snapshot-contract.md`)

## 15) LLM proxy architecture

Spec:
- [15-llm-proxy-architecture.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/15-llm-proxy-architecture.md)

Primary implementation files:
- `/Users/pablo/proliferate/apps/llm-proxy/litellm/config.yaml`
- `/Users/pablo/proliferate/apps/llm-proxy/Dockerfile`
- `/Users/pablo/proliferate/packages/shared/src/llm-proxy.ts`
- `/Users/pablo/proliferate/packages/services/src/sessions/sandbox-env.ts`
- `/Users/pablo/proliferate/packages/services/src/billing/litellm-api.ts`
- `/Users/pablo/proliferate/apps/worker/src/jobs/billing/llm-sync-dispatcher.job.ts`
- `/Users/pablo/proliferate/apps/worker/src/jobs/billing/llm-sync-org.job.ts`

Primary data models:
- `llm_spend_cursors`
- `billing_events`
- `sessions`
- `organization`

## Reference quality checklist
- Every subsystem spec includes an implementation file-tree section.
- Every subsystem spec includes core data-model references.
- All action/integration/security claims reference service and schema files.
- Router specs keep transport-only boundaries explicit.


---

<!-- Source: 13-self-hosting-and-updates.md -->

# Self-Hosting and Update Strategy

## Goal
Define how Proliferate is deployed, upgraded, and operated outside managed cloud, without ambiguity.

This is a product requirement, not only infra detail.

## Deployment modes

### A) Managed cloud (default)
- Proliferate team operates web, gateway, worker, trigger-service, DB, and billing stack.
- Customer connects integrations and uses hosted runtime.

### B) Self-host Docker
- Customer runs platform services via Docker Compose or equivalent container runtime.
- Best for single-team/self-managed deployments.
- Provider choice remains configurable.

### C) Self-host Kubernetes
- Customer deploys platform services in Kubernetes (Helm + Postgres + Redis baseline).
- Best for multi-team and stricter SRE controls.

Kubernetes runtime networking contract:
- Gateway and sandbox pods must run inside the same cluster/VPC trust boundary.
- Gateway connects to sandbox-daemon via internal cluster routing (Service DNS or pod IP).
- Do not depend on creating external ingress resources per short-lived session pod.
- Browser traffic still goes only to web/gateway ingress; browser never connects directly to sandbox pods.

Kubernetes state persistence contract:
- Worker coding sessions that need pause/resume parity must mount a session-scoped PVC at `/workspace`.
- When a worker pod idles out, pod may be destroyed but PVC remains bound to `sessionId`.
- Resume path must reattach the same PVC before continuing work.
- Lean manager sessions are ephemeral by default and do not require PVC persistence unless explicitly configured.

AZ/zone scheduling safety (required for RWO volumes):
- If storage class is zonal + `ReadWriteOnce` (EBS/PersistentDisk), resume scheduling must honor PVC zone affinity.
- Resume controller must schedule replacement pod in the same zone as the bound PVC.
- If same-zone scheduling cannot be guaranteed, operators must use RWX-capable shared storage (for example EFS/Filestore) for session workspaces.
- Avoid ambiguous cross-zone resume behavior that can deadlock pod attach in `ContainerCreating`.

Unschedulable fallback (required):
- If resume pod cannot schedule/attach due to PVC affinity or volume attach failures beyond bounded timeout (default `3m`), system must trigger controlled fallback:
  1. Mark trapped resume attempt as degraded with reason.
  2. Tombstone old session runtime binding (retain audit trail).
  3. Start fresh sandbox in healthy zone/node pool.
  4. Rehydrate from durable control-plane state (`boot_snapshot`, repo state, and persisted run context), then continue.
- This fallback must be explicit and observable in run/session timeline to avoid silent state loss.

### D) Enterprise controlled environment
- Same as self-host, with stricter network/policy constraints.
- Customer controls ingress, secrets manager, observability stack, and upgrade windows.

## V1 support matrix

| Mode | Support status | Notes |
|---|---|---|
| Managed cloud | Supported | Default customer path |
| Self-host Docker | Supported | Fastest self-host path |
| Self-host Kubernetes | Supported | Recommended for larger orgs |

## Implementation file tree (self-host and update surfaces)

```text
charts/proliferate/                    # Helm chart for app services
infra/pulumi-k8s/                      # AWS EKS IaC
infra/pulumi-k8s-gcp/                  # GKE IaC
packages/environment/src/schema.ts     # canonical env var schema
packages/db/drizzle/                   # DB migrations
apps/web/src/server/routers/admin.ts   # admin/update runtime controls (where applicable)
```

Operational references:
- `/Users/pablo/proliferate/docs/specs/sandbox-providers.md`
- `/Users/pablo/proliferate/docs/specs/billing-metering.md`

## Runtime architecture expectations for self-host

Required services:
- `web` (UI + API routers)
- `gateway` (runtime stream + action boundary)
- `worker` (async orchestration)
- `trigger-service` (webhook and polling ingestion)
- Postgres (durable state)
- Redis (queues/coordination where configured)

Optional/external:
- E2B/Modal provider endpoints
- external observability stack
- customer-managed secrets manager (recommended)

## Update channels

### Application versioning
- Container images are versioned by semver tag and immutable digest.
- Helm values pin explicit image tags for each service.

### Database versioning
- All schema changes must ship as forward migrations in `packages/db/drizzle/`.
- App version compatibility matrix:
  - `N` app supports schema `N` and `N-1` during rolling deploy window.
  - destructive migration steps require explicit release notes + operator action.

### Config versioning
- Env schema changes are tracked in `packages/environment/src/schema.ts`.
- Breaking env changes require startup validation errors with actionable messaging.

## Upgrade process (self-host operator runbook)

1. Preflight:
- Validate target version compatibility notes.
- Backup Postgres and critical object storage artifacts.
- Verify secrets and env var schema compatibility.

2. Schema migration:
- Apply DB migrations first.
- Confirm migration health and lock duration bounds.

3. Service rollout:
- Roll `worker` + `trigger-service` first (consumer compatibility).
- Roll `gateway` next.
- Roll `web` last.

4. Post-deploy checks:
- Session create/pause/resume smoke test.
- Action invoke/approval flow smoke test.
- Trigger ingestion and outbox dispatch smoke test.
- Billing event pipeline health check.

5. Rollback:
- Rollback app images to previous version.
- DB rollback only if release notes explicitly declare reversible migration path.

## Self-hosting support for E2B-specific patterns

If operator chooses E2B as provider:
- Runtime uses provider host resolution per port (`getHost(port)` semantics).
- Paused sandboxes drop active network streams; gateway reconnect behavior is mandatory.
- Snapshot/pause behavior should be treated as optimization, not correctness source.

(Reference obtained from E2B docs via Context7.)

## Security requirements for self-host

- No direct browser-to-sandbox tunnel exposure.
- Gateway remains mandatory policy and auth boundary.
- Secret sources should be pluggable (K8s secrets, external secret manager).
- Audit tables must remain enabled and queryable in all deployment modes.

## Core data models impacted by upgrades

| Model | Upgrade sensitivity | File |
|---|---|---|
| `sessions` | runtime compatibility, status transitions, reconnect behavior | `packages/db/src/schema/sessions.ts` |
| `action_invocations` | approval and action replay correctness | `packages/db/src/schema/schema.ts` (`actionInvocations`) |
| `automation_runs` | long-running orchestration continuity | `packages/db/src/schema/schema.ts` (`automationRuns`) |
| `outbox` | delivery reliability across deploys | `packages/db/src/schema/schema.ts` (`outbox`) |
| `billing_events` | financial correctness during rollouts | `packages/db/src/schema/billing.ts` |

## Definition of done checklist
- [ ] Self-host deployment topology is documented and reproducible
- [ ] Upgrade order and rollback policy are explicitly defined
- [ ] DB migration compatibility contract is documented
- [ ] Health checks cover runtime, actions, triggers, and billing paths
- [ ] Security boundary remains identical in cloud and self-host modes


---

<!-- Source: 14-boot-snapshot-contract.md -->

# Boot Snapshot Contract

## Goal
Make run-time behavior deterministic by freezing critical execution context when a session/run starts.

Without this, live config edits can silently change in-flight behavior and break auditability.

## Scope
In scope:
- what is frozen at start
- where it is stored
- what is mutable after start
- how gateway/actions enforce it
- how environment references are represented safely

Out of scope:
- prompt engineering details
- sandbox provider snapshot internals

## Snapshot record location

Target contract:
- `boot_snapshot` is stored on session/run record as JSON (or side table keyed by session/run id).
- Gateway and action execution read from `boot_snapshot`, not mutable live coworker row.
- `boot_snapshot` is execution context only (not filesystem/memory checkpoint state).

Current related runtime store:
- `sessions.agentConfig`, `sessions.systemPrompt` in `/Users/pablo/proliferate/packages/db/src/schema/sessions.ts`.

## Required snapshot schema (logical)

```json
{
  "snapshotVersion": 1,
  "createdAt": "2026-02-27T00:00:00Z",
  "sessionId": "...",
  "runId": "...",
  "identity": {
    "actorUserId": "...",
    "requestedRunAs": "actor_user | org_system | explicit_user",
    "credentialOwnerPolicy": "prefer_user | prefer_org | strict_user | strict_org"
  },
  "model": {
    "provider": "anthropic",
    "modelId": "claude-sonnet-4-20250514",
    "temperature": 0.2
  },
  "instructions": {
    "systemPrompt": "...",
    "agentInstructions": "..."
  },
  "tooling": {
    "enabledTools": ["..."] ,
    "actionModeOverrides": {
      "linear:update_issue": "require_approval"
    },
    "connectorBindings": ["connector:uuid-1"]
  },
  "workspace": {
    "repoId": "...",
    "branch": "...",
    "baseCommit": "...",
    "configurationId": "...",
    "snapshotId": "..."
  },
  "compute": {
    "provider": "e2b",
    "templateId": "tpl_abc123",
    "imageDigest": "sha256:..."
  },
  "git": {
    "prOwnershipMode": "sandbox_pr"
  },
  "environment": {
    "envBundleRef": "env_bundle_uuid",
    "envBundleVersion": 3,
    "envDigest": "sha256:..."
  },
  "limits": {
    "maxDurationMs": 3600000,
    "maxConcurrentChildren": 3,
    "budgetCents": 500
  }
}
```

## Environment and secret boundary (required)

- `.env.local` (development env) is allowed as onboarding input.
- Raw `.env.local` values are persisted as encrypted env bundle records.
- `boot_snapshot` stores only references (`envBundleRef`, version, digest), never plaintext env values.
- Short-lived runtime credentials (for example GitHub installation tokens, session virtual LLM keys) are never persisted in `boot_snapshot`.
- Action/integration secrets (OAuth tokens, connector secrets) are not part of env bundle or boot snapshot payload.
- Runtime boot resolves env bundle values just-in-time through daemon-scoped secret context.
- Runtime boot/resume must hydrate fresh short-lived credentials from control plane; snapshot only stores credential policy/context, not token material.
- Avoid exporting env bundles as global shell environment for unrelated sandbox processes.
- Optional compatibility mode may materialize an app-scoped `.env` file in workspace (excluded from VCS) when required by local tooling.

## Enforcement rules

1. Action invocation policy resolution must use snapshot identity + mode context.
2. Credential owner resolution must use snapshot policy defaults.
3. Tool availability in runtime must be subset of snapshot-enabled tools.
4. Mid-run edits to coworker config do not affect current run; they apply to next run only.
5. `boot_snapshot` writes must reject plaintext secret keys/values and only accept env references.
6. PR ownership mode is frozen per run (`sandbox_pr` or `gateway_pr`) and cannot mutate mid-run.
7. Resume/restart must request the pinned compute identity (`provider`, `templateId`, `imageDigest`) for reproducible runtime behavior.
8. Resume/restart must refresh short-lived credentials dynamically; replaying stale credential values from snapshot is forbidden.

Live-security override rule (TOCTOU safety):
- Frozen snapshot does not bypass live org security controls.
- At execution time, gateway/services must re-check live revocation/disablement state for integrations and credentials.
- Live revocations override frozen snapshot permissions immediately.

## Mutable vs immutable during run

Immutable for current run:
- run identity policy (`run_as`, credential owner policy)
- model and system prompt
- enabled tool set and action-mode override baseline
- workspace baseline ref (`repo/config/snapshot`) at run start
- compute baseline (`provider/templateId/imageDigest`)

Mutable during run:
- live progress summary/status
- emitted artifacts
- approval outcomes and invocation statuses
- retry counters and transient runtime state

## Size and retention constraints

- Target max snapshot payload size: `64KB` compressed JSON equivalent.
- Store full snapshot for audit retention window equal to session/run retention policy.
- If snapshot is externalized to object storage, DB must store stable reference + digest.

## Core files that consume this contract

- `/Users/pablo/proliferate/apps/gateway/src/hub/session-runtime.ts`
- `/Users/pablo/proliferate/apps/gateway/src/api/proliferate/http/actions.ts`
- `/Users/pablo/proliferate/packages/services/src/actions/service.ts`
- `/Users/pablo/proliferate/packages/services/src/sessions/service.ts`

## Core data models

| Model | Contract relevance | File |
|---|---|---|
| `sessions` | stores frozen execution context for session-scoped runs | `packages/db/src/schema/sessions.ts` |
| `automation_runs` | stores frozen context for automation execution runs | `packages/db/src/schema/schema.ts` (`automationRuns`) |
| `action_invocations` | records behavior evaluated under snapshot context | `packages/db/src/schema/schema.ts` (`actionInvocations`) |

## Definition of done checklist
- [ ] Snapshot schema is defined and versioned
- [ ] Snapshot is persisted at run/session creation
- [ ] Gateway/actions read frozen snapshot context during execution
- [ ] Mid-run config edits do not alter in-flight permissions/tools/model
- [ ] Snapshot retention and size policy are documented and enforced


---

<!-- Source: 15-llm-proxy-architecture.md -->

# LLM Proxy Architecture (V1)

## Goal
Define a stable, production-safe LLM proxy architecture for V1 that matches the existing Proliferate LiteLLM pattern:
- short-lived virtual keys for sandbox traffic
- server-side control-plane key management
- durable spend ingestion into billing events
- model routing compatibility with OpenCode/runtime config

This spec intentionally follows the old/current architecture rather than inventing a new proxy stack.

## Scope
In scope:
- Session virtual key generation/revocation flow
- Team/org mapping in proxy
- Sandbox URL/key injection contract
- Spend sync contract and cursor semantics
- Model routing contract (canonical model -> proxy model mapping)
- Self-host deployment expectations for proxy

Out of scope:
- Pricing strategy and credit policy details (see `07-cloud-billing.md`)
- Session lifecycle orchestration beyond env/key contract
- Secret storage internals outside referenced services

## High-level architecture (existing pattern)

```text
Sandbox/OpenCode --(virtual key + base URL)--> LiteLLM Proxy --> Provider APIs
       ^                                              |
       |                                              v
Gateway/Services --(master key admin APIs)--> key/team mgmt + spend logs
```

Control-plane plane:
- Uses proxy admin endpoints with master key
- Creates team if needed
- Mints short-lived session key
- Reads spend logs for billing sync

Sandbox data plane:
- Uses only session virtual key
- Never receives proxy master key
- Sends model requests through proxy base URL

## File tree and ownership

```text
apps/llm-proxy/
  litellm/config.yaml                # model/provider routing config
  Dockerfile                         # proxy image build
  README.md                          # runtime/deploy notes

packages/shared/src/
  llm-proxy.ts                       # key generation, team ensure, URL helpers, revoke

packages/services/src/sessions/
  sandbox-env.ts                     # sandbox env assembly, proxy key injection

packages/services/src/billing/
  litellm-api.ts                     # spend/logs REST client
  db.ts                              # llm spend cursor persistence

apps/worker/src/jobs/billing/
  llm-sync-dispatcher.job.ts         # org fanout
  llm-sync-org.job.ts                # per-org spend ingestion
```

## Core data models

| Model | Purpose | File |
|---|---|---|
| `llm_spend_cursors` | Per-org incremental spend cursor | `packages/db/src/schema/billing.ts` |
| `billing_events` | Durable billable usage entries | `packages/db/src/schema/billing.ts` |
| `sessions` | Session identity for key scoping/audit linkage | `packages/db/src/schema/sessions.ts` |
| `organization` | Team/org identity and billing state | `packages/db/src/schema/schema.ts` |

## Runtime contract

### 1) Session key generation
When runtime boots or resumes:
1. Ensure proxy team exists for org (`team_id = organizationId`)
2. Generate fresh short-lived virtual key (`user_id = sessionId`, alias bound to session)
3. Inject proxy base URL + virtual key into sandbox runtime env
4. Attach synchronous budget/rate limits to virtual key (org/session policy)

Rules:
- Duration defaults from `LLM_PROXY_KEY_DURATION` (or sensible default)
- Replace/revoke prior alias key for same session when regenerating (boot or resume)
- Fail fast if proxy is required and key generation fails
- Key-level budget/rate limits must be set at issuance time for real-time enforcement (not only async billing)
- Expired virtual keys must never be revived from persisted snapshot/env state.

### 2) Sandbox env injection
Preferred secure mode:
- `sandbox-daemon` receives session virtual key in daemon-only secret context.
- Daemon exposes local loopback proxy endpoint (for example `127.0.0.1:<port>`) for harness model traffic.
- Harness points `ANTHROPIC_BASE_URL` at local daemon proxy endpoint.
- Harness uses non-sensitive placeholder api key value; real virtual key is attached by daemon when forwarding to LiteLLM.

Compatibility mode (legacy/simple):
- Sandbox process receives `ANTHROPIC_API_KEY` (virtual key) and `ANTHROPIC_BASE_URL` directly.
- Allowed for migration/dev but not preferred for hardened environments.

Sandbox must not receive:
- `LLM_PROXY_MASTER_KEY`
- raw provider long-lived keys when proxy mode is enabled

### 3) Revocation behavior
On pause/termination/enforcement:
- revoke session alias key best-effort
- revocation failure should not block lifecycle transitions

Resume behavior:
- On resume, runtime must request a newly valid session virtual key before first model call.
- `401/invalid_key` from proxy should trigger one controlled refresh path before surfacing hard failure.

### 4) Spend ingestion
Worker pipeline:
1. Dispatcher enqueues org sync jobs
2. Per-org job calls proxy spend logs API (bounded window)
3. Convert rows to idempotent billing events
4. Advance org cursor deterministically

Idempotency:
- use provider request identifiers for dedupe keying (`llm:{request_id}` pattern)
- cursor progression alone is not the sole dedupe guarantee

Billing source-of-truth rule:
- LiteLLM spend ingestion is the sole source-of-truth for billable LLM token usage.
- Gateway runtime stream telemetry may provide realtime usage hints for UX, but must not be used as authoritative token billing.

Real-time budget enforcement rule:
- Async spend ingestion is ledger truth, but budget blocking must occur synchronously in proxy/key enforcement path.
- When key budget is exhausted, proxy rejects requests immediately (for example 429/policy denial).
- Runtime must treat budget-denied responses as terminal or pause-worthy policy events, not transient transport errors.

## URL and environment contract

Required env:
- `LLM_PROXY_URL`
- `LLM_PROXY_MASTER_KEY`

Optional env:
- `LLM_PROXY_PUBLIC_URL` (sandbox-facing URL override)
- `LLM_PROXY_ADMIN_URL` (admin API override)
- `LLM_PROXY_KEY_DURATION`
- `LLM_PROXY_REQUIRED`

URL rules:
- admin calls use admin URL role
- sandbox base URL uses public URL role
- normalize base URL to single `/v1` suffix for SDK/runtime compatibility

## Model routing contract

Three surfaces must stay aligned:
1. Canonical model IDs in shared model catalog
2. OpenCode/provider config generated for sandbox runtime
3. LiteLLM model mapping in `apps/llm-proxy/litellm/config.yaml`

Any model add/change must update all three surfaces in one change.

## Security invariants

- Master key is server-side only.
- Sandbox uses short-lived virtual keys only, preferably via daemon-local proxy indirection.
- Proxy key generation and spend reads are audited and attributable to org/session context.
- No browser client can call proxy admin endpoints directly.
- Budget/rate policy must be enforced at proxy ingress for each virtual key.

## Self-hosting expectations

For self-host customers:
- proxy can run as a separate service/container
- operator supplies provider API keys and proxy master key
- app services use configured proxy admin/public URLs
- billing worker can reach spend logs endpoint

This keeps cloud and self-host behavior aligned with one architecture.

## Definition of done checklist

- [ ] Session startup mints short-lived proxy key and injects sandbox env correctly
- [ ] Proxy master key is never exposed to sandbox/runtime logs
- [ ] Spend sync writes idempotent `billing_events` and advances per-org cursor
- [ ] URL roles (admin/public) are respected and `/v1` normalization is consistent
- [ ] Model routing remains aligned across shared catalog, runtime config, and LiteLLM config
- [ ] Self-host operator has clear required env and deploy contract


---

