# Agent Platform V1 (Combined)

> Auto-generated from `docs/specs/agent-platform-v1/*.md`


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

## V1 product shape
V1 has two main experiences:
1. **Interactive coding runs**: user asks agent to fix/build something now
2. **Persistent background agents**: agent keeps watching a job (for example Sentry), spawns worker runs, and reports progress

## Out of scope for this spec pack
- Full self-host compute runtime (Docker/K8s execution provider)
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
9. [07-cloud-billing.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/07-cloud-billing.md)

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
- Keep harness pluggable (OpenCode default, others possible)


---

<!-- Source: 00-system-file-tree.md -->

# System File Tree (V1)

This is the practical code map for the V1 agent platform.

## Top-level runtime systems
```text
/apps
  /web                 # Product UI + oRPC routes (metadata CRUD)
  /gateway             # Real-time runtime bus + action execution boundary
  /worker              # Background jobs and orchestration
  /trigger-service     # Webhook ingestion and trigger processing

/packages
  /db                  # Schema and migrations
  /services            # Business logic + DB operations
  /shared              # Contracts, sandbox provider impls, opencode tooling
  /triggers            # Trigger provider registry + adapters
  /queue               # Queue wrappers/locking
  /gateway-clients     # Client libs used by web/worker
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


---

<!-- Source: 01-required-functionality-and-ux.md -->

# Required Functionality End to End (Including UX)

## Goal
Ship a usable V1 where teams can:
- Run one-off coding tasks
- Run persistent background engineering agents
- Review outputs and approve risky actions
- Track work in a reliable org dashboard

## User-visible features (must-have)

### A) Interactive coding run
User flow:
1. User opens web app (or Slack/GitHub entry point)
2. User asks for a task (for example: "fix this failing test")
3. Session starts in E2B sandbox
4. Agent edits code, runs checks, produces result
5. User sees PR link, summary, logs/artifacts

Acceptance:
- User can start run in under 1 minute
- Session page shows live progress and persisted history
- Final output includes at least summary + PR link or failure reason
- Final output includes a visual artifact (screenshot or short recording) showing app behavior or test UI state when relevant

### B) Persistent background agent
User flow:
1. User creates agent (for example: "Sentry Auto-Fixer")
2. User connects sources (Sentry + GitHub + Slack)
3. Agent wakes from cron/webhooks, triages, spawns child runs
4. User asks: "what got fixed today?"
5. Agent replies with links to runs/PRs and pending approvals

Acceptance:
- Agent can wake repeatedly without manual restart
- Child runs are tracked with clear status
- User can pause/resume/cancel the persistent agent

### C) Approval workflow
User flow:
1. Agent requests risky action
2. System marks invocation pending approval
3. Approver approves or denies from UI
4. Agent receives decision and continues/halts

Acceptance:
- Approval list is DB-driven (works even if no live stream)
- Every approval/deny has audit row with actor and timestamp

### D) Org dashboard reliability model
The dashboard should:
- Read durable rows first (sessions, invocations, runs)
- Attach to live stream only when user opens detail view

Acceptance:
- Org list pages are usable with stream disconnected
- Session detail page shows both persisted and live updates

## Key UX surfaces

### 1) Mission Control (org-level)
Shows:
- Active background agents
- Running/failed/pending runs
- Approval queue
- Quick links to child runs and PRs

### 2) Agent detail page
Shows:
- Agent config and status
- Last wake time
- Current objective
- Recent outputs and run history

### 3) Session detail page
Shows:
- Live stream (terminal/events)
- Persisted timeline
- Tool/action outputs
- Git state + artifact links

### 4) Approval inbox
Shows:
- Pending action invocations
- Why action was requested
- Approve/deny controls
- Audit trail after decision

## Data model requirements (plain language)
Minimum durable records:
- Agent
- Session
- Run (if distinct from session in V1 implementation)
- Action invocation
- Trigger event
- Inbox event

Plus key links:
- Session belongs to agent
- Invocation belongs to session
- Trigger event can create run/session

Additional immutable runtime record:
- `boot_snapshot` on each session/run, capturing prompt, model, tool grants, and execution identity at start time

Why:
- Running work must not change behavior because someone edits live agent config mid-run
- Audit/replay must reflect what the agent was actually allowed to do at that moment

## Non-goals (for V1)
- General-purpose no-code workflow editor
- Broad non-engineering automation catalog
- Perfect autonomous merge/deploy with zero approvals

## Definition of done checklist
- [ ] Interactive run works from user prompt to reviewable output
- [ ] Persistent agent wakes repeatedly and can spawn child runs
- [ ] Approval queue gates risky actions
- [ ] Org dashboard is DB-first and resilient
- [ ] Session detail combines live stream + persisted outputs
- [ ] Session/run stores immutable `boot_snapshot` at creation time
- [ ] Coding runs publish visual proof artifact in final output bundle


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
3. Provider injects runtime env (session id, gateway URL/token, non-sensitive config)
4. Sandbox starts OpenCode/service process
5. Sandbox PID 1 (`/supervisor`) dials an outbound websocket to Gateway using `BRIDGE_TOKEN`; Gateway authenticates and marks runtime ready

## Pause/Resume flow (E2B)
- Pause:
  - Triggered by idle policy or approval wait
  - Provider pause call executed
  - Session row updated with paused state and snapshot/sandbox reference
- Resume:
  - Provider resume/reconnect by stored id
  - Runtime restarts stream
  - Session continues from durable DB context

## Snapshot/setup strategy (V1)
Use E2B capabilities pragmatically:
- Snapshot is optimization, not correctness dependency
- Correctness comes from DB state + reproducible workspace steps

Recommended V1 behavior:
- On first repo setup, let setup run complete and persist metadata
- For recurring work, resume existing sandbox when possible
- If sandbox missing/expired, rebuild quickly from known setup path
- Use a \"fat\" E2B template for coding runs (Playwright + browser support) so final outputs can include visual proof artifacts

## Security requirements
- Do not inject privileged long-lived tokens into sandbox by default
- Keep gateway action execution server-side
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
- [ ] Runtime readiness is based on outbound sandbox bridge auth, not inbound sandbox control channel


---

<!-- Source: 03-action-registry-and-org-usage.md -->

# Action Registry and Org Usage

## Goal
Create one consistent way for agents to perform side effects (GitHub, Slack, Linear, Sentry, connectors), with policy, approvals, identity, and audit handled in one place.

## Core rule
Every side-effect action goes through gateway action invocation.

Current core files:
- [gateway actions route](/Users/pablo/proliferate/apps/gateway/src/api/proliferate/http/actions.ts)
- [actions service](/Users/pablo/proliferate/packages/services/src/actions/service.ts)
- [actions modes](/Users/pablo/proliferate/packages/services/src/actions/modes.ts)
- [actions db](/Users/pablo/proliferate/packages/services/src/actions/db.ts)

## Action registry model
Each action definition needs:
- `sourceId` (for example `github`, `linear`, `connector:xyz`)
- `actionId` (for example `create_pr`, `add_comment`)
- Input schema (validate params)
- Risk/mode default (`allow`, `require_approval`, `deny`)
- Execution handler (server-side)

Native and connector actions use same invocation pipeline.

## Invocation contract (V1)
Required fields:
- sessionId
- organizationId
- sourceId
- actionId
- params

Identity/control fields:
- actorUserId (nullable)
- automationId (nullable)
- requestedRunAs (`actor_user`, `org_system`, `explicit_user`)
- idempotencyKey
- reason (human-readable)

## Policy resolution model
Resolution order for V1:
1. Hard deny (org policy) always wins
2. Explicit route-level override (org/admin settings)
3. Action default mode
4. Optional per-agent/per-automation stricter override

Risk is a hint for default mode, not full policy engine.

### Parameter-aware policy checks (PBAC-lite)
Policy should evaluate both:
- action type (`sourceId` + `actionId`)
- selected high-risk parameters (for example target branch, environment, destructive flags)

This prevents treating all calls to the same action as equally safe.

## Org vs user credential usage
Separate two questions:
1. Which identity is the run using? (`run_as`)
2. Which credential owner provides the token? (`user` or `org`)

Default behavior:
- Interactive user requests prefer user credential
- Background agents prefer org credential
- Fallback from user -> org only if explicitly allowed

## Audit requirements
Every invocation must persist:
- Who requested
- Effective run-as identity
- Credential owner type used
- Source/action/params summary
- Result status and timestamps
- Approval actor (if required)

Audit row is the source of truth for approvals UI and postmortems.

### Post-approval revalidation (TOCTOU safety)
If an invocation waits for approval, Gateway must re-check before execution:
- token is still valid
- target resource still exists and is in expected state
- policy mode is still allowed for this exact request

If revalidation fails, invocation should move to failed/revalidation-required instead of executing stale parameters.

## Planned credential broker layer
Add runtime layer:
```text
/packages/services/src/credentials
  broker.ts
  access.ts
  types.ts
  providers/
```
This layer resolves and validates credentials before execution. Gateway should call broker, not integration token internals directly.

## Non-goals (V1)
- Full policy language engine
- Fine-grained parameter policy DSL
- Enterprise shared credential pools UI

## Definition of done checklist
- [ ] Single invocation path for native and connector actions
- [ ] Schema validation for action params
- [ ] Mode resolution supports allow/approval/deny
- [ ] run-as and credential-owner are resolved and persisted
- [ ] Approval/deny flows work from durable invocation rows
- [ ] Parameter-aware policy checks exist for key risky action families
- [ ] Approved invocations are revalidated before delayed execution


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
- Runs as an isolated \"lean\" sandbox agent (not inside control-plane Node.js process)
- Durable identity and objective
- Reads inbox (chat, webhook, cron wake) via gateway tools
- Decides what to do next
- Spawns child runs for concrete work

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

## Wake model
Use hybrid wake strategy:
- Webhooks for interactive/near-real-time events (GitHub mentions, Slack)
- Cron polling for periodic batch checks (for example Sentry triage sweep)

Internally both become inbox events.

## Idle/suspend behavior
When agent has no immediate work:
- Persist current state and summary
- Pause sandbox (E2B) or stop safely
- Resume on next wake event

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

## V1 trigger scope
Required:
- GitHub (mentions, issue/PR events, CI signal entrypoints)
- Linear (issue updates/comments)
- Sentry (issue events)
- Slack (mentions/commands)

Optional/later:
- PostHog batch analysis
- Jira parity for enterprise bundles

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
7. Create trigger event + run/session request
8. Dispatch work via outbox/worker pipeline

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

## UX expectations
Users should not configure brittle technical trigger graphs for V1.
They should configure:
- Which sources this agent watches
- Which projects/repos are included
- Poll cadence (if applicable)

## Definition of done checklist
- [ ] Webhook ingestion is durable and async
- [ ] Polling path exists for at least one provider batch source
- [ ] Dedup prevents duplicate run storms
- [ ] Trigger events map cleanly to target agents
- [ ] Trigger failures are visible and retryable


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

### 3) Policy/identity checkpoint
Before side effects:
- Validate action params
- Resolve mode (`allow`, `require_approval`, `deny`)
- Resolve execution identity/credential owner
- Revalidate delayed invocations after approval and before execution

### 4) Durable persistence
- Persist invocation rows and status transitions
- Persist tool/action outputs needed for audit and UI replay

### 5) Live fanout
- Broadcast runtime and invocation updates over websocket
- Allow multi-viewer visibility for same session

## DB-first + stream-attach UX split

### Org and inbox pages
- Read durable tables first
- No streaming dependency for basic visibility

### Session detail page
- Load persisted state first
- Attach websocket stream for live detail

This prevents dashboards from breaking when streams reconnect.

## Failure behavior
Gateway must be explicit about:
- Disconnected runtime
- Invocation pending approval
- Invocation denied
- Provider/integration execution error

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


---

<!-- Source: 07-cloud-billing.md -->

# Billing on Cloud (V1)

## Goal
Bill managed-cloud customers in a way that is simple, explainable, and tied to real agent usage.

Current code anchors:
- [web billing router](/Users/pablo/proliferate/apps/web/src/server/routers/billing.ts)
- [billing services](/Users/pablo/proliferate/packages/services/src/billing)
- [metering](/Users/pablo/proliferate/packages/services/src/billing/metering.ts)

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
- Token usage where available

If exact token metrics are unavailable for a path, meter runtime minutes.

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

## Non-goals (V1)
- Highly complex pricing permutations
- Per-action micro-pricing for every connector
- Full finance-grade cost attribution by every subcomponent

## Definition of done checklist
- [ ] Metering records are durable and queryable
- [ ] Billing UI shows usage and recent billable activity
- [ ] Plan limits are enforced with clear user messaging
- [ ] Invoices/charges can be explained from recorded events


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

This keeps orchestration stable even if harness changes.

## V1 harness mode
Default only:
- OpenCode as coding harness

Relevant code paths:
- [opencode config helpers](/Users/pablo/proliferate/packages/shared/src/sandbox/opencode.ts)
- [opencode tools package](/Users/pablo/proliferate/packages/shared/src/opencode-tools/index.ts)
- [gateway tool route](/Users/pablo/proliferate/apps/gateway/src/api/proliferate/http/tools.ts)

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
Two profiles long-term:
- Coding worker (full code tooling)
- Lean worker (non-coding analysis/orchestration)

V1 can keep one coding profile but should avoid hardcoding harness-specific assumptions into gateway/worker orchestration.

## Security constraints for harnesses
- Harness never receives privileged org tokens by default
- External side effects use gateway action invocation path
- Harness may request actions; gateway decides and executes

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

