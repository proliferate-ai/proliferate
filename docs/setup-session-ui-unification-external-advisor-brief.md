# Setup Session UI Unification - External Technical Advisor Brief

Prepared: February 19, 2026
Audience: External technical advisor with no repository access
Scope: Full context and concrete implementation plan for fixing setup-session UX divergence across page and modal surfaces

---

## 1) Why This Document Exists

We have a product-level inconsistency where setup sessions are correctly created server-side, but only one UI route exposes setup-specific controls.

The practical effect is:

- setup behavior works in backend/runtime (tooling, prompt, events)
- setup completion UX is only present on the dedicated `/workspace/setup/[id]` page
- many setup entry points land users in generic `CodingSession` UI without the setup banner and without a visible finalization action

This brief is intended to let an external reviewer evaluate the proposed fix without needing direct code access.

---

## 2) Architecture and Boundary Context

High-level shape:

```text
Client <-> WebSocket <-> Gateway <-> Sandbox (Modal/E2B + OpenCode)
                    |
        Next.js API/oRPC: lifecycle + metadata
        Postgres: metadata only
```

Important boundary rule:

- API routes are not in the token streaming path.
- Real-time behavior is client <-> gateway <-> sandbox.
- Web app routes/components decide presentation only.

Implication for this issue:

- Session type and tools are already correct server-side.
- Missing UX is a web presentation/composition problem, not gateway correctness.

---

## 3) Terms Used in This Brief

- Setup session: session record with `sessionType = "setup"`.
- Setup chrome: setup-specific UI (banner, progress text, intro modal, finalize button).
- Finalize API call: web oRPC procedure that snapshots and marks configuration ready (`configurations.finalizeSetup`).
- Finalize action: explicit user click on the setup CTA ("Done - Save Snapshot") that triggers the Finalize API call.
- Dedicated setup route: `/workspace/setup/[repoId]`.
- Generic workspace route: `/workspace/[sessionId]`.

---

## 4) Executive Summary of the Bug

Current system has two classes of setup entry points:

1. Entry points that end in dedicated setup page.
2. Entry points that end in generic `CodingSession` surfaces (modal or `/workspace/[sessionId]`).

Both create real setup sessions, but only class (1) gets setup chrome and a visible finalization path.

Result:

- User sees a normal coding UI for a setup session.
- Agent prompt tells user to click "Done - Save Snapshot" (from setup system prompt), but that control may not exist on that surface.
- Session can run setup tools, but manual completion is hidden or missing.

---

## 5) Code-Verified Current Behavior

### 5.1 Setup sessions are created correctly

Evidence:

- `apps/web/src/stores/coding-session-store.ts:74` sets `sessionType: "setup"` in `openSetupSession(...)`.
- `apps/web/src/components/coding-session/coding-session-modal.tsx:36` sends `sessionType` into create mutation.
- `apps/web/src/server/routers/sessions-create.ts:79` passes `sessionType` through to session record creation.
- `packages/db/src/schema/sessions.ts:26` stores `session_type` (default `coding`, explicit `setup` when passed).

### 5.2 Setup prompt and tools are correctly wired

Evidence:

- Setup prompt includes explicit UI instruction for finalization:
  - `packages/shared/src/prompts.ts:8`
- Tool routing and mode-scoped behavior are implemented in gateway/provider code and documented in specs:
  - `docs/specs/agent-contract.md:36`, `docs/specs/agent-contract.md:46`
  - `docs/specs/sandbox-providers.md:199`

### 5.3 Setup-specific UI is route-coupled to one page

Dedicated page has setup chrome:

- `apps/web/src/app/(workspace)/workspace/setup/[id]/page.tsx:124` setup banner
- `apps/web/src/app/(workspace)/workspace/setup/[id]/page.tsx:153` "Done - Save Snapshot" button
- `apps/web/src/app/(workspace)/workspace/setup/[id]/page.tsx:121` `SetupIntroModal`

Generic `CodingSession` does not branch on `sessionType`:

- `apps/web/src/components/coding-session/coding-session.tsx:77` reads `sessionData`
- no `sessionType`-driven setup chrome rendering exists in this component

### 5.4 Progress events exist but are not session-scoped in UI

Progress store is a global singleton state object (multiple fields, not keyed per session):

- `apps/web/src/stores/setup-progress.ts:37`

Runtime handlers always update this global store:

- `apps/web/src/components/coding-session/runtime/message-handlers.ts:76`
- `apps/web/src/components/coding-session/runtime/message-handlers.ts:126`
- `apps/web/src/components/coding-session/runtime/message-handlers.ts:170`

Only dedicated setup page currently reads and renders that progress state:

- `apps/web/src/app/(workspace)/workspace/setup/[id]/page.tsx:31`

### 5.5 Finalization is currently initiated from dedicated route UI

Client hook:

- `apps/web/src/hooks/use-sessions.ts:205` (`useFinalizeSetup`)

Router entry:

- `apps/web/src/server/routers/configurations.ts:273`

Handler:

- `apps/web/src/server/routers/configurations-finalize.ts:35`

The current hook shape is `repoId + sessionId`, and dedicated page supplies repo ID from URL (`/workspace/setup/[repoId]`). Generic modal/page surfaces do not have this route context.

### 5.6 Setup entry-point matrix (current)

| Entry point | Code path | Destination UI | Setup chrome visible? | Manual finalize visible? |
|---|---|---|---|---|
| New session with `type=setup` | `apps/web/src/app/(workspace)/workspace/new/page.tsx:54` redirect | `/workspace/setup/[repoId]` | Yes | Yes |
| Dedicated setup page flow | `apps/web/src/app/(workspace)/workspace/setup/[id]/page.tsx` | Full page setup | Yes | Yes |
| Edit environment from configuration group | `apps/web/src/components/dashboard/configuration-group.tsx:120` -> `openSetupSession` | `CodingSessionModal` | No | No |
| Pencil from snapshot selector | `apps/web/src/components/dashboard/snapshot-selector.tsx:238` -> `openSetupSession` | `CodingSessionModal` | No | No |
| Edit existing setup snapshot | `apps/web/src/stores/coding-session-store.ts:110` (`openEditSession`) | `CodingSessionModal` | No | No |
| Config list row action "Set Up/Update Environment" | `apps/web/src/app/(command-center)/dashboard/configurations/page.tsx:258` | `/workspace/[sessionId]` | No | No |
| Config detail page "Set Up/Update Environment" | `apps/web/src/app/(command-center)/dashboard/configurations/[id]/page.tsx:73` | `/workspace/[sessionId]` | No | No |
| Sidebar "New configuration" create flow | `apps/web/src/components/dashboard/add-snapshot-button.tsx:24` | `/workspace/[sessionId]` | No | No |

### 5.7 Adjacent inconsistency discovered during review

`CreateSnapshotContent` label says "Create and start setup":

- `apps/web/src/components/dashboard/snapshot-selector.tsx:570`

But some consumers drop the returned `sessionId` and only close dialog:

- `apps/web/src/components/dashboard/environment-picker.tsx:318`
- `apps/web/src/app/(command-center)/dashboard/configurations/page.tsx:177`

Potential effect: setup session is created but user is not navigated to it.

This is a distinct defect (silent orphan setup sessions), not just a symptom of missing setup chrome. It is included in Track A acceptance criteria.

---

## 6) Why This Is Happening (Root Cause)

Root cause is architectural in the web layer:

1. Setup semantics are represented in backend/session data (`sessionType`) but setup UI is implemented as page-local markup in one route component.
2. Shared session renderer (`CodingSession`) does not consume `sessionType` for presentation.
3. Finalization affordance is tied to route context (`repoId` from URL) instead of session context.
4. Setup progress store is not session-scoped; it is a single global state object.

Short version: setup behavior is data-driven on backend but route-driven on frontend.

---

## 7) Product and Technical Impact If Unchanged

- UX contradiction: agent asks for a button that does not exist on many surfaces.
- Completion reliability: users can finish setup work but fail to finalize snapshot due to absent CTA.
- Support burden: "setup completed but configuration not ready" confusion.
- Data consistency risk: more setup sessions in running/partial states without transition to finalized configuration.
- Trust issue: same action behaves differently depending on navigation entry point.

---

## 8) Goals and Non-Goals

### Goals

- Any session with `sessionType="setup"` should show setup chrome regardless of surface.
- Manual finalization should be available anywhere that session is interactive.
- Setup progress should reflect only the active setup session.
- Dedicated setup route can remain, but should compose shared setup UI.

### Non-goals

- Rewriting gateway/session runtime.
- Changing tool contracts (`save_snapshot`, `verify`, etc.).
- Redesigning the entire session layout.
- New DB schema migration.

---

## 9) Concrete Implementation Plan

### Phase 0: Refactor guardrails and compatibility decisions

Decision points before coding:

- Keep dedicated `/workspace/setup/[repoId]` route for onboarding continuity.
- Add session-type-driven setup chrome in shared `CodingSession` so all surfaces become consistent.
- Keep manual finalization button (do not rely only on agent auto tool calls).
- Split delivery into two tracks to reduce blast radius:
  - Track A (this patch): setup chrome/finalize parity and correctness on all current surfaces.
  - Track B (follow-up patch): standardize setup entry points to full-page routes and phase out modal setup launches.

### Phase 1: Extract shared setup chrome

Create a reusable component:

- New: `apps/web/src/components/coding-session/setup-session-chrome.tsx`

Responsibilities:

- Render setup context banner text.
- Render setup progress message from setup-progress store.
- Render finalize button + tooltip.
- Optionally render `SetupIntroModal`.

Inputs:

- `sessionId`
- `repoId` or fallback derivation capability
- `isFinalizing`
- `onFinalize`
- optional `showIntro`
- optional mode flag for modal/full-page spacing

### Phase 2: Make `CodingSession` session-type aware

Update:

- `apps/web/src/components/coding-session/coding-session.tsx`

Add behavior:

- Detect `isSetupSession = sessionData?.sessionType === "setup"`.
- If true, render shared `SetupSessionChrome` above existing chat/panel layout.
- Ensure this applies to all currently supported setup surfaces:
  - full-page generic workspace route (`/workspace/[sessionId]`)
  - dedicated setup route composition
  - existing modal setup flows (Track A compatibility)
- Explicitly handle `sessionType` loading latency:
  - while `sessionData` is unresolved, render existing loading shell only
  - render setup chrome only after `sessionData` resolves
  - avoid visible layout jump by reserving header space or using a banner skeleton

This is the central unification change.

### Phase 3: Simplify dedicated setup page to use shared chrome

Update:

- `apps/web/src/app/(workspace)/workspace/setup/[id]/page.tsx`

Changes:

- Keep setup session creation flow (repoId -> create config -> create setup session).
- Remove duplicated inline banner/finalize markup.
- Mount shared `SetupSessionChrome` instead.

Result:

- one source of truth for setup UI copy and finalize behavior.

### Phase 4: Make finalization callable from all setup surfaces

Current limitation:

- finalize hook currently wants route-derived `repoId` plus `sessionId`.

Proposed contract hardening:

- Keep existing procedure name for compatibility.
- Add optional repo derivation path when `repoId` is not explicitly available.

Deterministic decision tree in `configurations-finalize.ts`:

1. Load session by `sessionId`.
2. Validate `sessionType === "setup"` and sandbox exists.
3. Resolve target repo for repo-scoped operations (`resolvedRepoId`):
   - If caller supplied `repoId`: use it, then verify session association via `repoId` or configuration membership.
   - Else if `session.repoId` is non-null: use it.
   - Else if `session.configurationId` is null: reject (`repoId required`).
   - Else load `configurationRepos` for `session.configurationId`.
     - If exactly one repo: use that repo.
     - If more than one repo:
       - If `secrets` payload is non-empty: reject (`repoId required for multi-repo secret persistence`).
       - If `secrets` payload is empty: proceed with snapshot + configuration update, skip repo-scoped secret writes.
     - If zero repos: reject (`configuration has no repos`).
4. Continue snapshot + configuration update flow.

Data-shape context this decision tree depends on:

- In web create path, configuration-backed session creation does not set `session.repoId` (session row is written with `configurationId`, not `repoId`), so fallback to configuration repos is expected in many cases.
- Configurations are 1..N repos (`createConfiguration` accepts `repoIds[]` and writes `configuration_repos`), so repo inference can be ambiguous by design.

Files:

- `apps/web/src/hooks/use-sessions.ts`
- `apps/web/src/server/routers/configurations.ts`
- `apps/web/src/server/routers/configurations-finalize.ts`

### Phase 5: Session-scope setup progress state

Problem:

- global progress state can leak across session transitions.

Update store shape:

- `apps/web/src/stores/setup-progress.ts`

From:

- singleton milestone fields in one global object

To:

- session-keyed state map or explicit active-session state with `sessionId` guard

Update runtime handlers:

- `apps/web/src/components/coding-session/runtime/message-handlers.ts`

Changes:

- pass `sessionId` through message handler context
- `hydrateFromHistory(sessionId, ...)`
- `onToolStart(sessionId, toolName)`
- `onToolEnd(sessionId)`

Reset behavior:

- clear progress on session switch/unmount for the relevant key.

### Phase 6: Normalize entry-point behavior that claims "start setup"

Track A (this patch):

- Ensure all setup triggers navigate users to the created session page (`/workspace/[sessionId]`) and do not silently close dialogs.

At minimum fix callers currently discarding `sessionId`:

- `apps/web/src/components/dashboard/environment-picker.tsx:318`
- `apps/web/src/app/(command-center)/dashboard/configurations/page.tsx:177`

Track B (follow-up patch):

- Remove or deprecate setup modal launch paths (`openSetupSession`, `openEditSession`) in favor of explicit route navigation.
- Add any UX migration affordances needed for callers currently expecting modal behavior.

---

## 10) Proposed Target Behavior (Post-Fix)

For any session row where `session.sessionType === "setup"`:

- Show setup context banner in the active session surface.
- Show setup progress text transitions:
  - starting
  - env requested
  - verified
  - snapshot saved (tool-level)
- Show "Done - Save Snapshot" action for manual finalize.
- Keep normal coding panels (terminal, services, git, preview) unchanged.
- Long-term preferred surface is full-page workspace session (`/workspace/[sessionId]`), with modal setup as transitional compatibility only.

For non-setup sessions:

- no setup chrome
- no behavior changes

---

## 11) Alternatives Considered

### Alternative A: Force all setup entries to dedicated `/workspace/setup/[repoId]`

Pros:

- low UI refactor complexity
- no need to make `CodingSession` setup-aware

Cons:

- breaks existing modal setup UX pattern
- requires broad navigation rewrites
- still leaves session-type concern route-coupled

Assessment: rejected.

### Alternative B: Add setup UI only to modal, keep generic full-page unchanged

Pros:

- quick win for modal complaint

Cons:

- still inconsistent for `/workspace/[sessionId]` setup sessions
- bug survives in several flows

Assessment: rejected.

### Alternative C (recommended): Session-type-driven setup chrome in shared renderer

Pros:

- fixes all surfaces in one abstraction
- aligns frontend with backend source-of-truth (`sessionType`)
- reduces duplicated setup UI code

Cons:

- moderate refactor touching several web files

Assessment: recommended.

---

## 12) Risks and Mitigations

Risk: finalize semantics for multi-repo setup and secrets scope are ambiguous.
Mitigation: require explicit `repoId` only when secrets payload is present and repo cannot be inferred uniquely.

Risk: setup chrome appears for historical or non-interactive setup sessions.
Mitigation: gate finalize CTA by runtime readiness (`status === running` and `sandboxId` present).

Risk: progress state cross-contamination between sessions.
Mitigation: session-keyed store updates and reset on session switch.

Risk: regressions in dedicated setup page behavior.
Mitigation: keep route creation flow unchanged; only replace duplicated UI markup.

Risk: doc/spec drift already exists around finalize route naming/path.
Mitigation: update relevant specs in same PR with implemented file references.

---

## 13) Testing and Verification Plan

### Unit / component tests (recommended)

- Setup chrome render condition:
  - given `sessionType=setup`, banner is visible
  - given `sessionType=coding`, banner is hidden
- Progress derivation:
  - `request_env_variables` marks env requested
  - `verify` marks verified
  - `save_snapshot` marks snapshot saved
- Finalize button state:
  - disabled when not runnable
  - pending state text during mutation

### Integration checks (manual required)

1. Dedicated onboarding setup flow (`/workspace/setup/[repoId]`)
2. Modal `openSetupSession` flow from configuration group
3. Modal edit flow from snapshot selector pencil
4. Config list page "Set Up Environment" -> `/workspace/[sessionId]`
5. Config detail page "Set Up Environment" -> `/workspace/[sessionId]`
6. Sidebar "New configuration" flow from `AddSnapshotButton`

For each:

- verify setup banner visible
- verify progress text changes when tools execute
- verify finalization succeeds and configuration status updates to ready

### Regression checks

- regular coding sessions unchanged
- scratch sessions unchanged
- automation sessions unchanged

---

## 14) Rollout and Observability

### Rollout strategy

- Ship Track A as one cohesive web patch (no DB migration).
- If desired, gate setup chrome on a temporary frontend flag for staged rollout.
- Preserve Track B (modal deprecation) as a separate follow-up to keep rollback surface small.

### In-flight sessions at deploy time

- Active setup sessions will not lose actual session state on deploy (session/tool state remains in gateway + DB).
- UI-local setup progress indicators may reset on refresh/deploy because frontend store state is in-memory.
- Mitigation: rehydrate milestones from message history during `init`; transient `activeTool` may still be briefly empty until the next tool event.

### Suggested telemetry additions

Track events:

- `setup_chrome_rendered` with `{ surface: modal|workspace|setup_page }`
- `setup_finalize_clicked`
- `setup_finalize_succeeded`
- `setup_finalize_failed`

Instrumentation points:

- `setup_chrome_rendered`: fire in `SetupSessionChrome` mount effect after `sessionType === "setup"` is confirmed.
- `setup_finalize_clicked`: fire in the setup CTA click handler before mutation call.
- `setup_finalize_succeeded` / `setup_finalize_failed`: fire in `useFinalizeSetup` mutation callbacks (`onSuccess`/`onError`), and mirror with server-side structured logs in `configurations-finalize.ts` for auditability.

Success signal:

- drop in setup sessions that execute setup tools but never finalize.
- reduced support reports about missing done/save action.

---

## 15) Specs That Should Be Updated in Same PR

Given behavior changes in web setup presentation and finalize accessibility:

- `docs/specs/repos-prebuilds.md`
- `docs/specs/agent-contract.md`
- `docs/specs/feature-registry.md` (only if status/evidence table needs updates)

Status note:

- `repos-prebuilds.md` stale references to `repos-finalize.ts` were corrected to `configurations-finalize.ts` in this update.

---

## 16) Advisor Review Outcomes (Resolved Positions)

1. Finalization should remain an explicit human action for interactive setup sessions.
2. Headless or unattended managed prebuild flows may auto-finalize when no user is present (out of scope for this patch).
3. Canonical secret scope in multi-repo setup should be configuration/environment-level.
4. If schema constraints require repo-scoped writes, require explicit disambiguation instead of server-side guessing.
5. Setup should keep the standard coding workspace affordances plus setup chrome (do not hide terminal/services/files).
6. Setup entry points should be standardized to full-page routes; setup modals should be phased out in follow-up Track B.

---

## 17) Concrete Work Breakdown (Engineering Task List)

1. Add `SetupSessionChrome` component and move setup banner/finalize UI into it.
2. Add setup detection and chrome rendering in `CodingSession`.
3. Replace duplicated setup UI in `/workspace/setup/[id]` with shared component.
4. Update finalize hook + router/handler to support session-context invocation.
5. Session-scope setup progress store and runtime handler wiring.
6. Fix `CreateSnapshotContent` consumer callbacks that drop `sessionId` (separate defect, included in Track A).
7. Run lint/typecheck/manual flow matrix.
8. Update specs in same PR.
9. Track B follow-up: replace setup modal launches with full-page route navigation.

---

## 18) Acceptance Criteria

- Any interactive setup session, regardless of where opened, shows setup chrome and manual finalization CTA.
- Finalization succeeds from generic workspace route and from the dedicated setup bootstrap flow.
- Setup progress does not leak between sessions.
- Non-setup session UX is unchanged.
- Setup-create flows do not silently drop returned `sessionId`; user is always routed/opened into the created setup session.
- Specs reflect actual implementation file paths and behavior.

---

## 19) Appendix A - Key File References

Core setup flow and UI:

- `apps/web/src/stores/coding-session-store.ts`
- `apps/web/src/components/coding-session/coding-session-modal.tsx`
- `apps/web/src/components/coding-session/coding-session.tsx`
- `apps/web/src/components/coding-session/setup-session-chrome.tsx` (proposed)
- `apps/web/src/app/(workspace)/workspace/setup/[id]/page.tsx`
- `apps/web/src/components/sessions/setup-intro-modal.tsx`
- `apps/web/src/stores/setup-progress.ts`
- `apps/web/src/components/coding-session/runtime/message-handlers.ts`

Finalize path:

- `apps/web/src/hooks/use-sessions.ts`
- `apps/web/src/server/routers/configurations.ts`
- `apps/web/src/server/routers/configurations-finalize.ts`

Entry points:

- `apps/web/src/components/dashboard/configuration-group.tsx`
- `apps/web/src/components/dashboard/snapshot-selector.tsx`
- `apps/web/src/components/dashboard/add-snapshot-button.tsx`
- `apps/web/src/app/(command-center)/dashboard/configurations/page.tsx`
- `apps/web/src/app/(command-center)/dashboard/configurations/[id]/page.tsx`
- `apps/web/src/app/(workspace)/workspace/new/page.tsx`

Prompt/tool contract context:

- `packages/shared/src/prompts.ts`
- `docs/specs/agent-contract.md`
- `docs/specs/sessions-gateway.md`
- `docs/specs/repos-prebuilds.md`

---

## 20) Implementation Gotchas (From Advisor Review)

1. Prevent layout shift when `sessionType` loads asynchronously:
   - while `sessionData` is unresolved, render loading shell only
   - after resolve, mount setup chrome in a reserved header slot (or banner skeleton) to avoid chat jump
2. Add cleanup for session-keyed setup-progress entries on unmount/session switch to avoid dictionary growth.
3. If setup modals are temporarily retained during migration, guard accidental close (`outside click` / `Escape`) with explicit confirmation when setup is not finalized.
