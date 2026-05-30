# Pending Workspace Shell, Session Intents, And Optimistic UI

Status: authoritative for pending workspace entry, projected session shell, and
optimistic outbound session work in the desktop frontend.

Read this doc before changing new-workspace launch, existing-workspace
selection/opening, pending workspace UI, optimistic session creation, queued
prompts, projected chat tabs, workspace arrival panels, optimistic
config/interaction handling, or sidebar/footer/header state during workspace
or session materialization.

This is a UI-side spec. It does not define AnyHarness runtime semantics. It
defines how the desktop renders immediately, stores outbound user work, and
reconciles that UI with AnyHarness and workspace materialization later.

## Scope Map

Use this map to decide whether this spec applies and where to look first.

| Path | Owns |
| --- | --- |
| `apps/desktop/src/lib/domain/workspaces/creation/pending-entry.ts` | Pending workspace model and path helpers. |
| `apps/desktop/src/lib/domain/workspaces/selection/optimistic-session-shell.ts` | Fast-open session candidate and placeholder rules. |
| `apps/desktop/src/hooks/workspaces/selection/run-workspace-selection.ts` | Existing workspace selection and first active-session projection. |
| `apps/desktop/src/hooks/workspaces/use-workspace-bootstrap-actions.ts` | Session-list bootstrap and optimistic session validation. |
| `apps/desktop/src/hooks/workspaces/use-workspace-entry-flow.ts` | Begin/finalize/fail handoff workflow. |
| `apps/desktop/src/hooks/workspaces/use-workspace-entry-actions.ts` | Local/worktree entry actions. |
| `apps/desktop/src/hooks/workspaces/workflows/pending-workspace-session-shell.ts` | Projected session creation. |
| `apps/desktop/src/hooks/workspaces/workflows/use-pending-workspace-session-materialization.ts` | Projected-to-real session remap. |
| `apps/desktop/src/hooks/home/workflows/use-home-next-launch.ts` | Home launch and first prompt flow. |
| `apps/desktop/src/lib/domain/workspaces/sidebar/**` | Pending sidebar projection and handoff. |
| `apps/desktop/src/lib/domain/workspaces/mobility/**` | Pending composer footer projection. |
| `apps/desktop/src/lib/domain/workspaces/tabs/**` | Projected tab projection and ordering. |
| `apps/desktop/src/lib/domain/chat/surface/**` | Chat surface arbitration. |
| `apps/desktop/src/components/workspace/chat/input/PendingPromptList.tsx` | Queued prompt action rendering. |
| `apps/desktop/src/components/workspace/chat/transcript/**` | Transcript and projected prompt rows. |
| `apps/desktop/src/components/workspace/shell/screen/StandardWorkspaceShell.tsx` | Shell composition. |
| `apps/desktop/src/components/workspace/shell/sidebar/**` | Sidebar UI. |
| `apps/desktop/src/lib/domain/sessions/intents/**` | Intent types, ordering, projection, reconciliation. |
| `apps/desktop/src/stores/sessions/session-intent-store.ts` | Ordered client session intents. |
| `apps/desktop/src/hooks/sessions/workflows/use-session-intent-actions.ts` | Prompt/config/interaction enqueue actions. |
| `apps/desktop/src/hooks/sessions/lifecycle/use-session-intent-dispatcher.ts` | Ordered runtime dispatcher. |
| `apps/desktop/src/stores/sessions/session-selection-store.ts` | Selected ids and pending entry. |

### Where To Start

Use these entry points when debugging or extending the system:

| Need | Start here |
| --- | --- |
| A new workspace shell appears in stages | `use-workspace-entry-actions.ts`, then `pending-entry.ts`, then the surface-specific projection helper. |
| A chat tab is missing before materialization | `pending-workspace-session-shell.ts`, then `workspaces/tabs/**`. |
| A prompt/config/approval waits for the runtime before rendering | `use-session-intent-actions.ts`, then `session-intent-selectors.ts`. |
| A queued prompt appears in the wrong place | `resolvePromptOutboxPlacement`, `renderableOutboxEntriesForTranscript`, and `queuedOutboxEntriesForSession`. |
| A queued action flickers or appears late | `pending-prompt-queue.ts` and the distinction between `show*Action` and `can*`. |
| A second session/tab appears after materialization | `use-home-next-launch.ts` and `use-pending-workspace-session-materialization.ts`. |
| A sidebar/header/footer row disappears during handoff | The matching pure projection helper under `lib/domain/workspaces/**`. |
| Opening an existing workspace briefly shows no tabs or an empty chat | `run-workspace-selection.ts`, then `optimistic-session-shell.ts`, then `use-workspace-bootstrap-actions.ts`. |

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

The user should never see the implementation timeline. A new workspace should
not look like "empty shell, then path, then tab, then model, then footer." A
queued prompt should not look like "text only, then controls." Config changes
should not appear applied, then roll back, then apply again. Those are all
projection bugs.

## 2. Mental Model

Optimistic UI is not a second UI. It is the normal shell rendered from two
sources:

1. Authoritative runtime/workspace state that already exists.
2. Client-owned projected state for work the user just requested.

There are three projected artifacts:

| Artifact | Exists because | Replaced by |
| --- | --- | --- |
| `PendingWorkspaceEntry` | The user entered or created a workspace before the real workspace selection is complete. | Real workspace selection plus real logical workspace data. |
| Projected client session | The user needs a chat surface before AnyHarness session creation finishes. | A materialized AnyHarness session bound to the same client session id. |
| Session intents | The user did session work before the runtime acknowledged it. | Transcript echoes, live config, queued prompt seqs, or settled interaction state. |

Every optimistic action follows the same sequence:

```text
user action
  -> synchronous projection
  -> async runtime/workspace dispatch
  -> stream/API acknowledgement
  -> reconciliation
```

The synchronous projection is mandatory. Dispatch is best effort and may wait
for a workspace id, session id, stream, or runtime queue seq.

### The Four Ledgers

When reasoning about a bug, keep these ledgers separate:

| Ledger | Example | Owner |
| --- | --- | --- |
| Shell selection | "the selected workspace is pending-workspace:123 and active session is client-session:abc" | `session-selection-store` |
| Projected shell records | "show a chat tab and model controls for client-session:abc" | session directory/session record stores plus shell tab intent |
| Outbound session intents | "send this prompt, then set config, then resolve permission" | `session-intent-store` |
| Runtime truth | "AnyHarness created session xyz and emitted transcript/config events" | AnyHarness SDK/query/stream state |

Do not merge these ledgers to make one surface easier. A pending workspace is
not a fake logical workspace. A projected session is not a real runtime
session. A session intent is not a transcript event.

## 3. Vocabulary

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

**Session intent**

Client-owned outbound session work that must preserve user order, render
immediately when it affects visible UI, and dispatch once the target session can
accept it. Session intents include prompt sends, config updates, interaction
responses, and queued prompt edit/delete actions.

## 4. Core Invariants

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
   Submitted prompts, config changes, and visible interaction responses are
   added to session intents synchronously. Dispatch may wait for
   materialization, but rendering does not.

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

## 5. State Ownership

Use these owners. Do not introduce another general-purpose pending state owner.

| Concern | Owner | Notes |
| --- | --- | --- |
| Current selected ids and pending workspace entry | `session-selection-store` | Client-only local state. No APIs or persistence. |
| Projected and materialized session directory rows | session directory/session records stores | Records may initially point at a pending workspace key. |
| Shell tab intent | workspace UI shell-tab state | Written immediately for projected sessions. |
| Queued outbound session work | `session-intent-store` | Ordered prompts, config updates, interaction responses, and queued prompt edits/deletes. |
| Pending workspace request/path/branch helpers | `lib/domain/workspaces/creation/**` | Pure logic only. |
| Footer/header/sidebar/tabs projections | `lib/domain/workspaces/**` | Pure view-model helpers. No stores or access. |
| Beginning/finalizing workspace entry | `hooks/workspaces/**` workflow hooks | Coordinates stores, selection, focus, materialization. |
| Dispatch/reconciliation effects | lifecycle hooks | App-mounted effects own waits, streams, dispatch loops, and reconciliation. |

Stores hold facts and local transactions. They do not wait for work, dispatch
network calls, subscribe to streams, or decide UI projection rules.

## 6. End-To-End Timeline

This is the expected new-worktree/new-workspace timeline:

```text
Home submit
  -> resolve deterministic workspace display/request data
  -> create PendingWorkspaceEntry
  -> create projected client session
  -> enter pending shell and write header tab intent
  -> enqueue initial prompt/config/interaction work as session intents
  -> start workspace create/select work
  -> patch pending entry with materialized workspace id
  -> select real workspace while preserving pending shell
  -> remap projected session to real workspace
  -> create real AnyHarness session for the same client session id
  -> dispatch ordered session intents
  -> reconcile from transcript/config/interaction stream state
  -> clear pending workspace state after handoff is complete
```

Only the lower half of this timeline may be slow. Everything through
`enqueue initial prompt/config/interaction work` is synchronous UI projection
and should be visible in the first shell paint.

The same model applies to an existing workspace with a new session:

```text
user opens/sends to a new session
  -> create projected client session
  -> write shell tab intent and active session id
  -> enqueue session intents immediately
  -> create real AnyHarness session in the background
  -> bind materialized session id
  -> dispatch and reconcile
```

The same model also applies when selecting an existing workspace with remembered
tabs:

```text
user selects existing workspace
  -> resolve explicit, last-viewed, or first visible persisted session id
  -> create a lightweight placeholder session record if needed
  -> set active session id and shell tab intent immediately
  -> render header tabs and empty/session skeleton before session-list load
  -> load workspace sessions through the normal bootstrap path
  -> patch the placeholder from the real session summary, or clear it if stale
```

This fast-open placeholder is only shell scaffolding. It must not invent
transcript content, runtime activity, or action capabilities. The real session
summary and stream replace it as soon as AnyHarness session data is available.

## 7. Begin Flow

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
   Session intent enqueue success and projected-session existence are distinct.
   If the projected session exists, the fallback path must not create a second
   session.

7. Start the real workspace creation/select work in the background.

## 8. Finalization Flow

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
   `usePendingWorkspaceSessionMaterialization` owns this. Session intents
   remain the visible owner while the real AnyHarness session is created in the
   background.

5. Set the workspace arrival event.
   Arrival panels use this event to show the final "new worktree/workspace"
   context and setup-script state.

6. Clear pending workspace state after selection finalization.
   Do not clear as soon as the real workspace appears in cache. That creates a
   visible gap between the pending projection and the real row.

## 9. UI Projection Rules

Each surface that normally reads real workspace/session data needs a pending
projection path.

| Surface | First render source | Runtime handoff source |
| --- | --- | --- |
| Header tabs | Projected session record plus shell tab intent | Materialized session directory rows |
| Chat body | Projected session plus session-intent transcript projection | Streamed transcript and reconciled intents |
| Composer model/config controls | Projected session launch/config state plus pending config intents | Live session config |
| Composer footer | Pending workspace footer projection | Mobility/logical workspace state |
| Sidebar | Pending sidebar projection | Logical workspace collections |
| Header actions | Pending/final workspace identity and known git capability shape | Real workspace git/status state |
| Arrival panel | Pending entry stage plus arrival event | Real setup/workspace status |

### Chat Surface

- Pending workspace with active projected session renders `session-empty` or
  `session-transcript`.
- Launch intent may supply launch context only before a projected session
  exists.
- If session-intent or transcript content exists, content wins over launch copy.

### Header Tabs

- Tabs include projected session rows for pending workspace keys.
- The tab key must stay stable through materialization where possible.
- Do not wait for AnyHarness session creation before showing the tab.

### Model And Config Controls

- The model selector reads the projected session selection first.
- Pending config intents project over the current session config until the
  runtime accepts and streams the real value.
- If the projected session has no materialized runtime yet, display labels must
  still use the same label mapping as the final session.
- Do not mix raw ids and presentation labels. For example, a reasoning setting
  should not render as one label pre-materialization and another label after
  session load.
- A normal queued config update must not show a rollback toast. Rollback toasts
  are for real failures, not for "runtime has not caught up yet."

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
- For new worktrees, default to the eventual branch action shape even while git
  status is still loading. Disable unavailable actions rather than swapping the
  button family.

### Composer And Queued Prompt Controls

- A sent prompt should render synchronously from a `send_prompt` intent.
- Prompt placement is derived, not component-local:
  - transcript placement for user messages that should read like sent chat
  - queue placement for messages waiting behind current runtime work
- Queued prompt rows must reserve action slots immediately. Separate
  visibility from executability:
  - `showEditAction` / `showDeleteAction` mean "render the icon slot"
  - `canEdit` / `canDelete` mean "clicking can perform work right now"
- During the pre-runtime-ack gap, show final-shape disabled controls instead of
  hiding them. Once the local cancel path or runtime queue seq exists, enable
  the same controls.
- Local edits/deletes before runtime acceptance mutate the existing
  `send_prompt` intent. Runtime edits/deletes after a queue seq exists are
  ordered `edit_pending_prompt` / `delete_pending_prompt` intents.
- Do not render action controls by inspecting component-local timing. Use the
  queue row derived from `pending-prompt-queue.ts`.

### Workspace Arrival Panel

- The attached panel renders pending/setup status above the composer.
- It should not be the only source of workspace identity. Header, tabs, footer,
  and sidebar each need their own pending projection.

## 10. Session Intents

The current implementation uses one ordered per-session intent system. It
replaces the old prompt-only outbox and the separate pending-config path.

Some prompt-specific names still exist in the code, such as
`PromptOutboxEntry`, `PromptOutboxDeliveryState`, and
`usePromptOutboxActions`. Treat those as prompt-specific compatibility names
inside the broader session intent system. The store of record is
`session-intent-store.ts`.

Use this split for outbound session work:

| Layer | Responsibility |
| --- | --- |
| Intent model | Typed payloads, ids, ordering, delivery state. No React. |
| Store | Ordered client-owned records and local mutations. No dispatch. |
| Projection helpers | How records affect visible UI before acknowledgement. |
| Dispatcher lifecycle | Finds dispatchable records and calls runtime access. |
| Reconciliation | Removes, settles, or retries records when runtime state catches up. |

Session intents are:

- `send_prompt`
- `update_config`
- `resolve_interaction`
- `edit_pending_prompt`
- `delete_pending_prompt`

Intent statuses are:

| Status | Meaning |
| --- | --- |
| `queued` | Client has recorded the user action; dispatch may wait for materialization or earlier intents. |
| `preparing` | Dispatcher is preparing payloads, attachments, or local conversion. |
| `dispatching` | Runtime/API call is in flight. |
| `accepted` | Runtime/API accepted the action; stream or follow-up state still owns final reconciliation. |
| `reconciled` | Runtime state caught up and the intent no longer needs to project UI. |
| `failed` | The action failed and should remain inspectable/retryable where applicable. |
| `cancelled` | The user cancelled before runtime acceptance. |
| `stale` | The target runtime request disappeared before dispatch and no user-visible failure is needed. |

Rules:

- Dispatch in client order. Do not coalesce config changes in v1.
- A session with no materialized AnyHarness id keeps intents queued.
- A config update may unblock later intents after AnyHarness accepts it as
  `applied` or `queued`; runtime config ordering is authoritative after that.
- A prompt intent renders immediately, dispatches after materialization, and
  reconciles when a renderable user-message echo appears in the transcript.
- A config intent projects pending config over live config until the stream or
  API response reconciles it. Normal queued config must not produce rollback
  toasts.
- Interaction response intents are valid only for interactions the UI has
  already seen. If the request is gone by dispatch time, mark the intent stale
  instead of showing a user-visible failure.
- Queued prompt edit/delete intents mutate local not-yet-dispatched prompt
  intents directly; after a runtime queue seq exists, they dispatch through the
  ordered session intent dispatcher.

### Projection By Intent Type

| Intent | Immediate UI projection | Reconciliation signal |
| --- | --- | --- |
| `send_prompt` | Transcript row or queued row, depending on placement. | Renderable user-message echo, runtime queued seq, failure, cancellation, or tombstone pruning. |
| `update_config` | Pending config overlays model/mode/reasoning/speed controls. | API acceptance plus live config stream/state matching the value. |
| `resolve_interaction` | The clicked response should feel accepted locally; stale requests settle without noisy failure. | Resolve API success, missing request, or stream removing the interaction. |
| `edit_pending_prompt` | Local prompt text changes immediately when the prompt has not reached runtime; runtime edits wait for seq. | Runtime edit API success or transcript/queue update. |
| `delete_pending_prompt` | Local queued prompt disappears or is marked removed when not yet dispatched; runtime deletes wait for seq. | Runtime delete API success or queue removal. |

### Dispatch Ordering

`selectNextDispatchableSessionIntent` walks a session's ordered intent list and
returns the first dispatchable record. Non-terminal earlier intents block later
ones. This preserves config-before-prompt and response-before-next-prompt
semantics without special component logic.

The dispatcher should mark API acceptance quickly enough to unblock later
intents when AnyHarness owns subsequent ordering internally. It should not wait
for unrelated UI hydration, history loading, or shell selection completion once
the materialized session id exists.

### Attachment Conversion

Prompt intents snapshot attachments before dispatch. When converting a prompt
intent to runtime prompt blocks:

- inline image/resource payloads must not also send `attachmentId`
- existing runtime attachments may send `attachmentId`
- attachment conversion belongs in the dispatcher/preparation path, not in the
  component that submitted the prompt
- transcript projection should render from the snapshot while dispatch waits

## 11. Action Routing Rules

Use these rules when deciding whether a user action can happen before
materialization:

- If the action affects visible chat history, enqueue a session intent and
  render immediately.
- If the action affects session launch/config and the projected session exists,
  update the projected session state immediately and dispatch when materialized.
- If the action resolves a visible runtime interaction, it may be queued only if
  the interaction is already visible and has a stable interaction id.
- If the action requires real workspace files, git state, or runtime commands,
  keep it disabled until `materializedWorkspaceId` exists.
- If the action would create a second session as a fallback, first check whether
  a projected session already exists. Projected-session existence blocks fresh
  fallback creation.

## 12. Latency And Render Stability

Optimistic UI solves hard latency; it does not excuse render churn.

Known hard latency sources:

- workspace creation or worktree creation
- workspace selection and connection resolution
- session creation/materialization
- launch catalog/default launch resolution
- transcript/history hydration
- prompt/config/interaction API acknowledgement
- stream startup and first flush

Rules:

- The shell may wait for deterministic projection data before entering, but not
  for remote creation work.
- Derived hooks must use stable empty arrays/objects and shallow selectors when
  selecting multiple store fields.
- Do not write stream-derived activity or viewed timestamps on every stream
  flush. Throttle or batch writes that affect sidebar/header/shell state.
- Do not use debug logging state updates in render-heavy hooks. Logging can be
  added temporarily for diagnosis, but remove it before finalizing unless it is
  behind an explicit debug flag and does not change render identity.
- Prefer disabled final-shape controls over conditional mounts when a control
  will become available shortly. Conditional mounting is a visible layout and
  focus shift.
- Components should render projection results; they should not recompute
  pending workspace/session/intents from raw stores in multiple places.

## 13. Failure And Recovery

Pending failures must preserve enough state to retry or exit cleanly:

- the pending workspace entry remains selected
- queued session intents remain visible and owned by the projected session
- setup/create errors render in the workspace status panel
- retry uses the original deterministic request unless the user explicitly
  changes it
- back/abort clears pending state and does not persist the pending workspace key

If materialization fails after a projected session exists, do not create a new
session automatically. The user should see the failed workspace shell and keep
their queued prompt.

## 14. Tests

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
- session intents: prompts/config/interaction responses preserve order, render
  immediately where visible, and dispatch only after materialized session id
- queued prompt controls: icons reserve immediately while disabled, then enable
  without remounting when local cancel or runtime seq is available
- latency stability: no infinite Zustand snapshot loops and no render-heavy
  store writes from stream flush side effects

## 15. Anti-Patterns

Do not:

- use launch intent as shell truth once a pending entry exists
- render a half-shell and fill in path/branch/model data later
- regenerate worktree names after entering the pending shell
- inject fake `LogicalWorkspace` rows for pending entries
- clear pending state when the real workspace merely appears in cache
- create a fresh session after a projected session exists
- hide queued user messages until AnyHarness acknowledges them
- write pending config changes directly into session directory records
- show config rollback toasts for normal queued config
- hide queued prompt controls until runtime acknowledgement
- make control visibility depend on a transient dispatch status when a disabled
  final-shape control would be stable
- put dispatch loops or wait/retry behavior in stores
- add component-local fixes for one shell surface when the same data belongs in
  a pure projection helper
- leave debug logging effects in render-heavy derived hooks after diagnosis

## 16. Debugging Checklist

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
9. Did session intents attach queued work to the projected session id?
10. Did any fallback path create a fresh session despite a projected session
    already existing?
