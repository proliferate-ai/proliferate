# Spec Audit — Pending Issues, Dead Code & Gaps

> Generated 2026-03-02 from a full spec-vs-implementation audit of `codex/specs-cleanup-all`.
> Each finding is verified against actual code. Items are grouped by priority, then category.

---

## High Priority

### H-1. CLI source command route mismatch — commands are non-functional
- **Category:** route-mismatch
- **CLI:** `packages/cli/src/commands/source.ts:16,36,59` — uses `/proliferate/:sessionId/sources/bindings` (plural)
- **Gateway:** `apps/gateway/src/api/proliferate/http/index.ts:46` — mounts at `/:sessionId/source` (singular)
- **Impact:** All three CLI source commands (`list-bindings`, `query`, `get`) return 404.
- **Fix:** Rename CLI paths or gateway mount point to match. Single-character plural/singular alignment.

### H-2. CLI baseline endpoints not wired in gateway
- **Category:** route-mismatch
- **CLI:** `packages/cli/src/commands/baseline.ts:13,19` — calls `/proliferate/:sessionId/baseline` and `/baseline/targets`
- **Gateway:** No baseline router registered in `apps/gateway/src/api/proliferate/http/index.ts`
- **Impact:** CLI `baseline info` and `baseline targets` commands are non-functional.
- **Fix:** Either implement gateway baseline routes or remove CLI commands.

---

## Medium Priority

### M-1. Orphaned grants subsystem (dead endpoints + dead handlers)
- **Category:** dead-code / route-mismatch
- **Files:**
  - `packages/sandbox-mcp/src/proliferate-cli.ts:39,41` — advertises `actions grant request` and `actions grants list`
  - `packages/sandbox-mcp/src/actions-grants.ts` — full handler file (`parseGrantRequestFlags`, `executeGrantRequest`, `executeGrantsList`)
- **Context:** Gateway `/grants` routes were fully removed. Grants replaced by session capabilities + mode resolution (`packages/services/src/actions/modes.ts`).
- **Fix:** Delete `actions-grants.ts` and remove grant command entries from CLI usage text.

### M-2. `terminateForAutomation` is dead code on SessionHub
- **Category:** dead-code
- **File:** `apps/gateway/src/hub/session-hub.ts:1055` (~50 lines)
- **Context:** `automation.complete` handler switched to pause semantics (`apps/gateway/src/hub/capabilities/tools/automation-complete.ts:99-133`). No caller invokes `terminateForAutomation` anywhere.
- **Fix:** Remove the method.

### M-3. Slack support-channel schema drift
- **Category:** schema-drift
- **Canonical schema:** `packages/db/src/schema/schema.ts:1358-1361` — `supportChannelId`, `supportChannelName`, `supportInviteId`, `supportInviteUrl`
- **Modular file:** `packages/db/src/schema/slack.ts:40-43` — `connectChannelId`, `inviteUrl` (different names, same purpose)
- **Context:** `slack.ts` is an independent `pgTable` definition, NOT a re-export from `schema.ts`. Other modular files (`sessions.ts`, `actions.ts`, `automations.ts`) are thin re-exports. `slack.ts` is NOT imported by production code.
- **Fix:** Convert `slack.ts` to re-exports from `schema.ts` to match the repo pattern, or delete it.

### M-4. `updateSlackSupportChannel` silently drops parameters
- **Category:** tech-debt
- **File:** `packages/services/src/integrations/db.ts:377-395`
- **Detail:** Parameters `_channelName` and `_inviteId` are accepted but never persisted. The `.set()` call only writes `supportChannelId` and `supportInviteUrl`. The caller (`apps/web/src/server/routers/integrations.ts:469-474`) passes real values from the Slack API that are silently discarded.
- **Fix:** Persist `channelName` → `supportChannelName` and `inviteId` → `supportInviteId` using the existing DB columns.

### M-5. Non-deterministic first-org fallback in auth hook
- **Category:** tech-debt
- **File:** `apps/web/src/lib/auth/server/index.ts:165`
- **Detail:** Raw SQL `SELECT "organizationId" FROM "member" WHERE "userId" = $1 LIMIT 1` has no `ORDER BY`. Service-layer functions `getUserOrgIds` and `getUserFirstOrganization` correctly order by `createdAt, organizationId`.
- **Impact:** Multi-org users may get inconsistent session org context.
- **Fix:** Add `ORDER BY "created_at" ASC` to the raw SQL query.

### M-6. `getIdleGraceMs()` automation branch is unreachable
- **Category:** dead-code
- **File:** `apps/gateway/src/hub/session-hub.ts:672`
- **Detail:** `shouldIdleSnapshot()` returns `false` at line 649 for `clientType === "automation"` before ever calling `getIdleGraceMs()`. The `sessionType === "automation"` branch returning `30_000` inside `getIdleGraceMs()` is dead code.
- **Fix:** Remove the automation branch from `getIdleGraceMs()`.

---

## Low Priority — Dead DB Functions

Batch of exported-but-never-imported query functions. All are safe to delete — they've been superseded by CAS/atomic variants or simply never wired up.

| # | File | Function | Superseded by |
|---|------|----------|--------------|
| L-1 | `packages/services/src/actions/db.ts:126` | `updateInvocationStatus` | `transitionInvocationStatus` (CAS) |
| L-2 | `packages/services/src/actions/db.ts:214` | `expirePendingInvocations` | `listExpirablePendingInvocations` + per-item |
| L-3 | `packages/services/src/notifications/db.ts:247` | `markNotificationFailed` | Nothing — failure path never wired |
| L-4 | `packages/services/src/notifications/db.ts:157` | `findNotificationById` | Nothing — never consumed |
| L-5 | `packages/services/src/workers/db.ts:231` | `updateWorkerRunStatus` | `transitionWorkerRunStatus` (CAS) |
| L-6 | `packages/services/src/workers/db.ts:116` | `updateWorkerStatus` | `transitionWorkerStatus` (CAS) |
| L-7 | `packages/services/src/workers/db.ts:728` | `getNextWorkerRunEventIndex` | Not consumed |
| L-8 | `packages/services/src/workers/db.ts:713` | `findWorkerRunEventByDedupeKey` | Not consumed |
| L-9 | `packages/services/src/workers/db.ts:533` | `createWorkerRunEvent` | `appendWorkerRunEventAtomic` (atomic) |
| L-10 | `packages/services/src/secrets/db.ts:156` | `existsByKey` | Not consumed |
| L-11 | `packages/shared/src/providers/index.ts:46` | `getSandboxProviderForSnapshot` | `getSandboxProvider` |
| L-12 | `packages/services/src/orgs/service.ts:191,196` + `orgs/db.ts:618,661` | `getOverageState` / `updateOverageState` | Not consumed (4 functions total) |
| L-13 | `packages/services/src/baselines/service.ts:370` | `getBaseline` | Only called by dead `rollbackToBaseline` |
| L-14 | `packages/services/src/baselines/service.ts:284` | `rollbackToBaseline` | Not consumed |
| L-15 | `packages/services/src/actions/connectors/client.ts:46` | `extractToolCallContent` | Not consumed (has tests but no production caller) |
| L-16 | `packages/services/src/actions/connectors/client.ts:283` + `connectors/index.ts:11` | `computeDriftStatus` | Not consumed |

---

## Low Priority — Other

### L-17. Dead code: `hashLocalPath()` in CLI
- **File:** `packages/cli/src/lib/ssh.ts:61`
- **Detail:** Exported but never imported. Only `hashPrebuildPath()` is used.
- **Fix:** Delete function.

### L-18. TODO: MCP connector automation integration incomplete
- **File:** `packages/services/src/automations/service.ts:872`
- **Detail:** `// TODO: MCP connectors -- query automation_connections -> org_connectors,` — indicates `getAutomationIntegrationActions()` has a documented gap for connector-backed actions in automations.
- **Fix:** Feature work required, not a cleanup.

### L-19. `@ts-expect-error` for Redlock ESM types
- **File:** `packages/services/src/lib/lock.ts:12`
- **Detail:** `// @ts-expect-error - redlock types don't resolve properly due to ESM exports` — suppresses type checking on Redlock import due to ESM interop issue.
- **Fix:** May require Redlock version upgrade or custom type declaration.

### L-20. Planned UI surfaces described as current in specs
- **Specs:** `docs/specs/inbox-workspace.md`
- **Detail:** My Work page, Activity page (paginated/filtered), and `/dashboard/inbox` route are all described but don't exist as rendered surfaces. Backend routes exist for some (`myClaimedRuns`, `listOrgRuns`) but have no frontend consumers.
- **Fix:** Already marked as `(Planned)` during this audit. Implement or remove when ready.

---

## Summary

| Priority | Count | Safe to fix now | Needs design decision |
|----------|-------|----------------:|----------------------:|
| **High** | 2 | 1 (H-1) | 1 (H-2) |
| **Medium** | 6 | 4 (M-1,M-2,M-3,M-6) | 2 (M-4,M-5) |
| **Low** | 20 | 18 | 2 (L-18,L-19) |
| **Total** | **28** | **23** | **5** |

### Quick wins (safe, no behavioral change, no design decision needed)
1. Delete `packages/sandbox-mcp/src/actions-grants.ts` and remove grant CLI entries (M-1)
2. Delete `terminateForAutomation` from `session-hub.ts` (M-2)
3. Fix CLI source route plural → singular (H-1)
4. Convert `packages/db/src/schema/slack.ts` to re-exports (M-3)
5. Remove automation branch from `getIdleGraceMs()` (M-6)
6. Batch-delete 16 unused DB functions (L-1 through L-16)
7. Delete `hashLocalPath()` (L-17)
