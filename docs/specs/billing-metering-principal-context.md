# Billing & Metering — Principal Review Context

> **Status: All deltas implemented.** The gaps described in §2.2 and the code evidence in §10 reflect the **pre-implementation** state. All six deltas (A–F) from §5 have been merged. See `billing-metering.md` for authoritative current-state documentation.

## Purpose

This document was written for external design review by a principal engineer who does not have repository access.

It provides:
- a factual summary of the system behavior at time of review,
- a proposed target-state architecture (best-practice direction),
- key deltas between review-time state and target,
- explicit decision requests before implementation.

This is intentionally self-contained and does not require source browsing.

---

## 1) Product Context (Why this subsystem exists)

The platform runs billable coding sessions in remote sandboxes (web, CLI, automations). Billing must:
- gate access to new billable runtime,
- meter usage accurately (compute + LLM),
- avoid double-charging,
- remain fast in the session-start hot path,
- preserve user trust (predictable enforcement semantics).

Core product tension:
- financial enforcement rigor
- versus resumable, non-destructive user experience.

---

## 2) Current-State Reality (as implemented today)

### 2.1 What works well

1. **Local, fail-closed hot-path gating**
	- Session start checks are local (no Autumn dependency in hot path).
	- On lookup failures, access is denied.

2. **Atomic charging model**
	- Shadow balance deductions happen atomically with billing event insertion.
	- Deduction path uses transaction + row lock semantics.

3. **Deterministic idempotency**
	- Compute and LLM billing use deterministic keys.
	- Duplicate processing is skipped safely via unique keys.

4. **Workerized billing cycles**
	- Metering, outbox, grace, and sync jobs are scheduled via BullMQ.
	- Repeatable jobs and worker concurrency settings provide single-cycle serialization for core loops.

### 2.2 Current gaps / inconsistencies

1. **Policy mismatch: exhausted enforcement is terminate-first**
	- Current exhaustion flow hard-stops sessions (`stopped`) instead of pause/snapshot resumable behavior.
	- This is inconsistent with a snapshot-first product direction.

2. **Setup-session path is a gating hole**
	- Managed prebuild setup session creation currently bypasses the billing gate path.
	- This can create billable runtime outside normal session-start controls.

3. **Resume/connect/message path coverage is incomplete**
	- Gate operation types include `session_resume` and `cli_connect`, but these are not consistently wired across all runtime entry points.
	- Runtime bring-up paths can occur through websocket/message lifecycle code without a unified explicit resume gate.

4. **Concurrent-limit checks are non-atomic**
	- Current admission is read-then-create.
	- Parallel creates can transiently exceed max concurrent session limits.

5. **Snapshot quota enforcement is partial**
	- Capacity checks are used in web pause/snapshot handlers.
	- Retention cleanup scheduling and full cross-path enforcement are not complete.

6. **Billing-token system is not present as an active integrated subsystem**
	- Environment references exist, but no current production-integrated token validation module is active in billing paths.

---

## 3) Proposed Target-State (Best-Practice Direction)

This is the recommended system we should intentionally build toward.

### 3.1 Single “Iron Door” for billable runtime admission

All paths that can create or resume billable runtime must call one domain gate:
- web create
- gateway create
- automations/triggers
- CLI
- setup/prebuild sessions
- resume/runtime bring-up

Design rule:
- no direct session creation helper may bypass domain billing gate.

### 3.2 Unified enforcement semantics: snapshot-first, resumable by default

On `exhausted` / `suspended`:
- enforce through the same lock-guarded pause/snapshot lifecycle used for idle snapshotting,
- avoid direct terminate-by-default behavior,
- preserve resumability and user continuity.

Only fall back to hard stop when safety mechanisms fail repeatedly.

### 3.3 Atomic admission control for concurrent limits

Concurrent-session admission should be atomic, not read-then-create.

Acceptable implementations:
- transactional admission counter,
- scoped advisory lock around gate+insert,
- Redis atomic token bucket with strict rollback semantics.

### 3.4 Complete snapshot quota lifecycle

Enforce both:
- pre-snapshot capacity checks,
- scheduled retention cleanup.

Coverage must include all snapshot-producing paths, not only web handlers.

### 3.5 Operational integrity

Add mandatory alerting and runbook hooks for:
- permanently failed outbox events,
- reconciliation drift over threshold,
- billing worker lag/stoppage.

---

## 4) Architectural Principles (for approval)

1. **Hot-path isolation**
	- Never block session admission on third-party billing API calls.

2. **Financial correctness first**
	- Ledger and shadow balance updates must remain atomic and idempotent.

3. **Resumability first**
	- Enforcement should preserve user state whenever safely possible.

4. **Single source of control**
	- One gate interface for all billable admission paths.

5. **Explicit fallback behavior**
	- Define when to degrade from pause/snapshot to terminate.

---

## 5) Delta Plan (Current -> Target)

### Delta A: Close setup-session gate bypass
- Add mandatory gate check before setup/prebuild session creation.
- Treat setup sessions as first-class billable admissions (or explicitly carve out and document a non-billable policy).

### Delta B: Add explicit resume/connect gating
- Enforce `session_resume`/`cli_connect` semantics at runtime readiness entry points.
- Ensure websocket/message-driven sandbox bring-up cannot bypass gate intent.

### Delta C: Replace terminate-first exhaustion path
- Route exhausted/suspended enforcement through gateway lock-guarded snapshot pipeline.
- Preserve resumability and consistent lifecycle behavior.

### Delta D: Make concurrent cap enforcement atomic
- Introduce atomic admission guard in session-start path.

### Delta E: Finish snapshot quota lifecycle
- Keep capacity checks,
- add retention cleanup job,
- enforce across all relevant paths.

### Delta F: Improve operational controls
- alert on permanent outbox failure,
- alert on reconciliation drift,
- define owner/escalation policy.

---

## 6) Decision Requests (Principal Review)

These need explicit sign-off before implementation:

1. **DR-1: Setup-session billing policy**
	- Are setup/prebuild sessions billable and limit-constrained like normal sessions?

2. **DR-2: Enforcement UX contract**
	- Is pause/snapshot-first mandatory for exhausted/suspended, with terminate only as fallback?

3. **DR-3: Atomic concurrent admission**
	- Which implementation do we prefer (DB lock/counter vs Redis token model)?

4. **DR-4: Resume/connect gate semantics**
	- Should resume require the same minimum-balance threshold as start, or state-only checks?

5. **DR-5: Operational SLOs**
	- What is acceptable maximum age for unposted outbox events and max reconciliation drift?

6. **DR-6: Billing token roadmap**
	- Do we want to invest in billing JWT path integration now, defer, or remove from scope?

---

## 7) Risks if we do nothing

1. **Revenue leakage risk**
	- Un-gated setup paths can consume compute outside billing controls.

2. **Policy drift risk**
	- Terminate-first behavior continues to conflict with resumability promise.

3. **Fairness risk**
	- Non-atomic concurrent checks can let burst traffic exceed plan limits.

4. **Operational blind spots**
	- Permanent outbox failures can accumulate without timely human intervention.

---

## 8) Recommended Implementation Order

1. Close setup-session bypass + add missing resume/connect gating.
2. Implement atomic concurrent admission.
3. Rewire exhausted/suspended enforcement to lock-guarded pause/snapshot pipeline.
4. Complete snapshot retention cleanup and full-path quota coverage.
5. Add alerting/runbooks for outbox and reconciliation drift.

---

## 9) Acceptance Criteria for Target-State

The system is ready when:
- all billable admission paths go through one gate API,
- concurrent plan limits are atomically enforced,
- exhausted/suspended enforcement is resumable by default,
- snapshot quota capacity + retention are both active across all paths,
- outbox and drift alerts are operational with clear ownership.

---

## 10) Current Code Evidence Snapshots

This section captures representative snippets from the current codebase so reviewers can assess reality without repo access.

### 10.1 Gateway HTTP session creation is gated (including automations)

```ts
// apps/gateway/src/api/proliferate/http/sessions.ts
// Billing gate — blocks automations and API clients when org is out of credits
const operation = body.automationId ? "automation_trigger" : "session_start";
await billing.assertBillingGateForOrg(organizationId, operation);
```

### 10.2 Web oRPC session creation is also gated (plus re-check before insert)

```ts
// apps/web/src/server/routers/sessions-create.ts
// Check billing/credits before creating session
await billing.assertBillingGateForOrg(orgId, "session_start");

// Re-check billing right before insert (race protection)
await billing.assertBillingGateForOrg(orgId, "session_start");
```

### 10.3 Setup session paths currently bypass billing gate

```ts
// apps/gateway/src/api/proliferate/http/sessions.ts -> startSetupSession()
await sessions.createSetupSession({
	id: sessionId,
	prebuildId,
	organizationId,
	initialPrompt: prompt,
});
```

```ts
// packages/services/src/managed-prebuild.ts -> createAndStartSetupSession()
await sessionsDb.createSetupSession({
	id: sessionId,
	prebuildId,
	organizationId,
	initialPrompt: prompt,
});
```

### 10.4 Runtime resume path does not currently perform explicit billing gate check

```ts
// apps/gateway/src/hub/session-runtime.ts -> doEnsureRuntimeReady()
await waitForMigrationLockRelease(this.sessionId);
this.context = await loadSessionContext(this.env, this.sessionId);
// ... provider.ensureSandbox(...) and runtime bring-up follows
// No call to billing.assertBillingGateForOrg(...) in this flow today.
```

### 10.5 Message route posts prompts directly to hub runtime

```ts
// apps/gateway/src/api/proliferate/http/message.ts
await req.hub!.postPrompt(body.content, userId, body.source, body.images);
```

### 10.6 Exhausted enforcement is terminate-first today

```ts
// packages/services/src/billing/org-pause.ts -> handleCreditsExhaustedV2()
await provider.terminate(session.id, session.sandboxId);

await db.update(sessions).set({
	status: "stopped",
	endedAt: new Date(),
	stopReason: "sandbox_terminated",
	pauseReason: "credit_limit",
});
```

### 10.7 Snapshot quota checks are wired in web pause/snapshot handlers

```ts
// apps/web/src/server/routers/sessions-pause.ts
const capacity = await billing.ensureSnapshotCapacity(orgId, plan);
```

```ts
// apps/web/src/server/routers/sessions-snapshot.ts
const capacity = await billing.ensureSnapshotCapacity(orgId, plan);
if (!capacity.allowed) {
	throw new ORPCError("CONFLICT", { message: "Snapshot quota exceeded..." });
}
```

### 10.8 Billing worker concurrency model (BullMQ)

```ts
// packages/queue/src/index.ts
createBillingMeteringWorker(..., { concurrency: 1 });
createBillingOutboxWorker(..., { concurrency: 1 });
createBillingGraceWorker(..., { concurrency: 1 });
createBillingReconcileWorker(..., { concurrency: 1 });
createBillingLLMSyncDispatchWorker(..., { concurrency: 1 });
createBillingLLMSyncOrgWorker(..., { concurrency: 5 }); // per-org fan-out worker
```

### 10.9 Gate semantics: non-atomic concurrent cap check

```ts
// packages/shared/src/billing/gating.ts
if (operation === "session_start" || operation === "automation_trigger") {
	if (sessionCounts.running >= maxConcurrent) {
		return { allowed: false, errorCode: "CONCURRENT_LIMIT" };
	}
}
// check is read-based; no atomic admission lock with session insert.
```

### 10.10 Reconciliation job exists but org-list input is stubbed

```ts
// apps/worker/src/jobs/billing/reconcile.job.ts
// TODO: wire up from feat/billing-data-layer-rest-bulk after merge
async function listOrgsForReconciliation(): Promise<{ id: string; autumnCustomerId: string }[]> {
	return [];
}
```

### 10.11 Outbox permanent failures are logged but not escalated

```ts
// packages/services/src/billing/outbox.ts
if (status === "failed") {
	logger.error({ err, retryCount }, "Event permanently failed");
}
```

---

## 11) Reviewer Notes: What this means

- The core local-gate + atomic-ledger architecture is sound.
- The most serious correctness/policy deltas are around **entry-point parity** (setup/resume/message) and **terminate-vs-resumable enforcement**.
- Concurrency limits need an explicit atomic admission design choice before scale.
- Operational controls (reconciliation source + permanent outbox alerting) must be treated as launch-level reliability requirements, not follow-up nice-to-haves.

