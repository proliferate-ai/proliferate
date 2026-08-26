# UX Latency + Transitions

This document describes the current perceived-latency behavior and loading/transition treatments across the product client, delivered by the UX Latency + Transitions ADR's delivery ladder and merged to `main`.

Owns the perceived-latency contract from the UX Latency + Transitions ADR: the loading-treatment state machine and its tokens, the chat pane's hero loading mark, the sidebar's held-key workspace traversal, and the sidebar row activation transition. Renderer instrumentation for these flows (`renderer.flow.*`, `renderer.loading.*` marks) is described where it is emitted, not re-derived here.

Fences, one owner per concern:

- **This document owns the interaction/perception contract; [DESIGN_SYSTEM.md](../../DESIGN_SYSTEM.md)
  owns the token values and component tier placement.** Token values and the
  `LoadingBoundary` sanctioned-index entry live in DESIGN_SYSTEM.md's current
  material; this document does not repeat them, except the
  `heroMinDisplayMs` value below, which DESIGN_SYSTEM.md does not yet carry.
- **Session selection** ([workspaces/session-selection.md](session-selection.md))
  owns which session is visible inside an already-open workspace; this
  document owns switching which workspace is open.
- The `mode.kind` union the chat pane dispatches on (`workspace-status`,
  `session-loading`, `session-transcript`) is defined in
  [chat-surface.ts](../../../apps/packages/product-client/src/lib/domain/chat/surface/chat-surface.ts),
  already on `main`; no spec owns that state machine today. This document
  owns only what renders while a `workspace-status`/`session-loading` mode
  is active, not the state machine itself.

## Loading treatments

A `LoadingBoundary` primitive (`apps/packages/product-client/src/primitives/LoadingBoundary.tsx`) is the single owner of the loading-treatment state machine. Callers pass a discriminated `pending | empty | ready` state and a treatment slot; the boundary never hand-rolls a `content-fade-in` + `animation-delay` show-delay per call site. `loading.showDelayMs` and `loading.minDisplayMs` gate that state machine; see [DESIGN_SYSTEM.md's Loading treatments table](../../DESIGN_SYSTEM.md#loading-treatments) for their values and role, and its sanctioned index for `LoadingBoundary`'s component-tier entry.

| Value | ms | Role |
| --- | --- | --- |
| `loading.heroMinDisplayMs` | 420 | The chat loading hero's mark-specific floor (below), longer than the generic floor because the hero is a larger, more prominent mark. |

Doctrine, all load-bearing:

- The state is discriminated, never a boolean. `empty` is a resolved outcome
  and may only render after data lands; while `pending` the boundary shows
  the treatment or nothing, never the empty slot.
- The one sanctioned reveal is `content-fade-in` at `--duration-enter`;
  reduced motion disables the fade so content appears instantly.
- Skeletons are a carve-out, not a default: sanctioned only for the sidebar
  workspace list and the repo picker rows, both routed through
  `LoadingBoundary` as the treatment slot. Every other loading surface is
  Class C (stable shell, no skeleton).

### Chat loading hero (R16)

The chat pane's `workspace-status`/`session-loading` wait state ([ChatLoadingHero.tsx](../../../apps/packages/product-client/src/components/workspace/chat/surface/ChatLoadingHero.tsx)) renders a `DotCellLoader` in its `hero` size tier, mark-only: no caption or workspace-name copy. The surrounding container carries `role="status"` and `aria-label="Loading conversation"`; the mark itself is `aria-hidden`, so assistive tech gets one status announcement instead of narrating a decorative animation. `ThinkingText` (the `awaiting-first-turn` substep) stays outside this treatment, since it is agent-activity feedback inside otherwise-ready content, not a wait state.

`hero` is a new `DotCellLoaderSize` tier ([DotCellLoader.tsx](../../../apps/packages/product-client/src/primitives/DotCellLoader.tsx)), styled via `.dot-cell-loader[data-size="hero"]` in [product.css](../../../apps/packages/design/src/css/product.css) with its own `--dot-cell-size`/`--dot-cell-gap` pair: `0.375rem`/`0.25rem` (6px dots, 4px gap), against the default tier's `0.1875rem`/`0.125rem` (3px dots, 2px gap) and the `compact` tier's `0.15625rem`/`0.09375rem`. The 3x3 grid this produces is 26px square, the largest of the three tiers.

Because `ChatLoadingHero` hardcodes `state="pending"` for its whole life (the parent `ChatView` mounts it only while a wait mode is active and unmounts it synchronously on resolve), `LoadingBoundary`'s own min-display and fade-out machinery never fires from inside it, because that machinery only engages on a local transition away from `pending`, and this component never makes one. Resolution here is `ChatView` switching `mode.kind` and tearing this component down, not a state change this component owns.

`ChatLoadingHero` instead reports the instant its treatment becomes visible through an `onTreatmentShown` callback. `useChatLoadingHeroExit` (`apps/packages/product-client/src/hooks/chat/ui/use-chat-loading-hero-exit.ts`) owns the exit choreography from that instant: it holds a `holding` phase for `loading.heroMinDisplayMs` (420ms) past the shown timestamp even if `mode.kind` flips away sooner, then a `fading` phase for `duration.exitMs` (120ms), then returns to `idle`. `ChatView` keeps a frozen `ChatLoadingHeroExitOverlay` mounted for the `holding`/`fading` phases on top of whatever real content `mode.kind` has already switched to underneath, so a fast resolve never cuts the mark off mid-mount. A wait that never crosses the 200ms show-delay has no shown timestamp, so `phase` stays `idle` and the mode switch takes effect immediately, unchanged from before R16.

A workspace that has already bootstrapped in this browser session never mounts the hero mark at all (`hasWorkspaceBootstrappedInSession`), so revisiting an already-settled workspace does not re-show a loading treatment for it.

## Sidebar row activation transition (R17)

`SidebarRowSurface` ([SidebarRowSurface.tsx](../../../apps/packages/product-client/src/primitives/patterns/sidebar/SidebarRowSurface.tsx)) excludes `background-color` from its transitioned properties while a row is **activating**, and includes it while **deactivating**:

- Activating a row paints its selected background solid on the first
  available frame instead of fading in.
- Deactivating a row keeps the fade, so hover/deselect still reads soft.

This asymmetry exists because a rapid sidebar sweep (holding the next/prev-workspace shortcut) pins the main thread with a long task per switch, so the browser only manages to paint a handful of frames across the whole sweep. At roughly 5fps, every painted frame catches a still-fading-in background at near-zero alpha, and the highlight never reads as visible until the sweep stops. There is no frame budget a settle-by-one-frame trick can buy back here: a settle deferral (delaying which value drives the class by one `requestAnimationFrame`) fixes a *different* bug (a same-row net-zero flip across commits faster than a paint, which otherwise suppresses the transition entirely) but makes the frame-starved sweep worse, since the deferral's own callback can be starved for the same reason. Excluding `background-color` from the activating transition sidesteps the starvation instead of racing it: activation has nothing left to finish painting, so it is correct even at 5fps.

## Sidebar workspace switching (R19)

Held-key workspace traversal (`Cmd+Opt+Left/Right`, `workspace.previous-workspace` / `workspace.next-workspace`) is a two-phase switch: a cheap preview cursor during traversal, one expensive selection commit after it settles.

Numbered workspace shortcuts use pinned workspaces first in persisted pin order, followed by visible unpinned repository rows. A pinned workspace remains a numbered shortcut target when its repository group is collapsed. Held-key traversal retains repository row order independently of pin order.

```text
useAppShortcuts (React glue: refs to current target ids / commit action)
  └── createWorkspaceSwitchCursorController   pure state machine, no React/DOM
        step(direction)                        throttled cursor advance
        onCommittedChange(committedId)          reconciles/cancels vs. an external commit
        cancel()                                Escape / abandon
  └── useSidebarSwitchCursorStore (zustand)    { cursorId }
        └── WorkspaceItem                       displayedActive selector
```

- `workspace-switch-cursor-controller.ts` (`apps/packages/product-client/src/lib/domain/workspaces/sidebar/workspace-switch-cursor-controller.ts`)
  is free of React, DOM, and any concrete timer or store; `useAppShortcuts`
  injects `now`/`setTimer`/`clearTimer` and store accessors so the throttle,
  settle, and commit-reflection edges are unit-testable with fake timers.
- **Throttle.** A step is accepted only after `WORKSPACE_CURSOR_STEP_MIN_MS`
  (60ms) since the last accepted step; a repeat inside that window is
  dropped, never queued, so releasing a held key never replays a backlog.
- **Settle.** Every accepted step (including a dropped repeat) re-arms a
  `WORKSPACE_CURSOR_SETTLE_MS` (180ms) quiet timer; only when that timer
  fires uninterrupted does the controller commit the previewed workspace as
  the real selection.
- **Commit reflection / fallback.** After calling `commitSelection`, the
  controller tracks the id it expects the committed-selection store to
  reflect. `WORKSPACE_CURSOR_COMMIT_FALLBACK_MS` (2000ms) bounds how long it
  waits before clearing the cursor unconditionally, covering a commit that
  fails (error toast path) or is superseded.
- **Click-beats-pending-commit.** If the committed-selection store changes
  to something other than the controller's own pending commit while a
  commit is in flight, or changes at all while only a preview (no commit) is
  in flight, the controller treats it as an external actor (a mouse click on
  another row) winning and abandons its own preview.
- **Escape cancels.** A capture-phase, non-`preventDefault` listener cancels
  an in-progress preview on `Escape`, without interfering with any other
  `Escape` handling.
- **Vanished-id guard.** If the previewed row's id is no longer in the
  current sidebar traversal order when the settle timer fires (the target
  list changed mid-traversal), the controller drops the preview instead of
  committing a stale id.

`WorkspaceItem` ([WorkspaceItem.tsx](../../../apps/packages/product-client/src/components/workspace/shell/sidebar/WorkspaceItem.tsx)) reads a per-row selector that folds its own id and the committed `active` prop into one `displayedActive` boolean: while a cursor is set, the cursor position drives the highlight and the committed selection's highlight is suppressed, so exactly one row reads active during traversal and a cursor step re-renders only the two rows whose displayed state flips.

Test-only: `vitest.config.ts` maps the public `@proliferate/product-client/internal/*` subpath to source, alongside the existing `@proliferate/product-client/host/*` mapping, so a test whose graph reaches product-client's diagnostics port through that subpath runs against source instead of requiring a package build first. It carries no runtime behavior; it exists only so the test lane keeps the same "tests run against source, never dist" rule the file already states for the `host/*` subpath.

The ADR's two-phase switch originally scoped a third leg: deferring the expensive pane mount itself during a rapid sweep, on top of the preview-cursor leg documented above. It was left out by design: leg 1 (the preview cursor) already makes every intermediate workspace during a sweep vanish before its pane would ever mount, so a separate deferred-pane mechanism would be unmeasured machinery protecting against a case leg 1 already eliminates.

### React-query stabilization (R19 companion)

Two shell-wide query-hook fixes reduce the switch-triggered wide re-render this two-phase switch exists to keep off the traversal path:

- `getProliferateApiOrigin`
  ([proliferate-api.ts](../../../apps/packages/product-client/src/lib/infra/proliferate-api.ts))
  memoizes the last resolved origin instead of constructing a fresh `new
  URL(...)` on every render across the many query hooks that call it.
- `useRepoPrStatuses`
  ([use-repo-pr-statuses.ts](../../../apps/packages/product-client/src/hooks/workspaces/cache/use-repo-pr-statuses.ts))
  memoizes its per-repo query descriptors and its `combine` callback, so a
  shell re-render no longer rebuilds every query option object and forces
  react-query observer churn when the inputs are unchanged.

## Open debt

- **R8 (Q18 lint record, #1914)** rides the docs-v1/d6-lints train and merges
      separately from the rest of this ladder.
- **T4 booted-app latency measurement.** #1970 delivers the
      `composer_submit`/`mode_switch` instrumentation marks; the booted-app
      measurement run validating the ADR's latency budgets against real
      traces has not happened (no-app-boot constraint during the ladder's
      build). Tracked as R12 in the ADR, not by this document.
