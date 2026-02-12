# Automations & Runs — System Spec

## 1. Scope & Purpose

### In Scope
- Automation CRUD and configuration (name, instructions, model, prebuild, notifications)
- Automation connections (integration bindings)
- Run lifecycle state machine: queued → enriching → ready → running → succeeded/failed/needs_human/timed_out
- Run pipeline: enrich → execute → finalize
- Enrichment worker (deterministic context extraction)
- Execution (session creation for runs via gateway SDK)
- Finalization (stale-run reconciliation against session + sandbox liveness)
- Run events log (`automation_run_events`)
- Outbox dispatch (atomic claim, stuck-row recovery, exponential backoff)
- Side effects tracking (`automation_side_effects`)
- Artifact storage (S3 — completion + enrichment JSON)
- Target resolution (which repo/prebuild to use)
- Notification dispatch (Slack channel messages on terminal run states)
- Slack async client (bidirectional session via Slack threads)
- Slack inbound handlers (text, todo, verify, default-tool)
- Slack receiver worker (BullMQ-based message processing)
- Run claiming / manual assignment
- Schedule binding on automations

### Out of Scope
- Trigger ingestion and matching — see `triggers.md`. Handoff point is the `enqueue_enrich` outbox row.
- Tool schemas (`automation.complete`) — see `agent-contract.md` §6.2
- Session runtime mechanics — see `sessions-gateway.md`
- Sandbox boot — see `sandbox-providers.md`
- Slack OAuth and installation — see `integrations.md`
- Schedule CRUD internals — see `triggers.md` (schedules are shared)
- Billing/metering for automation runs — see `billing-metering.md`

### Mental Model

An **automation** is a reusable configuration that describes *what* the agent should do when a trigger fires. A **run** is a single execution of that automation, moving through a pipeline: enrich the trigger context, resolve a target repo/prebuild, create a session, send the prompt, then finalize when the agent calls `automation.complete` or the session terminates.

The pipeline is driven by an **outbox** pattern: stages enqueue the next stage's work via the `outbox` table, and a poller dispatches items to BullMQ queues. This decouples stages and provides at-least-once delivery with retry. Only `createRunFromTriggerEvent` and `completeRun` write outbox rows in the same transaction as status updates; the enrichment flow writes status, outbox, and artifact entries as separate sequential calls (`apps/worker/src/automation/index.ts:114-134`).

**Core entities:**
- **Automation** — org-scoped configuration with agent instructions, model, default prebuild, notification settings. Owns triggers and connections.
- **Run** (`automation_runs`) — a single pipeline execution. Tracks status, timestamps, lease, session reference, completion, enrichment, and assignment.
- **Outbox** (`outbox`) — transactional outbox table for reliable dispatch between pipeline stages.
- **Run event** (`automation_run_events`) — append-only audit log of status transitions and milestones.
- **Side effect** (`automation_side_effects`) — idempotent record of external actions taken during a run. Table and service exist but have no callsites in the current run pipeline (see §9).

**Key invariants:**
- A run is always tied to exactly one trigger event (unique index on `trigger_event_id`).
- Runs are claimed via lease-based concurrency control (`lease_owner`, `lease_expires_at`, `lease_version`).
- The outbox guarantees at-least-once delivery: stuck rows are recovered after 5 min, retried up to 5 times with exponential backoff.
- The `completion_id` on a run is an idempotency key — duplicate completions with the same ID are safe.

---

## 2. Core Concepts

### Outbox Pattern
All inter-stage communication flows through the `outbox` table. Workers insert outbox rows (ideally in the same transaction as status updates — see §1 for which stages achieve this), a poller claims them atomically via `SELECT ... FOR UPDATE SKIP LOCKED`, and dispatches to BullMQ queues or inline handlers.
- Key detail agents get wrong: the outbox is not a queue — it's a database table polled every 2 seconds. BullMQ queues are downstream consumers.
- Reference: `packages/services/src/outbox/service.ts`, `apps/worker/src/automation/index.ts:dispatchOutbox`

### Lease-Based Run Claiming
Workers claim runs using an optimistic-locking pattern: `UPDATE ... WHERE status IN (...) AND (lease_expires_at IS NULL OR lease_expires_at < now())`. The lease has a 5-minute TTL and a monotonic version counter.
- Key detail agents get wrong: `claimRun` checks both status AND lease expiry — a run stuck in "enriching" with an expired lease can be re-claimed.
- Reference: `packages/services/src/runs/db.ts:claimRun`

### Enrichment Payload
A deterministic extraction from the trigger event's `parsedContext` — no external API calls, no LLM. Produces a versioned `EnrichmentPayload` (v1) with summary, source URL, related files, suggested repo ID, and provider-specific context.
- Key detail agents get wrong: enrichment is pure computation, not an LLM call. The `llmFilterPrompt` and `llmAnalysisPrompt` fields on automations are configuration for future use by the trigger service, not by the enrichment worker.
- Reference: `apps/worker/src/automation/enrich.ts:buildEnrichmentPayload`

### AsyncClient / Slack Client
The `SlackClient` extends `AsyncClient` from `@proliferate/gateway-clients/server`. It manages bidirectional sessions: inbound Slack messages create/reuse sessions via the gateway SDK, and outbound gateway events (text, tool results) are posted back to Slack threads.
- Key detail agents get wrong: the Slack client does NOT use webhooks for outbound messages — it connects to the gateway via the `SyncClient` SDK, receives events, and calls the Slack API directly.
- Reference: `apps/worker/src/slack/client.ts:SlackClient`

---

## 3. File Tree

```
apps/worker/src/automation/
├── index.ts                          # Orchestrator: workers, outbox poller, finalizer loop
├── enrich.ts                         # buildEnrichmentPayload() — pure extraction
├── finalizer.ts                      # finalizeOneRun() — reconcile stale runs
├── resolve-target.ts                 # resolveTarget() — pick repo/prebuild
├── artifacts.ts                      # S3 artifact writer (completion + enrichment)
├── notifications.ts                  # Slack notification dispatch + channel resolution
├── *.test.ts                         # Tests for each module

apps/worker/src/slack/
├── index.ts                          # Barrel exports
├── client.ts                         # SlackClient (extends AsyncClient)
├── api.ts                            # SlackApiClient — raw Slack API wrapper
├── lib.ts                            # Shared utilities (postToSlack, image download, etc.)
└── handlers/
    ├── index.ts                      # Handler interfaces (ToolHandler, EventHandler)
    ├── text.ts                       # textPartCompleteHandler — posts text to thread
    ├── todo.ts                       # todoWriteToolHandler — formats task lists
    ├── verify.ts                     # verifyToolHandler — uploads media to Slack
    └── default-tool.ts               # defaultToolHandler — fallback code block

apps/web/src/server/routers/
└── automations.ts                    # oRPC routes: automation CRUD, runs, triggers, schedules

packages/services/src/
├── automations/
│   ├── service.ts                    # Business logic (CRUD, triggers, connections, events)
│   ├── db.ts                         # Raw Drizzle queries
│   └── mapper.ts                     # DB row → API contract mapping
├── runs/
│   ├── service.ts                    # Run lifecycle (create, claim, transition, complete, assign)
│   └── db.ts                         # Run queries + listing
├── outbox/
│   └── service.ts                    # enqueue, claim, markDispatched, markFailed, recoverStuck
├── side-effects/
│   └── service.ts                    # recordOrReplaySideEffect — idempotent external actions
└── notifications/
    └── service.ts                    # enqueueRunNotification — outbox wrapper

packages/db/src/schema/schema.ts      # Tables: automations, automation_runs, automation_run_events,
                                      # automation_side_effects, automation_connections, outbox
```

---

## 4. Data Models & Schemas

### Database Tables

```
automations
├── id                  UUID PK
├── organization_id     TEXT FK(organization) NOT NULL
├── name                TEXT NOT NULL DEFAULT 'Untitled Automation'
├── description         TEXT
├── enabled             BOOLEAN DEFAULT true
├── agent_instructions  TEXT
├── agent_type          TEXT DEFAULT 'opencode'
├── model_id            TEXT DEFAULT 'claude-sonnet-4-20250514'
├── default_prebuild_id UUID FK(prebuilds) ON DELETE SET NULL
├── allow_agentic_repo_selection BOOLEAN DEFAULT false
├── llm_filter_prompt   TEXT
├── enabled_tools       JSONB DEFAULT {}
├── llm_analysis_prompt TEXT
├── notification_channel_id TEXT          -- Slack channel ID
├── notification_slack_installation_id UUID FK(slack_installations)
├── created_by          TEXT FK(user)
├── created_at          TIMESTAMPTZ
└── updated_at          TIMESTAMPTZ
Indexes: idx_automations_org, idx_automations_enabled, idx_automations_prebuild

automation_connections
├── id                  UUID PK
├── automation_id       UUID FK(automations) ON DELETE CASCADE
├── integration_id      UUID FK(integrations) ON DELETE CASCADE
└── created_at          TIMESTAMPTZ
Unique: (automation_id, integration_id)

automation_runs
├── id                  UUID PK
├── organization_id     TEXT FK(organization) NOT NULL
├── automation_id       UUID FK(automations) NOT NULL
├── trigger_event_id    UUID FK(trigger_events) UNIQUE NOT NULL
├── trigger_id          UUID FK(triggers)
├── status              TEXT NOT NULL DEFAULT 'queued'
├── status_reason       TEXT
├── failure_stage       TEXT
├── lease_owner         TEXT
├── lease_expires_at    TIMESTAMPTZ
├── lease_version       INT DEFAULT 0 NOT NULL
├── attempt             INT DEFAULT 0 NOT NULL
├── queued_at           TIMESTAMPTZ NOT NULL
├── enrichment_started_at    TIMESTAMPTZ
├── enrichment_completed_at  TIMESTAMPTZ
├── execution_started_at     TIMESTAMPTZ
├── prompt_sent_at      TIMESTAMPTZ
├── completed_at        TIMESTAMPTZ
├── last_activity_at    TIMESTAMPTZ
├── deadline_at         TIMESTAMPTZ
├── session_id          UUID FK(sessions)
├── completion_id       TEXT              -- idempotency key
├── completion_json     JSONB
├── completion_artifact_ref TEXT          -- S3 key
├── enrichment_json     JSONB
├── enrichment_artifact_ref TEXT          -- S3 key
├── error_code          TEXT
├── error_message       TEXT
├── assigned_to         TEXT FK(user)
├── assigned_at         TIMESTAMPTZ
└── created_at / updated_at  TIMESTAMPTZ
Indexes: status+lease, org+status, session, trigger_event(unique), assigned_to

automation_run_events
├── id                  UUID PK
├── run_id              UUID FK(automation_runs) NOT NULL
├── type                TEXT NOT NULL     -- status_transition, enrichment_saved, completion, target_resolved
├── from_status         TEXT
├── to_status           TEXT
├── data                JSONB
└── created_at          TIMESTAMPTZ
Index: (run_id, created_at DESC)

automation_side_effects
├── id                  UUID PK
├── run_id              UUID FK(automation_runs) NOT NULL
├── organization_id     TEXT FK(organization) NOT NULL
├── effect_id           TEXT NOT NULL     -- idempotency key
├── kind                TEXT NOT NULL
├── provider            TEXT
├── request_hash        TEXT
├── response_json       JSONB
└── created_at          TIMESTAMPTZ
Unique: (organization_id, effect_id)

outbox
├── id                  UUID PK
├── organization_id     TEXT FK(organization) NOT NULL
├── kind                TEXT NOT NULL     -- enqueue_enrich, enqueue_execute, write_artifacts, notify_run_terminal
├── payload             JSONB NOT NULL
├── status              TEXT NOT NULL DEFAULT 'pending'  -- pending, processing, dispatched, failed
├── attempts            INT DEFAULT 0 NOT NULL
├── available_at        TIMESTAMPTZ DEFAULT now()
├── claimed_at          TIMESTAMPTZ
├── last_error          TEXT
└── created_at          TIMESTAMPTZ
Index: (status, available_at)
```

### Run Status State Machine

```
queued → enriching → ready → running → succeeded
                                     → failed
                                     → needs_human
                                     → timed_out
```

Terminal statuses: `succeeded`, `failed`, `needs_human`, `timed_out`. Any non-terminal status can transition to `failed` on error. Source: `packages/services/src/runs/service.ts:transitionRunStatus`

> **Note on glossary alignment:** The canonical glossary (`boundary-brief.md` §3) describes the run lifecycle as `pending → enriching → executing → completed/failed`. The actual DB status values are `queued → enriching → ready → running → succeeded/failed/needs_human/timed_out`. This spec uses the DB values throughout.

### Core TypeScript Types

```typescript
// packages/services/src/runs/db.ts
interface AutomationRunWithRelations extends AutomationRunRow {
  automation: { id; name; defaultPrebuildId; agentInstructions; modelId; ... } | null;
  triggerEvent: { id; parsedContext; rawPayload; providerEventType; ... } | null;
  trigger: { id; provider; name } | null;
}

// apps/worker/src/automation/enrich.ts
interface EnrichmentPayload {
  version: 1;
  provider: string;
  summary: { title: string; description: string | null };
  source: { url: string | null; externalId: string | null; eventType: string | null };
  relatedFiles: string[];
  suggestedRepoId: string | null;
  providerContext: Record<string, unknown>;
  automationContext: { automationId; automationName; hasLlmFilter; hasLlmAnalysis };
}

// apps/worker/src/automation/resolve-target.ts
interface TargetResolution {
  type: "default" | "selected" | "fallback";
  prebuildId?: string;
  repoIds?: string[];
  reason: string;
  suggestedRepoId?: string;
}

// packages/services/src/outbox/service.ts
type OutboxRow = InferSelectModel<typeof outbox>;
// Status: "pending" | "processing" | "dispatched" | "failed"
```

### Key Indexes & Query Patterns

| Query | Index | Notes |
|-------|-------|-------|
| Claim run by status + expired lease | `idx_automation_runs_status_lease (status, lease_expires_at)` | Used by `claimRun()` |
| List runs by org + status | `idx_automation_runs_org_status (organization_id, status)` | Admin/listing |
| Find run by session | `idx_automation_runs_session (session_id)` | Gateway completion lookup |
| Unique run per trigger event | `idx_automation_runs_trigger_event (trigger_event_id)` UNIQUE | Enforces 1:1 |
| Claim pending outbox rows | `idx_outbox_status_available (status, available_at)` | `SELECT ... FOR UPDATE SKIP LOCKED` |
| Side effect idempotency | `automation_side_effects_org_effect_key (organization_id, effect_id)` UNIQUE | Dedup |

---

## 5. Conventions & Patterns

### Do
- Use `runs.claimRun()` before mutating a run — this prevents concurrent workers from processing the same run.
- Insert outbox rows inside the same transaction as status updates where possible — `createRunFromTriggerEvent` and `completeRun` do this. Enrichment currently uses sequential writes; failures between writes are recoverable via lease expiry and re-claim.
- Use `recordOrReplaySideEffect()` for any external mutation — provides idempotent replay on retry. (Currently unused in the run pipeline; infrastructure exists for future use.)

### Don't
- Don't call the Slack API without decrypting the bot token first — tokens are stored encrypted via `@proliferate/shared/crypto`.
- Don't skip the outbox for inter-stage dispatch — direct BullMQ enqueue loses the at-least-once guarantee provided by stuck-row recovery.
- Don't write artifacts inline during enrichment — use the `write_artifacts` outbox kind so failures don't block the pipeline.

### Error Handling

```typescript
// Pattern: claim → process → fail-on-error
// Source: apps/worker/src/automation/index.ts:handleEnrich
const run = await runs.claimRun(runId, ["queued", "enriching"], workerId, LEASE_TTL_MS);
if (!run) return; // Another worker claimed it

try {
  // ... process
} catch (err) {
  if (err instanceof EnrichmentError) {
    await runs.markRunFailed({ runId, reason: "enrichment_failed", stage: "enrichment", errorMessage: err.message });
    return;
  }
  throw err; // BullMQ will retry
}
```

### Reliability
- **Outbox polling**: every 2s (`OUTBOX_POLL_INTERVAL_MS`). Source: `apps/worker/src/automation/index.ts:63`
- **Stuck-row recovery**: rows in `processing` state for > 5 min (`CLAIM_LEASE_MS`) are reset to `pending`. Max 5 attempts (`MAX_ATTEMPTS`). Source: `packages/services/src/outbox/service.ts:recoverStuckOutbox`
- **Retry backoff**: `min(30s * 2^attempts, 5min)`. Source: `apps/worker/src/automation/index.ts:retryDelay`
- **Finalizer interval**: every 60s, checks runs in `running` state with no activity for 30 min (`INACTIVITY_MS`). Source: `apps/worker/src/automation/index.ts:FINALIZER_INTERVAL_MS`
- **Slack API timeout**: 10s per call. Source: `apps/worker/src/automation/notifications.ts:SLACK_TIMEOUT_MS`
- **Session idempotency**: session creation uses `idempotencyKey: run:${runId}:session`. Source: `apps/worker/src/automation/index.ts:234`

### Testing Conventions
- Finalizer uses dependency injection (`FinalizerDeps`) for pure unit testing without gateway/DB. Source: `apps/worker/src/automation/finalizer.ts`
- Enrichment is a pure function — test with mock `AutomationRunWithRelations`. Source: `apps/worker/src/automation/enrich.test.ts`
- Outbox dispatch, artifacts, notifications, and resolve-target all have dedicated test files.

---

## 6. Subsystem Deep Dives

### 6.1 Run Pipeline — `Implemented`

**What it does:** Orchestrates the full lifecycle of an automation run from trigger event to completion.

**Happy path:**
1. Trigger service creates a trigger event + run + outbox row (`enqueue_enrich`) in one transaction (`packages/services/src/runs/service.ts:createRunFromTriggerEvent`)
2. Outbox poller claims the row, dispatches to `AUTOMATION_ENRICH` BullMQ queue (`apps/worker/src/automation/index.ts:dispatchOutbox`)
3. Enrich worker claims the run, builds enrichment payload, saves result, enqueues `write_artifacts` + `enqueue_execute` outbox rows
4. Outbox poller dispatches artifacts write (S3) and execute queue entry
5. Execute worker claims the run, resolves target, creates session via gateway SDK, sends prompt
6. Agent works inside the session, calls `automation.complete` tool
7. `completeRun()` records completion + enqueues `write_artifacts` + `notify_run_terminal` outbox rows
8. Outbox poller writes artifacts to S3 and dispatches Slack notification

**Files touched:** `apps/worker/src/automation/index.ts`, `packages/services/src/runs/service.ts`, `packages/services/src/outbox/service.ts`

### 6.2 Enrichment — `Implemented`

**What it does:** Extracts structured context from trigger event payloads. Pure deterministic computation — no external calls.

**Happy path:**
1. `buildEnrichmentPayload()` receives run with relations (`apps/worker/src/automation/enrich.ts:40`)
2. Validates `parsedContext` exists and has `title`
3. Extracts source URL from provider-specific fields (Linear, Sentry, GitHub, PostHog)
4. Extracts `relatedFiles`, `suggestedRepoId`, provider context
5. Returns `EnrichmentPayload` (version 1) saved to `enrichment_json` column

**Edge cases:**
- Missing `parsedContext` or `title` → `EnrichmentError` → run marked failed
- Unknown provider → empty `providerContext`

**Files touched:** `apps/worker/src/automation/enrich.ts`

### 6.3 Target Resolution — `Implemented`

**What it does:** Determines which repo/prebuild to use for session creation based on enrichment output and automation configuration.

**Decision tree** (`apps/worker/src/automation/resolve-target.ts:resolveTarget`):
1. If `allowAgenticRepoSelection` is false → use `defaultPrebuildId` ("selection_disabled")
2. If no `suggestedRepoId` in enrichment → use `defaultPrebuildId` ("no_suggestion")
3. If suggested repo doesn't exist in org → fallback to `defaultPrebuildId` ("repo_not_found_or_wrong_org")
4. If existing managed prebuild contains the repo → reuse it ("enrichment_suggestion_reused")
5. Otherwise → pass `repoIds: [suggestedRepoId]` for managed prebuild creation ("enrichment_suggestion_new")

**Files touched:** `apps/worker/src/automation/resolve-target.ts`

### 6.4 Execution — `Implemented`

**What it does:** Creates a session for the run and sends the agent prompt.

**Happy path:**
1. Claim run in `ready` status (`apps/worker/src/automation/index.ts:handleExecute`)
2. Call `resolveTarget()` to determine prebuild/repos
3. Create session via `syncClient.createSession()` with `clientType: "automation"`, `sandboxMode: "immediate"`
4. Build prompt: agent instructions + trigger context path + completion requirements with `run_id` and `completion_id`
5. Post prompt via `syncClient.postMessage()` with idempotency key

**Edge cases:**
- No valid target → run marked failed with `missing_prebuild`
- Session already exists (`run.sessionId` set) → skip creation, only send prompt if not already sent
- Prompt already sent (`run.promptSentAt` set) → skip

**Files touched:** `apps/worker/src/automation/index.ts:handleExecute`

### 6.5 Finalization — `Implemented`

**What it does:** Periodically reconciles stale runs against session and sandbox liveness.

**Happy path** (`apps/worker/src/automation/finalizer.ts:finalizeOneRun`):
1. No session → fail immediately (`missing_session`)
2. Deadline exceeded → transition to `timed_out` + enqueue notification
3. Query session status via gateway SDK
4. Session terminated without completion → fail (`no_completion`)
5. Sandbox dead but session "running" → fail (`sandbox_dead`)
6. Session running + sandbox alive → leave it alone

**Candidates:** runs in `running` status where `deadline_at < now` OR `last_activity_at < now - 30min`. Limit: 50 per tick. Source: `packages/services/src/runs/db.ts:listStaleRunningRuns`

**Files touched:** `apps/worker/src/automation/finalizer.ts`, `apps/worker/src/automation/index.ts:finalizeRuns`

### 6.6 Outbox Dispatch — `Implemented`

**What it does:** Polls the outbox table and dispatches items to their handlers.

**Happy path** (`apps/worker/src/automation/index.ts:dispatchOutbox`):
1. Recover stuck rows (processing > 5 min lease)
2. Atomically claim up to 50 pending rows via `SELECT ... FOR UPDATE SKIP LOCKED`
3. For each row, dispatch by `kind`:
   - `enqueue_enrich` → BullMQ `AUTOMATION_ENRICH` queue
   - `enqueue_execute` → BullMQ `AUTOMATION_EXECUTE` queue
   - `write_artifacts` → inline S3 write
   - `notify_run_terminal` → inline Slack dispatch
4. Mark dispatched or failed with backoff

**Files touched:** `apps/worker/src/automation/index.ts:dispatchOutbox`, `packages/services/src/outbox/service.ts`

### 6.7 Notifications — `Implemented`

**What it does:** Posts Slack messages when runs reach terminal states (succeeded, failed, timed_out, needs_human).

**Happy path** (`apps/worker/src/automation/notifications.ts:dispatchRunNotification`):
1. Load run with relations
2. Resolve Slack channel ID: prefer `automation.notificationChannelId`, fall back to `enabled_tools.slack_notify.channelId`
3. Look up Slack installation, decrypt bot token
4. Build Block Kit message with status, summary, and "View Run" button
5. POST to `chat.postMessage` with 10s timeout

**Files touched:** `apps/worker/src/automation/notifications.ts`, `packages/services/src/notifications/service.ts`

### 6.8 Slack Async Client — `Implemented`

**What it does:** Bridges Slack threads to Proliferate sessions, enabling bidirectional interaction.

**Inbound (Slack → Session)** (`apps/worker/src/slack/client.ts:processInbound`):
1. Find existing session for Slack thread (`sessions.findSessionBySlackThread`)
2. If none, create session via `syncClient.createSession()` with `clientType: "slack"`
3. Post welcome message with web app + preview links
4. Download any attached images as base64
5. Cancel any in-progress operation, post message to gateway

**Outbound (Session → Slack)** (`apps/worker/src/slack/client.ts:handleEvent`):
1. Receive gateway events (text_part_complete, tool_end, message_complete, etc.)
2. Convert markdown to Slack mrkdwn format
3. For significant tools (verify, todowrite), dispatch to specialized handlers
4. Stop listening on `message_complete` or `error`

**Slack handlers:**
- `textPartCompleteHandler` — converts markdown → mrkdwn, posts to thread (`handlers/text.ts`)
- `verifyToolHandler` — uploads verification media to Slack, posts summary with dashboard link (`handlers/verify.ts`)
- `todoWriteToolHandler` — formats task list with checkboxes (`handlers/todo.ts`)
- `defaultToolHandler` — posts tool result in code block, max 2000 chars (`handlers/default-tool.ts`)

**Files touched:** `apps/worker/src/slack/client.ts`, `apps/worker/src/slack/handlers/`

### 6.9 Artifact Storage — `Implemented`

**What it does:** Writes run artifacts (completion + enrichment JSON) to S3.

**Key paths:**
- Completion: `runs/{runId}/completion.json`
- Enrichment: `runs/{runId}/enrichment.json`

**S3 config:** `S3_BUCKET`, `S3_REGION`, optional `S3_ENDPOINT_URL`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`. Source: `apps/worker/src/automation/artifacts.ts`

### 6.10 Run Claiming & Assignment — `Partial`

**What it does:** Lets users claim runs for manual review.

**Implemented routes** (`apps/web/src/server/routers/automations.ts`):
- `assignRun` — claim a run for the current user. Throws `CONFLICT` if already claimed by another user.
- `unassignRun` — unclaim a run.
- `myClaimedRuns` — list runs assigned to the current user.
- `listRuns` — list runs for an automation with status/pagination filters.

**Scoping note:** The route validates that the automation exists in the org (`automationExists(id, orgId)`), but the actual DB update in `assignRunToUser` (`packages/services/src/runs/db.ts:278`) is scoped by `run_id + organization_id` only — it does not re-check the automation ID. This means the automation ID in the route acts as a parent-resource guard but is not enforced at the DB level.

**Gap:** No manual status update route (e.g., marking a `needs_human` run as resolved). Feature registry notes this as incomplete.

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `triggers.md` | Triggers → This | `runs.createRunFromTriggerEvent()` | Trigger service inserts run + outbox row. Handoff point. |
| `agent-contract.md` | This → Agent | `automation.complete` tool schema | Run injects `run_id` + `completion_id` in prompt. Agent calls tool to finalize. |
| `sessions-gateway.md` | This → Gateway | `syncClient.createSession()`, `postMessage()`, `getSessionStatus()` | Worker creates sessions and sends prompts via gateway SDK. |
| `sandbox-providers.md` | This → Provider (indirect) | Via gateway session creation | Target resolution determines prebuild; gateway handles sandbox boot. |
| `integrations.md` | This → Integrations | `automations.addAutomationConnection()` | Automation connections bind integrations. OAuth lifecycle owned by integrations spec. |
| `repos-prebuilds.md` | This → Prebuilds | `prebuilds.findManagedPrebuilds()` | Target resolution looks up managed prebuilds for repo reuse. |
| `billing-metering.md` | This → Billing (indirect) | Via session creation | Session creation triggers billing; this spec does not gate on balance. |

### Security & Auth
- All automation routes use `orgProcedure` middleware — validates org membership before any operation. Source: `apps/web/src/server/routers/automations.ts`
- Run assignment checks org ownership (`automationExists` + `orgId` filter on queries). Source: `packages/services/src/runs/db.ts:assignRunToUser`
- Slack bot tokens are encrypted at rest (`encrypted_bot_token`) and decrypted only at send time via `@proliferate/shared/crypto`. Source: `apps/worker/src/automation/notifications.ts:131`
- Worker authenticates to gateway via service-to-service token (`SERVICE_TO_SERVICE_AUTH_TOKEN`). Source: `apps/worker/src/automation/index.ts:47`

### Observability
- All worker modules use `@proliferate/logger` with structured context (`runId`, `sessionId`).
- Outbox recovery logs `recovered` count at `warn` level. Source: `apps/worker/src/automation/index.ts:303`
- Notification dispatch logs channel, status, and error per attempt.

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Worker tests pass (`pnpm -C apps/worker test`)
- [ ] Outbox service tests pass (`pnpm -C packages/services test`)
- [ ] This spec is updated (file tree, data models, deep dives)

---

## 9. Known Limitations & Tech Debt

- [ ] **No manual run status update** — Users can claim runs but cannot manually resolve `needs_human` runs via the API. Impact: requires direct DB access to close stuck runs. Expected fix: add `updateRunStatus` oRPC route with allowed transitions.
- [ ] **LLM filter/analysis fields unused** — `llm_filter_prompt` and `llm_analysis_prompt` columns exist on automations but are not executed during enrichment. Impact: configuration exists in UI but has no runtime effect. Expected fix: add LLM evaluation step to trigger processing pipeline (likely in `triggers.md` scope).
- [ ] **No run deadline enforcement at creation** — The `deadline_at` column exists but is never set during run creation. Only the finalizer checks it. Impact: runs rely solely on inactivity detection (30 min). Expected fix: set deadline from automation config at run creation.
- [ ] **Single-channel notifications** — Only Slack is implemented. The `NotificationChannel` interface exists for future email/in-app channels but no other implementations exist. Impact: orgs without Slack get no run notifications.
- [ ] **Notification channel resolution fallback** — The `resolveNotificationChannelId` function falls back to `enabled_tools.slack_notify.channelId` for backward compatibility. Impact: minor code complexity. Expected fix: migrate old automations and remove fallback.
- [ ] **Artifact writes are not retried independently** — If S3 write fails, the entire outbox item is retried (up to 5x). Impact: a transient S3 failure delays downstream notifications. Expected fix: split artifact writes into separate outbox items per artifact type.
- [ ] **Side effects table unused** — `automation_side_effects` table, service (`packages/services/src/side-effects/service.ts`), and `recordOrReplaySideEffect()` exist but have zero callsites in the run pipeline. Impact: dead infrastructure. Expected fix: wire into action invocations during automation runs, or remove if no longer planned.
- [ ] **Enrichment writes are not transactional** — `handleEnrich` performs `saveEnrichmentResult`, `enqueueOutbox(write_artifacts)`, `transitionRunStatus(ready)`, and `enqueueOutbox(enqueue_execute)` as four separate writes (`apps/worker/src/automation/index.ts:114-134`). A crash between writes can leave a run in an inconsistent state, recoverable only via lease expiry and re-claim. Impact: low (lease recovery works), but violates the outbox pattern's transactional intent.
