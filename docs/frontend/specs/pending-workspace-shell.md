# Pending Workspace Shell And Session Intents

Status: authoritative for pending workspace entry, projected session shell, and
optimistic outbound session work in the desktop frontend.

Scope:

- `desktop/src/lib/domain/workspaces/creation/pending-entry.ts`
- `desktop/src/hooks/workspaces/use-workspace-entry-flow.ts`
- `desktop/src/hooks/workspaces/use-workspace-entry-actions.ts`
- `desktop/src/hooks/workspaces/workflows/pending-workspace-session-shell.ts`
- `desktop/src/hooks/workspaces/workflows/use-pending-workspace-session-materialization.ts`
- `desktop/src/hooks/home/workflows/use-home-next-launch.ts`
- `desktop/src/lib/domain/workspaces/sidebar/**`
- `desktop/src/lib/domain/workspaces/mobility/**`
- `desktop/src/lib/domain/workspaces/tabs/**`
- `desktop/src/lib/domain/chat/surface/**`
- `desktop/src/lib/domain/chat/outbox/**`
- `desktop/src/stores/chat/prompt-outbox-store.ts`
- `desktop/src/stores/sessions/session-selection-store.ts`

Read this doc before changing new-workspace launch, pending workspace UI,
optimistic session creation, queued prompts, projected chat tabs, workspace
arrival panels, or sidebar/footer/header state during workspace materialization.

## Scope Map

Use this map to decide where to look first.

| Path | Owns |
| --- | --- |
| `lib/domain/workspaces/creation/pending-entry.ts` | The pending workspace data model, pending UI key, request kinds, and pending path helpers. |
| `hooks/workspaces/use-workspace-entry-flow.ts` | Shared begin/finalize/fail workflow for entering a pending workspace and handing it off to a real workspace. |
| `hooks/workspaces/use-workspace-entry-actions.ts` | UI-facing workspace creation actions for local/worktree entry, including deterministic worktree projection and pending shell entry. |
| `hooks/workspaces/workflows/pending-workspace-session-shell.ts` | Creation of projected client session records under a pending workspace key. |
| `hooks/workspaces/workflows/use-pending-workspace-session-materialization.ts` | Remapping projected sessions to the real workspace and starting real AnyHarness sessions after workspace materialization. |
| `hooks/home/workflows/use-home-next-launch.ts` | Home launch orchestration: create pending workspace, enqueue the initial prompt, and avoid second-session fallback. |
| `lib/domain/workspaces/sidebar/**` | Pure sidebar group/item projection, including pending sidebar rows and pending-to-real row handoff. |
| `lib/domain/workspaces/mobility/**` | Pure composer footer projection for local/cloud/worktree identity, including pending workspace footer context. |
| `lib/domain/workspaces/tabs/**` | Pure shell tab projection and ordering, including projected chat tabs for pending workspace keys. |
| `lib/domain/chat/surface/**` | Pure chat surface arbitration: launch intent, pending projected session, empty session, transcript, and loading states. |
| `lib/domain/chat/outbox/**` | Pure prompt outbox model, selectors, projection, dispatch predicates, and reconciliation rules. |
| `stores/chat/prompt-outbox-store.ts` | Client-owned queued prompt records and local prompt outbox mutations. No dispatch. |
| `stores/sessions/session-selection-store.ts` | Selected workspace/session ids, pending workspace entry, arrival event, and local selection transactions. |

## 1. Purpose

Workspace and session creation has hard latency:

- a workspace may need filesystem, git, cloud, or setup-script work
- a runtime session may need AnyHarness session creation and stream attachment
- a submitted prompt may need runtime acknowledgement before it appears in the
  authoritative transcript

The UI must not wait for those steps before showing the target shell. The first
workspace render should look like the eventual materialized shell, with the same
header actions, chat tab, model/config controls, composer footer, sidebar row,
and queued user work.

The system has one job:

> Convert a user intent into a stable projected workspace/session surface
> immediately, then reconcile that projection with the real runtime objects
> when they materialize.

## 2. Vocabulary

**Pending workspace entry**

`PendingWorkspaceEntry` is the client-side record for one workspace creation or
entry attempt. It owns the attempt id, request kind, deterministic display
data, stage, materialized workspace id once known, setup status, and failure
state.

**Pending workspace UI key**

`pending-workspace:<attemptId>` is the temporary logical workspace key used
before a real logical workspace exists. It is never persisted as the last stable
workspace selection.

**Materialized workspace id**

The real AnyHarness or cloud workspace id returned by creation/select flows.
Pending entries may learn this id before workspace selection has finished.

**Projected session**

A client session record created before a real AnyHarness session exists. It is
stored under the pending workspace UI key and is used by header tabs, model
controls, chat surface state, and queued prompts.

**Launch intent**

A transient marker for a home/new-workspace launch. It can help the UI know
that a launch is underway, but it is not the source of shell truth once a
pending workspace entry or projected session exists.

**Outbox**

Client-owned outbound work that must render immediately and dispatch once the
target session can accept it. Today this is prompt-specific
(`prompt-outbox-store`). If generalized to session intents, keep the same
projection, dispatch, and reconciliation split described here.

## 3. Core Invariants

1. The first pending shell render must be final-looking.
   Workspace title, path, branch, footer, header actions, chat tab, model
   identity, and config controls must be present from the first workspace
   render.

2. Creation inputs are deterministic before shell entry.
   Worktree workspace name, branch name, base ref, repo label, and target path
   are computed before `beginPendingWorkspace`. If the backend reports a
   conflict, show the pending failure; do not regenerate names after entering
   the shell.

3. The pending entry is shell truth until finalization completes.
   Do not inject fake `LogicalWorkspace` rows. Use pending-specific projection
   helpers for shell surfaces that normally read real workspace state.

4. The projected session is chat truth before materialization.
   If a pending workspace has an active projected session, the chat surface
   renders the normal session surface. `ChatLaunchIntentPane` must not override
   a projected session shell.

5. Outbound user work renders before runtime acknowledgement.
   Submitted prompts are added to the outbox synchronously. Dispatch may wait
   for materialization, but rendering does not.

6. Materialization remaps, it does not recreate.
   A projected session is remapped from the pending workspace key to the real
   workspace and then materialized in AnyHarness. The launch flow must not
   create a second fresh session if the projected session exists.

7. Handoffs must preserve visible identity.
   During pending-to-real transition, sidebar/header/tab surfaces must not
   remove the active row and add a different row later. If the real logical id
   is known, the pending projection may render under that id and suppress the
   duplicate real item until pending state clears.

8. Failed pending work stays inspectable.
   Creation failures leave the pending shell in a failed state with retry/back
   controls. Do not navigate away or silently clear the pending entry on
   failure.

## 4. State Ownership

Use these owners. Do not introduce another general-purpose pending state owner.

| Concern | Owner | Notes |
| --- | --- | --- |
| Current selected ids and pending workspace entry | `session-selection-store` | Client-only local state. No APIs or persistence. |
| Projected and materialized session directory rows | session directory/session records stores | Records may initially point at a pending workspace key. |
| Shell tab intent | workspace UI shell-tab state | Written immediately for projected sessions. |
| Queued outbound prompts | `prompt-outbox-store` | Renders immediately, dispatches after session readiness. |
| Pending workspace request/path/branch helpers | `lib/domain/workspaces/creation/**` | Pure logic only. |
| Footer/header/sidebar/tabs projections | `lib/domain/workspaces/**` | Pure view-model helpers. No stores or access. |
| Beginning/finalizing workspace entry | `hooks/workspaces/**` workflow hooks | Coordinates stores, selection, focus, materialization. |
| Dispatch/reconciliation effects | lifecycle hooks | App-mounted effects own waits, streams, dispatch loops, and reconciliation. |

Stores hold facts and local transactions. They do not wait for work, dispatch
network calls, subscribe to streams, or decide UI projection rules.

## 5. Begin Flow

All workspace creation entrypoints should converge on this shape:

1. Resolve deterministic display and request data before shell entry.
   For worktrees this includes `workspaceName`, `branchName`, `baseBranch`,
   `repoLabel`, and `targetPath`.

2. Build a `PendingWorkspaceEntry`.
   The entry contains enough information for the shell to render without real
   workspace data.

3. Create the projected session shell, when the launch has a session.
   `ensurePendingWorkspaceSessionShell` creates a client session record under
   `pending-workspace:<attemptId>`.

4. Enter the pending workspace shell in one local transaction.
   `enterPendingWorkspaceShell` sets the pending entry, selected logical
   workspace id, selected workspace id, and active session id consistently.

5. Write shell tab intent immediately.
   Header tabs should see the projected session on the first shell render.

6. Queue initial outbound prompt against the projected session.
   Prompt enqueue success and projected-session existence are distinct. If the
   projected session exists, the fallback path must not create a second session.

7. Start the real workspace creation/select work in the background.

## 6. Finalization Flow

When the real workspace id is known:

1. Patch the pending entry with `workspaceId`.
   This lets projection helpers enter handoff mode.

2. Select the real workspace with `preservePending: true`.
   Selection should keep the pending shell active while the real logical
   workspace, sessions, file tree, and launch catalog load.

3. Preserve the projected active session id.
   If the active session belongs to the pending workspace key, pass it as the
   initial active session for real workspace selection.

4. Remap projected sessions to the real workspace.
   `usePendingWorkspaceSessionMaterialization` owns this. The prompt outbox
   remains the visible owner while the real AnyHarness session is created in
   the background.

5. Set the workspace arrival event.
   Arrival panels use this event to show the final "new worktree/workspace"
   context and setup-script state.

6. Clear pending workspace state after selection finalization.
   Do not clear as soon as the real workspace appears in cache. That creates a
   visible gap between the pending projection and the real row.

## 7. UI Projection Rules

Each surface that normally reads real workspace/session data needs a pending
projection path.

### Chat Surface

- Pending workspace with active projected session renders `session-empty` or
  `session-transcript`.
- Launch intent may supply launch context only before a projected session
  exists.
- If outbox/transcript content exists, content wins over launch copy.

### Header Tabs

- Tabs include projected session rows for pending workspace keys.
- The tab key must stay stable through materialization where possible.
- Do not wait for AnyHarness session creation before showing the tab.

### Model And Config Controls

- The model selector reads the projected session selection first.
- If the projected session has no materialized runtime yet, display labels must
  still use the same label mapping as the final session.
- Do not mix raw ids and presentation labels. For example, a reasoning setting
  should not render as one label pre-materialization and another label after
  session load.

### Workspace Footer

- Use `buildPendingMobilityFooterContext(entry)` for pending workspaces.
- Do not inject fake rows into `logicalWorkspaces`.
- The footer should show the final path/repo/branch immediately for local and
  worktree flows when those values are known.

### Sidebar

- Use `buildPendingSidebarProjection(entry)` for pending rows.
- Before materialization, the row id is `pending-workspace:<attemptId>`.
- During materialization handoff, if the selected real logical workspace id is
  known and the selected workspace id matches the pending entry's workspace id,
  the pending projection may render with the real logical id.
- Suppress the duplicate real item while the pending projection owns that id.
- Keep the active row visible even if it is outside the collapsed/sidebar item
  limit.

### Header Actions

- Header action shape should be stable while pending.
- Prefer disabled final-shape controls over absent controls when the eventual
  action is known but not yet available.

### Workspace Arrival Panel

- The attached panel renders pending/setup status above the composer.
- It should not be the only source of workspace identity. Header, tabs, footer,
  and sidebar each need their own pending projection.

## 8. Outbound Work And Future Session Intents

The current implementation has a prompt outbox. The target mental model is a
session-intent system, but do not prematurely replace the prompt outbox with a
large generic queue.

Use this split for current and future outbound work:

| Layer | Responsibility |
| --- | --- |
| Intent model | Typed payloads, ids, ordering, delivery state. No React. |
| Store | Ordered client-owned records and local mutations. No dispatch. |
| Projection helpers | How records affect visible UI before acknowledgement. |
| Dispatcher lifecycle | Finds dispatchable records and calls runtime access. |
| Reconciliation | Removes, settles, or retries records when runtime state catches up. |

Prompt intents are already real:

- enqueue synchronously on submit
- render as queued/outbox prompt rows
- dispatch after materialized session id exists
- reconcile when a renderable user-message echo appears in the transcript

Future intents should follow the same shape:

- `update_config`
- `resolve_interaction`
- `edit_queued_prompt`
- `delete_queued_prompt`
- `cancel_queued_intent`

Keep payloads typed. A shared dispatcher may process ordered records, but each
intent kind owns its own projection and reconciliation rules.

## 9. Action Routing Rules

Use these rules when deciding whether a user action can happen before
materialization:

- If the action affects visible chat history, enqueue and render immediately.
- If the action affects session launch/config and the projected session exists,
  update the projected session state immediately and dispatch when materialized.
- If the action resolves a visible runtime interaction, it may be queued only if
  the interaction is already visible and has a stable interaction id.
- If the action requires real workspace files, git state, or runtime commands,
  keep it disabled until `materializedWorkspaceId` exists.
- If the action would create a second session as a fallback, first check whether
  a projected session already exists. Projected-session existence blocks fresh
  fallback creation.

## 10. Failure And Recovery

Pending failures must preserve enough state to retry or exit cleanly:

- the pending workspace entry remains selected
- queued prompts remain visible and owned by the projected session
- setup/create errors render in the workspace status panel
- retry uses the original deterministic request unless the user explicitly
  changes it
- back/abort clears pending state and does not persist the pending workspace key

If materialization fails after a projected session exists, do not create a new
session automatically. The user should see the failed workspace shell and keep
their queued prompt.

## 11. Tests

Changes to this system should include focused tests near the owner being
changed.

Minimum coverage by concern:

- pending entry/path helpers: local, worktree, cloud path/label cases
- chat surface: pending projected session beats launch intent
- header tabs: projected pending session appears before materialization
- model selector: projected session labels match final labels
- mobility footer: pending worktree/local/cloud contexts render without fake
  logical workspace rows
- sidebar: pending row before materialization, handoff to real logical id, no
  duplicate item, active row visible under item limits
- finalization: projected sessions materialize before pending state clears
- home launch: initial prompt remains attached to the projected session and
  does not create a second fresh session
- outbox: queued prompt renders immediately and dispatch waits for materialized
  session id

## 12. Anti-Patterns

Do not:

- use launch intent as shell truth once a pending entry exists
- render a half-shell and fill in path/branch/model data later
- regenerate worktree names after entering the pending shell
- inject fake `LogicalWorkspace` rows for pending entries
- clear pending state when the real workspace merely appears in cache
- create a fresh session after a projected session exists
- hide queued user messages until AnyHarness acknowledges them
- put dispatch loops or wait/retry behavior in stores
- add component-local fixes for one shell surface when the same data belongs in
  a pure projection helper
- leave debug logging effects in render-heavy derived hooks after diagnosis

## 13. Debugging Checklist

When a pending workspace appears in stages, inspect in this order:

1. Was deterministic request data computed before `beginPendingWorkspace`?
2. Did `PendingWorkspaceEntry` contain path, branch, repo label, and display
   name on first shell render?
3. Did `ensurePendingWorkspaceSessionShell` create the projected session under
   the pending workspace UI key?
4. Did `enterPendingWorkspaceShell` set active session id in the same local
   transaction?
5. Did header tabs and chat surface read projected session state?
6. Did model/config controls read projected selection labels rather than raw
   fallback ids?
7. Did footer/sidebar use pending projection helpers rather than waiting for
   `logicalWorkspaces`?
8. During handoff, did the pending projection remain until selection
   finalization completed?
9. Did the outbox attach queued prompts to the projected session id?
10. Did any fallback path create a fresh session despite a projected session
    already existing?
