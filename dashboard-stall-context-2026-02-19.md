# Dashboard Stall Investigation Handoff (2026-02-19)

## 1. Executive Summary

The current issue is **not a simple single slow query** and not primarily a static compile problem.

Observed pattern:
- `compile` is usually ~0.8s to ~3.5s.
- `render` often explodes to ~6s to ~55s.
- Multiple different endpoints stall at roughly the same wall-clock duration (for example many around ~33s, later many around ~8s).
- Errors include both:
  - Better Auth pool: `timeout exceeded when trying to connect` / `Connection terminated unexpectedly`.
  - Drizzle/postgres.js pool: `write CONNECT_TIMEOUT 127.0.0.1:5432`.

Interpretation:
- This looks like a **shared bottleneck / contention event** (event-loop starvation + request fan-out + connection churn), not one bad endpoint.
- The fixes merged in PR #186 improved resilience but did not fully remove stalls under heavy local dev load.

## 2. Symptoms and Log Evidence (from local dev)

Representative log patterns seen:
- `GET /api/auth/get-session 200 in 23.8s (compile: 2.3s, render: 21.5s)`
- `POST /api/rpc/onboarding/getStatus 500 in 55s (compile: 2.8s, render: 52s)`
- `POST /api/rpc/actions/list 200 in 33.3s (compile: 3.3s, render: 30.1s)`
- `POST /api/rpc/sessions/list 200 in 33.3s (compile: 3.2s, render: 30.1s)`
- `POST /api/rpc/automations/listOrgPendingRuns 200 in 33.4s (compile: 3.3s, render: 30.1s)`
- `ERROR: ... params: ...,active,1: write CONNECT_TIMEOUT 127.0.0.1:5432`

Also observed:
- White/blank dashboard shell when gate conditions wait or redirect (`/dashboard` renders shell background, little/no content).
- `trigger-service` occasionally crashes with Redis `Connection is closed` (likely separate but contributes to noisy/local instability).

## 3. Environment Snapshot

- OS: macOS (user machine)
- Node: `v22.21.1`
- pnpm: `8.15.1`
- Next.js: `16.1.6` (Turbopack in `next dev`)
- DB: Docker Postgres local (`127.0.0.1:5432`)
- Redis: Docker Redis local (`127.0.0.1:6379`)

Current DB/container checks:
- Postgres container healthy
- Redis container healthy
- `max_connections = 100`
- Activity snapshot (example): `active=2`, `idle=4`
- Migrations table count: `33`
- `outbox` table exists: `true`

## 4. Request Path for Stalled Calls

### 4.1 Auth-gated oRPC calls

Browser -> `/api/rpc/...` -> `/Users/pablo/proliferate/apps/web/src/app/api/rpc/[[...rest]]/route.ts` -> oRPC router -> middleware -> `requireAuth()` -> `getSession()` -> Better Auth DB calls.

Relevant files:
- `/Users/pablo/proliferate/apps/web/src/server/routers/middleware.ts`
- `/Users/pablo/proliferate/apps/web/src/lib/auth-helpers.ts`
- `/Users/pablo/proliferate/apps/web/src/lib/auth.ts`

### 4.2 Business query calls after auth

Routers call services package methods, which call Drizzle/postgres.js via:
- `/Users/pablo/proliferate/packages/db/src/client.ts`
- Re-exported by `/Users/pablo/proliferate/packages/services/src/db/client.ts`

So there are two independent pool paths in web runtime:
- Better Auth (`pg` Pool in `auth.ts`)
- Services/Drizzle (`postgres.js` in `packages/db/src/client.ts`)

## 5. Recent Changes Potentially Related

Recent commits on `main`:
- `42a049f` feat: inbox/sessions/workspace overhaul (#184)
- `cf1ec2c` feat: automations UI polish (#185)
- `5873640` fix: dev DB pool leaks + migration journal fix (#186)
- `3c53cfa` fix: increase dev connect timeouts to 60s

### 5.1 What #186 and 3c53cfa changed (already merged)

- Better Auth pool hardening in `/Users/pablo/proliferate/apps/web/src/lib/auth.ts`:
  - `globalThis` singleton pool in dev
  - `max: isDev ? 5 : 1`
  - `connectionTimeoutMillis: isDev ? 60000 : 5000`
  - `keepAlive: isDev`
- Drizzle/postgres.js pool hardening in `/Users/pablo/proliferate/packages/db/src/client.ts`:
  - `globalThis` singleton
  - `connect_timeout: isDev ? 60 : 10`
- Migration journal fix in `/Users/pablo/proliferate/packages/db/drizzle/meta/_journal.json`.

These helped but did not eliminate stalls under load.

## 6. Current Dashboard Fan-Out (Important)

On `/dashboard` shell/home, concurrent work includes:
- `useSession()` (auth-client, calls `/api/auth/get-session`)
- `useOnboarding()` (`onboarding/getStatus`)
- `useBilling()` (`billing/getInfo`)
- Sidebar attention data (`actions/list`, `automations/listOrgPendingRuns`)
- Home content data (`sessions/list`, additional pending runs)

Files:
- `/Users/pablo/proliferate/apps/web/src/app/(command-center)/layout.tsx`
- `/Users/pablo/proliferate/apps/web/src/components/dashboard/sidebar.tsx`
- `/Users/pablo/proliferate/apps/web/src/components/dashboard/empty-state.tsx`
- `/Users/pablo/proliferate/apps/web/src/hooks/use-attention-inbox.ts`
- `/Users/pablo/proliferate/apps/web/src/hooks/use-actions.ts`
- `/Users/pablo/proliferate/apps/web/src/hooks/use-automations.ts`
- `/Users/pablo/proliferate/apps/web/src/hooks/use-sessions.ts`

Important behavior:
- Several org-level queries poll (`30s` default in some paths).
- If the initial auth/onboarding path stalls, layout can show effectively blank state while redirects/gates resolve.

## 7. Findings From Code/Repo State Right Now

### 7.1 Framer Motion is likely not the culprit

`framer-motion` usage is limited to:
- `/Users/pablo/proliferate/apps/web/src/components/coding-session/right-panel.tsx`

No significant dashboard-shell usage found.

### 7.2 Barrel import compile amplification is real on `origin/main`

`origin/main` still has many web/server imports from root `@proliferate/services` barrel (42 import sites), which forces broad module graph compile.

Evidence:
- `origin/main` count: `42`
- local working tree count: `0` (currently rewritten locally to subpath imports, not merged)

Total TS lines in services package:
- `/Users/pablo/proliferate/packages/services/src`: `22,686` lines

This is a strong compile-time pressure multiplier in dev.

### 7.3 Local working tree is heavily dirty (unmerged experiments)

Current local status includes many modified files and a few new loading pages.
- `62 files changed, 538 insertions, 182 deletions` (local working tree)

This includes useful experiments (query gating, auth caching, subpath imports), but they are not all on `main`.

## 8. Ranked Root-Cause Hypotheses

1. **Request fan-out + synchronized cold compile/render pressure** (high confidence)
- Many auth-gated and org-level calls launch near-simultaneously.
- Shared stall durations across different endpoints strongly suggest queueing/contended runtime.

2. **Module graph compile amplification from services barrel imports** (high confidence)
- `@proliferate/services` root barrel pulls broad tree; Turbopack compiles per entrypoint and can repeatedly hit broad graph.

3. **Dev runtime contention from full-stack concurrent watchers/services** (medium confidence)
- Running web + gateway + worker + trigger-service + package watchers can saturate local resources, especially during cold starts.

4. **Pool hardening insufficient under worst burst despite #186** (medium confidence)
- Singleton/timeouts reduce failure rate but do not solve high fan-out causing long waits.

5. **Single endpoint SQL slowness as primary root cause** (low-medium confidence)
- There are expensive queries, but synchronized multi-endpoint stalls and `CONNECT_TIMEOUT` signatures point to broader contention, not one query.

## 9. Proposal: Practical Remediation Plan (Advisor-Ready)

### Phase A: Instrument first (1 short iteration)

Add lightweight timing + correlation IDs around:
- `getSession()` and `requireAuth()` duration
- oRPC handler total duration by route
- DB query duration and pool wait markers

Goal: separate time spent in auth, pool wait, query execution, and rendering.

### Phase B: Cut startup fan-out

- Defer non-critical dashboard queries until shell is stable.
- Keep inbox/org-level polling off by default except where visible.
- Ensure sidebar/home do not duplicate expensive org-level queries on initial paint.
- Consider centralizing `useSession` consumption in shell context to reduce repeated client auth fetches.

### Phase C: Land services subpath import migration

- Replace root `@proliferate/services` imports with subpath imports in web/server hot paths.
- Keep `packages/services/package.json` explicit subpath exports.

Expected impact: smaller per-route compile graph, less CPU burst.

### Phase D: Provide deterministic dev fallback

- Add a documented fallback workflow: run web-only or reduced services for UI iteration.
- Add one command path using webpack fallback for comparison when Turbopack stalls (`pnpm dev:web:webpack`).

### Phase E: UX mitigation (separate from performance)

- Add route-level `loading.tsx` + visible shell spinner/skeleton to avoid “white page” perception while waiting.
- This does not fix root cause, but removes debugging ambiguity for users.

## 10. Validation Criteria

Use cold-start and warm-start scenarios.

Success thresholds:
- First `/dashboard` usable shell under 3-5s locally.
- No `CONNECT_TIMEOUT` in first-load flow.
- `get-session` p95 under 500ms after first warm request.
- Core dashboard endpoints (`getStatus`, `sessions/list`, `listOrgPendingRuns`, `actions/list`) no synchronized 10-50s stalls.

Test sequence:
1. Restart web dev server and open `/dashboard`.
2. Capture first 20 requests with compile/render splits.
3. Navigate sidebar rapidly between 4-5 sections.
4. Repeat after one file save (HMR) to validate pool stability.

## 11. What Is Already Done vs Pending

Already merged:
- Pool singleton + timeout hardening (#186, #3c53cfa)
- Migration journal fix for fresh DB boot

Not merged (local experiments present in working tree):
- Broad services subpath import migration across web/server files
- Additional request-gating/poll-interval tuning on dashboard hooks/components
- Route loading components in new files

## 12. Advisor TL;DR

If we only do one thing next: **land compile-graph reduction (services subpath imports) + aggressively reduce dashboard startup fan-out with instrumentation to prove impact**.

The biggest clue is still the same: many unrelated endpoints stalling for nearly identical durations indicates shared runtime contention, not one bad SQL statement.

## 13. New Evidence Added (2026-02-19 Follow-up)

### 13.1 Recent PR Window (exact commits)

Merged sequence around first reported latency regressions:
- `82fe1a6` (PR #183): 39 files changed, +1794/-627
- `42a049f` (PR #184): 36 files changed, +2204/-108
- `cf1ec2c` (PR #185): 7 files changed, +287/-135
- `5873640` (PR #186): 3 files changed, +49/-32
- `3c53cfa`: 2 files changed, +2/-2 (dev timeout bump)

Most relevant behavior changes in this window:
1. `PR #183` introduced eager integration checks in environment picker on mount (later locally gated).
2. `PR #184` expanded dashboard IA and inbox usage; `useAttentionInbox` is mounted in sidebar paths, increasing default org-level fan-out (`actions/list` + `automations/listOrgPendingRuns`).
3. `PR #186` + `3c53cfa` made connection issues fail less often by increasing dev timeouts to 60s, but this can convert failures into long stalls.

### 13.2 Compile Graph Pressure on `main` vs local tree

Measured root-barrel imports in web app:
- `main` (`HEAD` tree): `42` imports from `@proliferate/services` root barrel.
- local working tree: `0` root-barrel imports in `apps/web/src` (rewritten to subpath imports).

Command evidence:
- `git grep -n "from '@proliferate/services'" HEAD -- apps/web/src | wc -l -> 42`
- `rg -n "from '@proliferate/services'" apps/web/src | wc -l -> 0`

Interpretation:
- `main` still compiles a much broader module tree for web route entrypoints.
- Local subpath migration should reduce Turbopack/SWC compile amplification once merged cleanly.

### 13.3 Direct Runtime Evidence of Event-Loop/Compiler Saturation

Observed during slow state:
- `next-server` at ~`323%` to `335%` CPU for >9 minutes.
- `sample <pid>` showed main work inside `next-swc.darwin-arm64.node` call stacks.
- sampled physical footprint: ~`7.2GB`.

This directly supports "compiler/event-loop starvation" over "single bad DB query".

### 13.4 Controlled Repro After Clean Web-Only Restart

Ran web dev with `DEV_USER_ID` set (no manual auth needed) and issued concurrent dashboard-like API burst.

Cold concurrent burst:
- `GET /api/auth/get-session` ~`0.91s`
- `POST /api/rpc/actions/list` ~`1.62s`
- `POST /api/rpc/onboarding/getStatus` ~`1.63s`
- `POST /api/rpc/automations/listOrgPendingRuns` ~`1.63s`
- `POST /api/rpc/sessions/list` ~`1.64s`

Warm concurrent burst:
- all above ~`0.03s` to `0.06s`

Server log corroboration:
- cold requests: compile dominated (`~1.56s` compile each)
- warm requests: compile near-zero (`~8-14ms`)

Interpretation:
- Slowdown is not deterministic in a clean web-only run.
- Severe 10-60s stalls are likely triggered by a saturated/degenerate local dev state (compile storm + fan-out + additional concurrent watchers/services), not a permanently slow DB path.

### 13.5 Transient White-Screen Confounder Captured in Dev Log

`apps/web/.next/dev/logs/next-development.log` contained a hydration error snapshot from an earlier bad local state:
- "In HTML, text nodes cannot be a child of `<html>`"
- stack excerpt showed stray text (`asdf`) under `<RootLayout>`.

Current source no longer contains this token, but this confirms at least one white-screen episode was caused by invalid local JSX structure, independent of DB latency.

## 14. Proposal v2 (Advisor Review)

1. **Land compile-graph reduction first**
- Merge the subpath import migration for `apps/web/src/**` + `packages/services/package.json` exports.
- Add lint guardrail forbidding `@proliferate/services` root imports in web routes/routers.

2. **Enforce startup fan-out budget**
- Keep non-critical queries gated:
  - environment/integrations only when popovers/dialogs open.
  - support Slack status only when support popover is open.
  - avoid duplicate inbox polling sources on desktop shell mount.
- Keep polling intervals conservative for non-visible surfaces.

3. **Instrument queue vs handler time**
- Log per-request correlation IDs with:
  - queue-start timestamp,
  - handler-start timestamp,
  - auth duration,
  - DB execution duration.
- Goal: prove whether long wall time is mostly pre-handler queueing/compile wait.

4. **Separate workflow profiles for local dev**
- Add a documented "UI fast path" profile (web-only, optional worker/trigger off) and keep current full-stack mode for integration testing.
- Add webpack fallback command for comparison when Turbopack gets wedged.

5. **Operational runbook for "slow again" incidents**
- Capture immediately:
  - `ps` CPU for `next-server`,
  - one `sample <pid>`,
  - recent `.next/dev/logs/next-development.log` tail,
  - 5-request concurrent curl burst timings.
- This gives deterministic triage data instead of subjective stall reports.

## 15. Implementation Snapshot (Applied Locally)

The following advisor-approved items are now implemented in the local tree:

1. **oRPC queue vs auth timing instrumentation**
- File: `/Users/pablo/proliferate/apps/web/src/server/routers/middleware.ts`
- Added:
  - event-loop lag probe via `setImmediate`
  - per-request timing for `protectedProcedure` and `orgProcedure`
  - slow-log thresholds (dev-only by default)
- Env toggles:
  - `ORPC_TIMING=0` disables timing logs in development
  - `ORPC_SLOW_TOTAL_MS` (default `1500`)
  - `ORPC_SLOW_AUTH_MS` (default `1000`)
  - `ORPC_SLOW_EVENT_LOOP_MS` (default `100`)

2. **Deterministic UI-focused dev profiles**
- File: `/Users/pablo/proliferate/package.json`
- Added scripts:
  - `pnpm dev:ui`
  - `pnpm dev:ui:webpack`
- Purpose: run only web + services to reduce full-stack watcher contention when debugging dashboard latency.

3. **Validation run**
- `pnpm --filter @proliferate/web typecheck` passed.
- `pnpm --filter @proliferate/web exec eslint --config eslint.config.mjs src/server/routers/middleware.ts` passed.
