# Automations & Runs — System Spec

## 1. Scope & Purpose

### In Scope
- Automation CRUD and configuration (instructions, model, routing strategy, notifications)
- Automation connections (integration bindings)
- Run lifecycle state model (`queued → enriching → ready → running → succeeded|failed|needs_human|timed_out`)
- Run pipeline ownership and invariants (enrich → execute → finalize)
- Enrichment worker (deterministic context extraction)
- Execution worker (configuration resolution, session creation, prompt dispatch)
- Finalizer reconciliation against session and sandbox liveness
- Run event log (`automation_run_events`)
- Outbox dispatch (`enqueue_enrich`, `enqueue_execute`, `write_artifacts`, `notify_run_terminal`, `notify_session_complete`)
- Side-effect idempotency (`automation_side_effects`) for external notifications
- Artifact writes (completion + enrichment JSON to S3)
- Run assignment, manual resolution, org-level pending run query
- Manual run triggering (Run Now)
- Slack async client integration (Slack thread ↔ session)
- Session completion notification subscriptions + dispatch

### Out of Scope
- Trigger ingestion/matching and provider parsing logic — see `triggers.md`
- Tool schema details (`automation.complete`) — see `agent-contract.md`
- Session runtime lifecycle and hub ownership — see `sessions-gateway.md`
- Sandbox boot/provider mechanics — see `sandbox-providers.md`
- Slack OAuth installation lifecycle — see `integrations.md`
- Billing/metering policy for runs and sessions — see `billing-metering.md`

### Mental Model

An **automation** is policy. A **run** is execution state. A **session** is the runtime container where the agent works.

The automations subsystem is a database-orchestrated pipeline with explicit durability boundaries:
- Trigger-side code creates a trigger event + run + first outbox row in one transaction (`packages/services/src/runs/service.ts:createRunFromTriggerEvent`).
- Workers claim runs through leases (`packages/services/src/runs/db.ts:claimRun`) and claim outbox rows through `FOR UPDATE SKIP LOCKED` (`packages/services/src/outbox/service.ts:claimPendingOutbox`).
- Completion is closed by a tool callback path (`apps/gateway/src/hub/capabilities/tools/automation-complete.ts`) that writes terminal run state transactionally and then terminates the automation session fast-path (`apps/gateway/src/hub/session-hub.ts:terminateForAutomation`).

The system is intentionally **at-least-once** at dispatch boundaries. Idempotency is applied at state boundaries (`completion_id`) and side-effect boundaries (`automation_side_effects`).

### Things Agents Get Wrong

- The outbox is not BullMQ. It is a Postgres table polled every 2s, and BullMQ is downstream (`apps/worker/src/automation/index.ts:dispatchOutbox`).
- Enrichment is deterministic and local; configuration selection can still call an LLM in `agent_decide` mode (`apps/worker/src/automation/enrich.ts`, `apps/worker/src/automation/configuration-selector.ts`).
- `agent_decide` never creates new managed configurations. It only selects from allowlisted existing configurations (`apps/worker/src/automation/resolve-target.ts`).
- Run creation now sets a default deadline (2 hours) at insert time (`packages/services/src/runs/service.ts:DEFAULT_RUN_DEADLINE_MS`, `createRunFromTriggerEvent`).
- Enrichment completion is atomic (payload + status + outbox) and no longer sequential best-effort (`packages/services/src/runs/service.ts:completeEnrichment`).
- `transitionRunStatus` does not enforce allowed transition edges; callers must preserve lifecycle correctness (`packages/services/src/runs/service.ts:transitionRunStatus`).
- Session notifications are not automation-only; gateway idle/orphan paths can also enqueue `notify_session_complete` (`apps/gateway/src/hub/migration-controller.ts`, `apps/gateway/src/sweeper/orphan-sweeper.ts`).
- Run claim/unclaim are available to any org member, while resolve remains `owner|admin`; DB mutations are scoped by `run_id + organization_id + automation_id` when automation context is provided (`apps/web/src/server/routers/automations.ts`, `packages/services/src/runs/db.ts`).

---

## 2. Core Concepts

### Outbox Pattern
All inter-stage dispatch is represented as `outbox` rows. Workers poll and claim rows atomically, then dispatch to queues or inline handlers.
- Key detail agents get wrong: malformed payloads and unknown kinds are marked permanently failed, not retried forever (`apps/worker/src/automation/index.ts:dispatchOutbox`).
- Reference: `packages/services/src/outbox/service.ts`, `apps/worker/src/automation/index.ts`

### Lease-Based Run Claiming
Runs are claimed with lease expiry + allowed-status gating. Claims update `lease_version` monotonically.
- Key detail agents get wrong: stale leases are reclaimable even if status is unchanged (`packages/services/src/runs/db.ts:claimRun`).
- Reference: `packages/services/src/runs/db.ts`

### Completion Contract
`automation.complete` is the terminal contract between agent and run state. It records completion transactionally, updates trigger event status, persists session summary/outcome, and schedules terminal sandbox cleanup.
- Key detail agents get wrong: completion idempotency is enforced by `completion_id`, and mismatched payloads for the same ID are rejected (`packages/services/src/runs/service.ts:completeRun`).
- Reference: `apps/gateway/src/hub/capabilities/tools/automation-complete.ts`, `packages/services/src/runs/service.ts`

### Configuration Selection Strategy
Target configuration selection is policy-driven:
- `fixed`: use `defaultConfigurationId`
- `agent_decide`: select from `allowedConfigurationIds` via LLM and fallback to `fallbackConfigurationId`/default
- Key detail agents get wrong: `agent_decide` requires explicit allowlist; empty allowlist is a hard failure (`apps/worker/src/automation/resolve-target.ts`).
- Reference: `apps/worker/src/automation/resolve-target.ts`, `apps/worker/src/automation/configuration-selector.ts`

### Slack Async Client
Slack integration runs as an async gateway client. Inbound Slack messages create/reuse sessions and outbound session events are posted back to Slack threads.
- Key detail agents get wrong: outbound Slack messages are not webhook fan-out; they are direct Slack API calls made by the worker client (`apps/worker/src/slack/client.ts`).
- Reference: `apps/worker/src/slack/client.ts`, `apps/worker/src/slack/handlers/`

### Session Notification Subscriptions
Session-complete notifications are subscription-driven (`session_notification_subscriptions`) and dispatched by outbox.
- Key detail agents get wrong: delivery semantics are controlled by `notified_at` per subscription, not by outbox row uniqueness (`packages/services/src/notifications/service.ts`).
- Reference: `packages/services/src/notifications/service.ts`, `apps/worker/src/automation/notifications.ts`

---

## 5. Conventions & Patterns

### Do
- Claim runs before stage mutation (`runs.claimRun`) and process only allowed statuses.
- Use `runs.completeEnrichment` for enrichment completion to preserve atomicity.
- Use `runs.completeRun` for tool-driven terminal writes; do not hand-roll completion writes.
- Keep inter-stage work in outbox rows; queue fan-out happens in outbox dispatch.
- Record external side effects via `sideEffects.recordOrReplaySideEffect` when dispatch can retry.

### Don't
- Don't bypass outbox and enqueue BullMQ jobs directly from business services.
- Don't assume `transitionRunStatus` validates edge legality.
- Don't treat `llmFilterPrompt` / `llmAnalysisPrompt` as enrichment execution logic.
- Don't send Slack notifications without decrypting installation bot token at send time.

### Error Handling

```typescript
// Pattern: claim -> validate context -> process -> mark failed with stage-specific reason
const run = await runs.claimRun(runId, ["ready"], workerId, LEASE_TTL_MS);
if (!run) return;

const context = await runs.findRunWithRelations(runId);
if (!context?.automation || !context.triggerEvent) {
	await runs.markRunFailed({
		runId,
		reason: "missing_context",
		stage: "execution",
		errorMessage: "Missing automation or trigger event context",
	});
	return;
}
```

Source: `apps/worker/src/automation/index.ts:handleExecute`

### Reliability
- Outbox poll cadence: 2s (`OUTBOX_POLL_INTERVAL_MS`) — `apps/worker/src/automation/index.ts`
- Outbox stuck recovery lease: 5m (`CLAIM_LEASE_MS`) — `packages/services/src/outbox/service.ts`
- Outbox max attempts: 5 (`MAX_ATTEMPTS`) — `packages/services/src/outbox/service.ts`
- Outbox retry backoff: `min(30s * 2^attempts, 5m)` — `apps/worker/src/automation/index.ts:retryDelay`
- Run lease TTL: 5m (`LEASE_TTL_MS`) — `apps/worker/src/automation/index.ts`
- Run default deadline: 2h from creation — `packages/services/src/runs/service.ts:DEFAULT_RUN_DEADLINE_MS`
- Finalizer cadence: 60s; stale threshold: 30m inactivity (`INACTIVITY_MS`) — `apps/worker/src/automation/index.ts`
- Session creation idempotency key: `run:${runId}:session` — `apps/worker/src/automation/index.ts`
- Prompt idempotency key: `run:${runId}:prompt:v1` — `apps/worker/src/automation/index.ts`
- Slack API timeout: 10s (`SLACK_TIMEOUT_MS`) — `apps/worker/src/automation/notifications.ts`

### Testing Conventions
- Finalizer logic is dependency-injected (`FinalizerDeps`) for deterministic unit testing.
- Enrichment logic is pure and tested with synthetic run relations.
- Outbox dispatch tests validate recovery order, payload validation, and retry semantics.
- Execution integration tests validate configuration selection strategy behavior.

Sources:
- `apps/worker/src/automation/finalizer.test.ts`
- `apps/worker/src/automation/enrich.test.ts`
- `apps/worker/src/automation/outbox-dispatch.test.ts`
- `apps/worker/src/automation/execute-integration.test.ts`

---

## 6. Subsystem Deep Dives

### 6.1 Run Lifecycle Invariants — `Implemented`

**Invariants**
- Each run is uniquely bound to one trigger event (`trigger_event_id` unique).
- Trigger event creation, run creation, and initial `enqueue_enrich` outbox enqueue are transactional.
- Non-terminal run statuses are operational (`queued`, `enriching`, `ready`, `running`); terminal outcomes are `succeeded`, `failed`, `needs_human`, `timed_out`.
- Manual resolution is only legal from `needs_human`, `failed`, `timed_out` and only to `succeeded|failed`.

**Rules**
- Run ownership for processing requires both allowed status and non-active lease.
- Lifecycle edge validity is caller-owned; DB helpers do not enforce a strict finite-state machine.
- Every meaningful status mutation should emit a run event for auditability.

Sources:
- `packages/services/src/runs/service.ts`
- `packages/services/src/runs/db.ts`
- `packages/db/src/schema/schema.ts`

### 6.2 Enrichment Invariants — `Implemented`

**Invariants**
- Enrichment is deterministic extraction from trigger context; no external APIs and no model call.
- `parsedContext.title` is mandatory; absence is a terminal enrichment failure.
- Enrichment completion persists payload, transitions run to `ready`, records events, and enqueues `write_artifacts` + `enqueue_execute` in one transaction.
- Enrichment completion clears the claim lease (`leaseOwner`, `leaseExpiresAt`) when transitioning to `ready` so execute workers can claim immediately.

**Rules**
- Enrichment worker may only claim `queued|enriching` runs.
- Missing context (`automation`, `trigger`, `triggerEvent`) must fail the run with explicit stage/reason metadata.

Sources:
- `apps/worker/src/automation/enrich.ts`
- `apps/worker/src/automation/index.ts:handleEnrich`
- `packages/services/src/runs/service.ts:completeEnrichment`

### 6.3 Configuration Resolution Invariants — `Implemented`

**Invariants**
- `fixed` strategy resolves to `defaultConfigurationId` and does not call selector LLM.
- `agent_decide` strategy can only choose from explicit allowlisted configuration IDs.
- Candidate configurations without routing descriptions are ineligible for LLM selection.
- `agent_decide` failure falls back to `fallbackConfigurationId` (or default); without fallback/default it is a hard execution failure.

**Rules**
- Resolver must not create managed configurations in automation run execution.
- LLM selection response is accepted only if it returns JSON with eligible `configurationId`.

Sources:
- `apps/worker/src/automation/resolve-target.ts`
- `apps/worker/src/automation/configuration-selector.ts`
- `packages/services/src/automations/service.ts:updateAutomation`

### 6.4 Execution Invariants — `Implemented`

**Invariants**
- Execute worker only processes claimed `ready` runs.
- `target_resolved` run event is recorded before execution outcome branching.
- Run transitions to `running` before session creation/prompt send.
- Session creation uses deterministic idempotency key and `sandboxMode: "immediate"`.
- Prompt payload always includes completion contract (`automation.complete`, `run_id`, `completion_id`).

**Rules**
- Missing valid configuration target is terminal execution failure.
- Existing `sessionId` suppresses duplicate session creation.
- Existing `promptSentAt` suppresses duplicate prompt sends.
- Trigger event is advanced to `processing` when session creation succeeds.

Sources:
- `apps/worker/src/automation/index.ts:handleExecute`
- `apps/worker/src/automation/resolve-target.ts`

### 6.5 Completion & Terminalization Invariants — `Implemented`

**Invariants**
- `automation.complete` is the only first-class terminal completion tool for automation runs.
- `completeRun` writes terminal run state + completion event + outbox items (`write_artifacts`, `notify_run_terminal`) transactionally.
- Completion retries with identical `completion_id` and identical payload are idempotent.
- Completion retries with same `completion_id` but different payload are rejected.
- Gateway updates trigger event terminal status and persists session outcome/summary before session fast-path termination.

**Rules**
- Completion session ID mismatch is rejected.
- Automation session cleanup is best-effort and intentionally asynchronous after tool response.

Sources:
- `apps/gateway/src/hub/capabilities/tools/automation-complete.ts`
- `packages/services/src/runs/service.ts:completeRun`
- `apps/gateway/src/hub/session-hub.ts:terminateForAutomation`

### 6.6 Finalizer Invariants — `Implemented`

**Invariants**
- Finalizer only evaluates stale `running` runs (deadline exceeded or inactivity threshold).
- Missing session, terminated-without-completion, and provider-dead sandbox are terminal failure conditions.
- Deadline exceedance transitions run to `timed_out` and enqueues terminal notification.
- Trigger event is marked failed when finalizer determines terminal failure/timed-out path.
- Finalizer gateway status checks include `organizationId` to satisfy service-to-service auth requirements.

**Rules**
- If gateway status lookup fails, finalizer skips mutation and retries on next tick.
- If session is terminated but `completionId` already exists, finalizer leaves the run unchanged.

Sources:
- `apps/worker/src/automation/finalizer.ts`
- `apps/worker/src/automation/index.ts:finalizeRuns`
- `packages/services/src/runs/db.ts:listStaleRunningRuns`

### 6.7 Outbox Dispatch Invariants — `Implemented`

**Invariants**
- Dispatch cycle always attempts stuck-row recovery before fresh claim.
- Claims are atomic and concurrent-safe via `FOR UPDATE SKIP LOCKED` update-returning pattern.
- Outbox kind drives dispatch target:
  - `enqueue_enrich` -> BullMQ enrich queue
  - `enqueue_execute` -> BullMQ execute queue
  - `write_artifacts` -> inline S3 writes
  - `notify_run_terminal` -> inline run notification dispatch
  - `notify_session_complete` -> inline session notification dispatch

**Rules**
- Successful dispatch must call `markDispatched`.
- Dispatch errors use exponential backoff retry scheduling.
- Structural payload errors and unknown kinds are permanent failures.

Sources:
- `apps/worker/src/automation/index.ts:dispatchOutbox`
- `packages/services/src/outbox/service.ts`

### 6.8 Notification Invariants — `Implemented`

**Invariants**
- Run notification destinations are explicit per automation: `none`, `slack_channel`, `slack_dm_user`.
- Channel notifications resolve installation + channel and are idempotent via side-effect keys.
- DM notifications resolve installation + user DM channel and are idempotent via side-effect keys.
- Session completion notifications are subscription-driven and only send for rows with `notified_at IS NULL`.

**Rules**
- Missing destination configuration yields no-op, not hard failure.
- Slack API/network timeout errors are retryable through outbox retry semantics.
- Session notification dispatch throws on partial failure so outbox can retry remaining subscriptions.

Sources:
- `apps/worker/src/automation/notifications.ts`
- `packages/services/src/notifications/service.ts`
- `packages/services/src/side-effects/service.ts`

### 6.9 Slack Async Client Invariants — `Implemented`

**Invariants**
- Slack thread identity (`installationId`, `channelId`, `threadTs`) maps to one session conversation record.
- Inbound Slack messages create or reuse sessions and always ensure a receiver worker exists.
- Slack-originated wake events are ignored to prevent echo loops.
- Outbound event handling posts text/tool outputs incrementally until message completion.

**Rules**
- Session creation strategy in Slack honors installation-level selection policy (`fixed` vs `agent_decide`).
- Significant tool reporting is intentionally filtered (`verify`, `todowrite`) to reduce thread noise.

Sources:
- `apps/worker/src/slack/client.ts`
- `apps/worker/src/slack/handlers/`

### 6.10 Artifact Storage Invariants — `Implemented`

**Invariants**
- Completion and enrichment artifacts are materialized as JSON objects under deterministic run-scoped S3 keys.
- Artifact references are written back to run row after successful S3 put.

**Rules**
- Artifact write requires `S3_BUCKET` and `S3_REGION` at runtime.
- `write_artifacts` outbox dispatch fails if neither completion nor enrichment payload exists.

Sources:
- `apps/worker/src/automation/artifacts.ts`
- `apps/worker/src/automation/index.ts:writeArtifacts`

### 6.11 Run Assignment & Resolution Invariants — `Implemented`

**Invariants**
- Assignment is org-scoped and single-owner (`assigned_to` nullable with conflict semantics).
- Automation run listing is scoped by both `automation_id` and `organization_id`.
- Resolve operation is org-scoped, automation-scoped, and status-gated with TOCTOU-safe conditional update.
- Manual resolution always appends `manual_resolution` event data including actor metadata.

**Rules**
- API layer validates automation existence, allows assignment/unassignment for any org member, and requires `owner|admin` for resolve.
- Assignment/unassignment DB mutations are scoped by run + org and additionally by automation ID when provided by caller.

Sources:
- `packages/services/src/runs/service.ts:assignRunToUser`
- `packages/services/src/runs/service.ts:resolveRun`
- `packages/services/src/runs/db.ts`
- `apps/web/src/server/routers/automations.ts`

### 6.12 Manual Run Invariants — `Implemented`

**Invariants**
- Manual runs are represented as normal runs with synthetic trigger events.
- Manual trigger uses valid provider enum (`webhook`) plus `_manual` config flag, and is disabled to avoid accidental ingestion.
- Manual trigger is reused when present; duplicate manual triggers are not created.

**Rules**
- Manual run entrypoint still uses standard `createRunFromTriggerEvent`, preserving deadline, outbox, and run audit behavior.

Sources:
- `packages/services/src/automations/service.ts:triggerManualRun`
- `packages/services/src/automations/db.ts:findManualTrigger`

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `triggers.md` | Triggers -> This | `runs.createRunFromTriggerEvent()` | Trigger processor hands off by creating run + `enqueue_enrich` outbox row. |
| `agent-contract.md` | This -> Agent | `automation.complete` tool contract | Prompt and tool callback finalize run state. |
| `sessions-gateway.md` | This -> Gateway | `syncClient.createSession`, `postMessage`, `getSessionStatus` | Workers drive runtime through gateway SDK. |
| `sandbox-providers.md` | This -> Provider (indirect) | Session creation + status liveness | Finalizer depends on gateway-reported provider liveness. |
| `integrations.md` | This -> Integrations | Slack installation resolution | Notification dispatch resolves installations/tokens through integrations service. |
| `repos-prebuilds.md` | This -> Configurations | Configuration metadata and candidates | Run execution selects existing configurations. |
| `billing-metering.md` | This -> Billing (indirect) | Session creation gate happens in gateway | This subsystem does not perform direct credit enforcement. |

### Security & Auth
- Automation routes are `orgProcedure` protected and org-scoped.
- Worker -> gateway auth uses service token (`SERVICE_TO_SERVICE_AUTH_TOKEN`).
- Slack bot tokens are encrypted at rest and decrypted only at dispatch time.
- Completion tool path validates run/session consistency before terminal writes.

Sources:
- `apps/web/src/server/routers/automations.ts`
- `apps/worker/src/automation/index.ts`
- `apps/worker/src/automation/notifications.ts`
- `packages/services/src/runs/service.ts:completeRun`

### Observability
- Worker stages log structured run/session context.
- Outbox recovery logs recovered row counts.
- Finalizer logs reconcile outcomes and non-fatal gateway reachability failures.
- Slack dispatch logs destination errors for retry diagnosis.

Sources:
- `apps/worker/src/automation/index.ts`
- `apps/worker/src/automation/finalizer.ts`
- `apps/worker/src/automation/notifications.ts`

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Worker tests pass (`pnpm -C apps/worker test`)
- [ ] Services tests pass (`pnpm -C packages/services test`)
- [ ] Spec reflects current runtime invariants and agent-facing pitfalls

---

## 9. Known Limitations & Tech Debt

- [ ] **Transition guardrails are caller-enforced** — `transitionRunStatus` allows arbitrary `toStatus`; invalid edges are possible if callers misuse it. Source: `packages/services/src/runs/service.ts:transitionRunStatus`.
- [ ] **Run status schema includes unused states** — `canceled` and `skipped` exist in shared schema but are not currently produced by the run pipeline. Source: `packages/shared/src/contracts/automations.ts`.
- [ ] **LLM filter/analysis fields are still not run-stage execution inputs** — enrichment does not use `llm_filter_prompt` / `llm_analysis_prompt`. Source: `apps/worker/src/automation/enrich.ts`.
- [ ] **Configuration selector depends on LLM proxy availability** — `agent_decide` degrades to failure/fallback when proxy config or call fails. Source: `apps/worker/src/automation/configuration-selector.ts`.
- [ ] **Notification channel fallback remains for backward compatibility** — channel resolution still reads legacy `enabled_tools.slack_notify.channelId`. Source: `apps/worker/src/automation/notifications.ts:resolveNotificationChannelId`.
- [ ] **Artifact retries are coarse-grained** — `write_artifacts` retries the whole outbox item; completion and enrichment artifact writes are not independently queued. Source: `apps/worker/src/automation/index.ts:writeArtifacts`.
- [x] **Assignment scoping alignment across layers** — API layer validates automation ownership and triage role, and DB assignment/unassignment can include automation ID in mutation WHERE predicates. Source: `apps/web/src/server/routers/automations.ts`, `packages/services/src/runs/db.ts`, `packages/services/src/runs/service.ts`.
- [x] **Run deadline enforcement at creation** — Addressed via `DEFAULT_RUN_DEADLINE_MS` in run creation transaction. Source: `packages/services/src/runs/service.ts:createRunFromTriggerEvent`.
- [x] **Enrichment writes non-transactional** — Addressed via `completeEnrichment` transactional write + outbox enqueue. Source: `packages/services/src/runs/service.ts:completeEnrichment`.
- [x] **Side-effects table unused** — Addressed; run/DM notifications now use side-effect idempotency keys. Source: `apps/worker/src/automation/notifications.ts`, `packages/services/src/side-effects/service.ts`.
