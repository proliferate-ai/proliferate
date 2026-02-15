# Spec Consistency Review

> **Reviewed:** 2026-02-11
> **Scope:** All 13 specs + boundary-brief + feature-registry
> **Reviewer:** Automated consistency check
>
> **Note:** This is a point-in-time consistency report. It is not automatically kept in sync as specs and code evolve; treat it as historical context, not as an up-to-date spec.

---

## Summary

- **37 issues found** across 7 categories
- **5 status disagreements** between feature-registry and specs
- **11 file/table ownership overlaps** requiring resolution
- **3 contradictions** between specs or with boundary-brief
- **1 broken cross-reference** (boundary-brief vs actual spec ownership)
- **6 glossary violations**
- **8 missing cross-references**
- **3 feature-registry evidence path issues**

---

## 1. Status Disagreements (feature-registry vs specs)

### 1.1 `triggers.md` — Gmail provider
- **Feature registry:** Planned (`packages/triggers/src/adapters/gmail.ts` — "Stub exists, not in registry")
- **Spec:** Section 6.4 says "Gmail (Partial — polling via Composio)" and describes a full implementation
- **Fix:** Update feature-registry to `Partial` with note "Full implementation exists, requires `COMPOSIO_API_KEY` env var"

### 1.2 `triggers.md` — Cron scheduling
- **Feature registry:** Implemented (`apps/trigger-service/src/` — "SCHEDULED queue + cron expressions")
- **Spec:** Section 1 says "Partial — queue defined, worker not running"; Section 9 says "SCHEDULED queue worker not instantiated...High impact"
- **Fix:** Update feature-registry to `Partial` with note "Queue defined, worker not instantiated"

### 1.3 `triggers.md` — Sentry provider type
- **Feature registry:** "Webhook + polling"
- **Spec:** Section 6.4 says "Sentry (Implemented — webhook only)"
- **Fix:** Update feature-registry notes to "Webhook only" (no polling adapter for Sentry)

### 1.4 `secrets-environment.md` — S3 integration for secrets
- **Feature registry:** Implemented (`apps/gateway/src/lib/s3.ts`)
- **Spec:** Section 9 explicitly flags this: "`apps/gateway/src/lib/s3.ts` handles verification file uploads only. Secrets are stored exclusively in PostgreSQL."
- **Fix:** Remove "S3 integration for secrets" from feature-registry or change status to `Planned`. The S3 module is owned by sessions-gateway for verification uploads.

### 1.5 `billing-metering.md` — Credit gating
- **Feature registry:** Implemented
- **Spec:** Section 6.3 explicitly marked `Partial` with documented gap: "Automation runs create sessions via the gateway HTTP route which has no billing check"
- **Fix:** Update feature-registry to `Partial` with note "oRPC path enforced; gateway HTTP path (automations) bypasses billing gate"

---

## 2. File/Table Ownership Overlaps

### 2.1 `packages/shared/src/agents.ts`
- **Claimed by:** `agent-contract.md` (file tree §3), `sandbox-providers.md` (file tree §3, §2 "Agent & Model Configuration" section)
- **Fix:** Assign to `agent-contract.md` (it defines the agent/model types). `sandbox-providers.md` should reference it but not list it in its file tree or document it in §2.

### 2.2 `packages/shared/src/sandbox/config.ts`
- **Claimed by:** `agent-contract.md` (file tree §3), `sandbox-providers.md` (file tree §3)
- **Fix:** Assign to `sandbox-providers.md` (it owns sandbox boot config, plugin template, paths, ports). `agent-contract.md` references `ENV_INSTRUCTIONS` and `ACTIONS_BOOTSTRAP` from this file but should link to sandbox-providers, not list it in its own file tree.

### 2.3 `packages/shared/src/sandbox/opencode.ts`
- **Claimed by:** `agent-contract.md` (file tree §3), `sandbox-providers.md` (file tree §3)
- **Fix:** Assign to `sandbox-providers.md` (owns readiness check and config generation). `agent-contract.md` §6.4 documents the generated config — it should reference this file without claiming ownership.

### 2.4 `apps/gateway/src/lib/session-store.ts`
- **Claimed by:** `agent-contract.md` (file tree §3), `sessions-gateway.md` (file tree §3)
- **Fix:** Assign to `sessions-gateway.md` (primary purpose is session context loading). `agent-contract.md` references `buildSystemPrompt()` in this file — it should cite the function without claiming the file.

### 2.5 `apps/gateway/src/lib/opencode.ts`
- **Claimed by:** `agent-contract.md` (file tree §3), `sessions-gateway.md` (file tree §3)
- **Fix:** Assign to `sessions-gateway.md` (gateway infrastructure). `agent-contract.md` describes `updateToolResult()` behavior — cite with link, don't claim.

### 2.6 `apps/gateway/src/hub/capabilities/tools/*`
- **Claimed by:** `agent-contract.md` (file tree §3), `sessions-gateway.md` (file tree §3)
- **Fix:** Per boundary-brief: "agent-contract.md owns what tools exist and their schemas." Assign to `agent-contract.md` for tool handler definitions. `sessions-gateway.md` should list the directory in its file tree with a note "(tool schemas — see `agent-contract.md`)" and only document the interception/routing infrastructure, not the handlers themselves.

### 2.7 `packages/services/src/sessions/sandbox-env.ts`
- **Claimed by:** `llm-proxy.md` (file tree §3), `secrets-environment.md` (file tree §3)
- **Fix:** Assign to `sessions-gateway.md` (it assembles all sandbox env vars as part of session creation). Both `llm-proxy.md` and `secrets-environment.md` should reference it for their respective contributions (key generation and secret decryption).

### 2.8 `packages/db/src/schema/billing.ts` and `packages/services/src/billing/db.ts`
- **Claimed by:** `llm-proxy.md` (file tree §3), `billing-metering.md` (file tree §3)
- **Fix:** Assign to `billing-metering.md` (owns all billing tables and queries). `llm-proxy.md` should reference `llmSpendCursors` table and the spend query functions without claiming the files.

### 2.9 `apps/worker/src/billing/worker.ts`
- **Claimed by:** `llm-proxy.md` (file tree §3), `billing-metering.md` (file tree §3)
- **Fix:** Assign to `billing-metering.md`. `llm-proxy.md` documents `syncLLMSpend()` which lives here — it should reference the function, not claim the file.

### 2.10 `repo_connections` table
- **Claimed by:** `repos.md` (data models §4), `integrations.md` (data models §4)
- **Fix:** Assign to `integrations.md` (owns connection binding tables per boundary-brief). `repos.md` references it for token resolution but should not list the full DDL.

### 2.11 `apps/gateway/src/lib/github-auth.ts`
- **Claimed by:** `sessions-gateway.md` (file tree §3), `integrations.md` (file tree §3, §6.11 deep dive)
- **Fix:** Assign to `integrations.md` (owns token resolution). `sessions-gateway.md` should reference it.

---

## 3. Contradictions

### 3.1 Snapshot resolution ownership
- **Boundary-brief §2:** "repos.md owns repo records, configuration management, and snapshot *builds*. sessions-gateway.md owns snapshot *resolution* at session start (which snapshot to use)."
- **repos.md §1:** "Out of Scope: Snapshot resolution logic — see `sandbox-providers.md` §6.5"
- **sandbox-providers.md §6.5:** Documents `resolveSnapshotId()` — the function that picks which snapshot to use
- **sessions-gateway.md:** Does NOT claim snapshot resolution
- **Fix:** Update boundary-brief to say "sandbox-providers.md owns snapshot resolution" (since the function lives in `packages/shared/src/snapshot-resolution.ts` which is in the providers file tree). Or move it to repos since it's closely related to snapshot builds.

### 3.2 Run lifecycle state names
- **Boundary-brief §3 glossary:** "pending → enriching → executing → completed/failed"
- **automations-runs.md §4:** "queued → enriching → ready → running → succeeded/failed/needs_human/timed_out"
- **Spec §4 note:** Acknowledges this discrepancy
- **Fix:** Update boundary-brief glossary to match the actual DB values: "queued → enriching → ready → running → succeeded/failed/needs_human/timed_out"

### 3.3 Configuration resolver ownership ambiguity
- **repos.md §6.7:** "Owned by the gateway; documented here because it creates configuration and repo records via this spec's services."
- **sessions-gateway.md §6.1:** References `resolveConfiguration()` as part of session creation
- **Fix:** The resolver file `apps/gateway/src/lib/prebuild-resolver.ts` should be assigned to one spec. Since it lives in the gateway and is part of session creation flow, assign to `sessions-gateway.md`. `repos.md` should reference it for context but not document its internals.

---

## 4. Glossary Violations

### 4.1 `sandbox-providers.md` — "container"
- **§1 Mental Model:** "A sandbox is a remote compute environment (Modal container or E2B sandbox)"
- **Violation:** Glossary says do not call a sandbox a "container"
- **Fix:** Reword to "A sandbox is a remote compute environment backed by Modal or E2B"

### 4.2 `feature-registry.md` — "Configurations" in title
- **Section 9 header:** "Repos, Configurations & Prebuilds"
- **Status:** Resolved. Header updated to "Repos & Configurations" and glossary now uses "configuration" as the canonical term.

### 4.3 `repos.md` — terminology alignment
- **Status:** The canonical term is now "configuration" (not "prebuild"). Glossary updated in boundary-brief to reflect this rename.

### 4.4 `boundary-brief.md` — scope description
- **§1 Spec Registry, row 9:** Updated to "Repo CRUD, configuration management"
- **Status:** Resolved.

### 4.5 `automations-runs.md` — "job" used for BullMQ
- **§2 "Outbox Pattern":** "dispatches to BullMQ queues" — technically uses "queue" which the glossary reserves for outbox
- **Minor:** BullMQ is an external system, so "queue" in that context is arguably fine. But the outbox glossary entry says "not: queue" — this creates ambiguity.
- **Fix:** No action needed for BullMQ references — the glossary "queue" prohibition applies to calling the outbox a queue, not to BullMQ itself. Consider adding a clarification to the glossary.

### 4.6 `triggers.md` — "event" vs "trigger"
- **§1 Mental Model:** "External services emit events" — uses "event" liberally
- **Minor:** The glossary says trigger not "event, hook, listener" — but "event" is used correctly here to mean the occurrence, not the trigger definition
- **Fix:** No action needed — "trigger event" is the correct compound term for individual occurrences. The glossary prohibition is about calling the trigger configuration an "event."

---

## 5. Missing Cross-References

### 5.1 `actions.md` §7 — missing sessions-gateway reference
- **Issue:** Actions calls `sessions.listSessionConnections()` from `packages/services/src/sessions/db.ts` but the cross-cutting table doesn't reference `sessions-gateway.md`
- **Fix:** Add a row: `sessions-gateway.md | Actions → Sessions | sessions.listSessionConnections() | Discovers connected integrations for a session`

### 5.2 `sandbox-providers.md` §6.8 — git endpoints not cross-referenced
- **Issue:** sandbox-mcp API includes `/api/git/repos`, `/api/git/status`, `/api/git/diff` endpoints. These relate to `sessions-gateway.md` §6.6 (gateway-side git operations) but have no cross-reference.
- **Fix:** Add a cross-reference note in sandbox-providers §6.8 or §7 linking to sessions-gateway for gateway-side git operations.

### 5.3 `llm-proxy.md` — weak cross-reference to billing for `llmSpendCursors`
- **Issue:** Both specs document the `llm_spend_cursors` table, but llm-proxy.md doesn't clearly say this table is owned by billing-metering.md
- **Fix:** Add a note in llm-proxy.md §4: "This table is also documented in `billing-metering.md` which owns the billing schema."

### 5.4 `triggers.md` §6.8 — `apps/web/src/app/api/webhooks/github-app/route.ts`
- **Issue:** This file handles both GitHub lifecycle events (integrations.md §6.13) and trigger dispatch (triggers.md §6.8). Both specs document it without clearly delineating ownership.
- **Fix:** Add explicit notes: integrations.md owns lifecycle handling (installation deleted/suspended/unsuspended), triggers.md owns event dispatch to triggers. The file should be listed in one spec's file tree with a cross-reference from the other.

### 5.5 `repos.md` — setup finalization secret storage
- **Issue:** §6.8 mentions `secrets.upsertSecretByRepoAndKey()` but the cross-cutting table row just says "Finalize → Secrets" without the specific function.
- **Fix:** The cross-reference exists (§7 table has it), but the description could be more specific: "Setup finalization stores encrypted secrets via `secrets.upsertSecretByRepoAndKey()`"

### 5.6 `auth-orgs.md` — billing fields on organization table
- **Issue:** Lists billing columns (`billing_state`, `shadow_balance`, etc.) in the `organization` table DDL without noting they're documented in more detail by `billing-metering.md`
- **Fix:** Add a note after the DDL: "Billing-related columns are documented in detail in `billing-metering.md` §4"

### 5.7 `billing-metering.md` — missing cross-reference to llm-proxy for spend sync
- **Issue:** §6.4 documents LLM spend sync but the cross-cutting table only has a generic reference to llm-proxy. Should specifically reference `llm-proxy.md` §6.3 for the spend sync architecture.
- **Fix:** Update the `llm-proxy.md` row in §7 to reference "See `llm-proxy.md` §6.3 for spend sync architecture"

### 5.8 `cli.md` — `session_type: "terminal"` not cross-referenced to sessions-gateway
- **Issue:** CLI creates sessions with `session_type: "terminal"` but sessions-gateway.md notes this as an inconsistency (gateway creator defines `"cli"` not `"terminal"`). The specs don't cross-reference each other on this known issue.
- **Fix:** Add a note in cli.md §6.6 referencing the `session_type` inconsistency documented in sessions-gateway.md §4.

---

## 6. Feature-Registry Evidence Path Issues

### 6.1 `automations-runs.md` — outbox-dispatch.ts may be stale
- **Feature registry:** `Outbox dispatch | Implemented | apps/worker/src/automation/outbox-dispatch.ts`
- **Spec file tree:** Only lists `apps/worker/src/automation/index.ts` — `dispatchOutbox` function is documented as living in `index.ts`
- **Fix:** Verify whether `outbox-dispatch.ts` still exists. If merged into `index.ts`, update feature-registry evidence path.

### 6.2 `automations-runs.md` — notifications-dispatch.ts not in file tree
- **Feature registry:** `Notification dispatch | Implemented | apps/worker/src/automation/notifications-dispatch.ts`
- **Spec file tree:** Lists `notifications.ts` but not `notifications-dispatch.ts`
- **Fix:** Verify file existence and update either the spec file tree or the feature-registry evidence.

### 6.3 `triggers.md` — Gmail adapter path
- **Feature registry:** `Gmail provider | Planned | packages/triggers/src/adapters/gmail.ts`
- **Spec file tree:** Lists `packages/triggers/src/service/adapters/gmail.ts`
- **Fix:** Update feature-registry path to match spec: `packages/triggers/src/service/adapters/gmail.ts`

---

## 7. Depth Imbalance

All 13 specs fall within the 300-600 line target:
- Shortest: `llm-proxy.md` (~343 lines) — expected, scope is an integration contract
- Longest: `auth-orgs.md` (~571 lines) — within range, scope is broad

**No actionable depth imbalance issues found.**

---

## 8. Additional Observations

### 8.1 `outbox` table documented only in automations-runs
- The `outbox` table is used by both automations-runs and triggers (triggers insert `enqueue_enrich` rows). The table definition lives only in automations-runs.md §4. This is acceptable since automations-runs owns the outbox dispatch, but triggers.md should have a cross-reference noting it inserts into a table documented in automations-runs.md.

### 8.2 `packages/queue/src/index.ts` claimed by multiple specs
- triggers.md (polling/scheduling queues), repos.md (snapshot build queues), automations-runs.md (automation queues) all reference this file. As shared infrastructure, it's listed in the feature-registry cross-cutting section. No spec should exclusively claim it.

### 8.3 `session_connections`, `automation_connections` tables
- integrations.md lists these in its data models (connection binding tables)
- sessions-gateway.md lists `session_connections` in its data models
- automations-runs.md lists `automation_connections` in its data models
- **Fix:** Per boundary-brief, integrations.md owns "Connection binding to repos/automations/sessions." Assign all three junction tables exclusively to integrations.md. Other specs should reference them.

### 8.4 Boundary-brief scope description for `sandbox-providers.md`
- **Boundary-brief says:** "Modal + E2B provider interface, sandbox boot, snapshot resolution, git freshness, sandbox-mcp"
- **Spec says:** Snapshot resolution is in scope (§6.5)
- **But boundary-brief §2 says:** "sessions-gateway.md owns snapshot *resolution*"
- These two statements in boundary-brief contradict each other (see §3.1 above)

---

## Priority Summary

| Priority | Count | Categories |
|----------|-------|------------|
| High | 5 | Status disagreements (feature-registry drift from specs) |
| High | 3 | Contradictions (boundary-brief vs specs) |
| Medium | 11 | File/table ownership overlaps |
| Medium | 3 | Feature-registry stale evidence paths |
| Low | 8 | Missing cross-references |
| Low | 6 | Glossary violations (mostly minor) |
| None | 0 | Depth imbalance |

**Recommended next step:** Fix the 5 status disagreements in feature-registry first (quick, high-impact), then resolve the 3 contradictions in boundary-brief, then clean up file ownership overlaps across specs.
