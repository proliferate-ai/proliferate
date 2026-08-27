# Chat Composer Standards

Scope:

- `apps/packages/product-client/src/components/workspace/chat/input/**`
- `apps/packages/product-client/src/components/workspace/chat/composer/**` — the shared composer surface
  pieces live here: `ChatComposerSurface`,
  `ChatComposerControlRowFrame`, `ComposerPopoverSurface`.
- `apps/packages/product-client/src/components/workspace/chat/transcript/ProposedPlanCard.tsx`
  — the single shared implementation.
- `apps/packages/product-client/src/components/workspace/chat/content/PlanReferenceAttachmentCard.tsx`
- `apps/packages/product-client/src/components/workspace/chat/plans/**`
- `apps/packages/product-client/src/components/workspace/chat/input/delegated-work/**`
- `apps/packages/product-client/src/hooks/chat/ui/use-composer-dock-slots.tsx`
- `apps/packages/product-client/src/domain/chats/composer/resolve-dock-slots.ts`
- `apps/packages/product-client/src/hooks/chat/derived/use-active-todo-tracker.ts`
- `apps/packages/product-client/src/domain/chats/tools/active-todo-tracker.ts`
- `apps/packages/product-client/src/domain/chats/composer/todo-progress-summary.ts`
- `apps/packages/product-client/src/domain/chats/composer/todo-progress-pill-state.ts`
- `apps/packages/product-client/src/components/workspace/chat/input/TodoProgressPill.tsx`
- `apps/packages/product-client/src/domain/chats/tools/claude-plan-tool-call.ts`
- `apps/packages/product-client/src/lib/access/anyharness/reviews.ts`
- `apps/packages/product-client/src/lib/domain/reviews/**`
- `apps/packages/product-client/src/lib/workflows/reviews/**`

Read this doc before changing the composer, the panels that sit above it (todo tracker, approval card, workspace status, cloud runtime), or where the Claude plan body renders. The structure below is load-bearing for several visual decisions that are not obvious from the code alone.

For delegated work semantics across subagents, cowork sessions, plan review agents, code review agents, tab indicators, and delegated-work delete behavior, also read [delegated-work.md](../subagents/delegated-work.md).

## 1. Layout

Three layers, top to bottom:

```text
ChatView
└── ChatComposerDock                        (backdrop + scrim + padded max-width column + inset dock regions)
    ├── outboundSlot
    │     └── PendingPromptList             (queued outbound prompts)
    ├── activeSlot: at most one of
    │     ├── ConnectedApprovalCard         (pending tool approval)
    │     ├── ConnectedUserInputCard        (agent question/form)
    │     └── ConnectedMcpElicitationCard   (MCP form)
    ├── attachedSlot
    │     ├── DelegatedWorkComposerControl  (one Agents trigger + popover for reviews and subagents)
    │     └── WorkspaceActivityComposerCard (Git/PR summary and source-control actions)
    ├── floatingSlot                        (absolutely positioned, reserves no layout space)
    │     └── TodoProgressPill              (transient centered pill above ChatInput — plan/todo progress, any agent)
    ├── ChatInput
    │   └── ChatComposerSurface
    │       └── form: ComposerCommandEditor + ChatInputControlRow (ComposerLeadingControls + ComposerTrailingControls + ChatComposerActions)
    │           (or the blocked-status takeover: ComposerBlockedStatusLine +
    │            ComposerBlockedControlRow while a persistent condition blocks chat)
    └── footerSlot
        └── reserved for product-specific footer context when present
```

The home screen reuses the same composer: `HomeComposerForm` (`apps/packages/product-client/src/components/home/screen/HomeComposerForm.tsx`) renders the same `ChatComposerSurface` + `ChatComposerControlRowFrame` from ProductClient's direct component owners, with slot-based render isolation (controls, trailing controls, and actions are passed in as stable slot elements so keystrokes only re-render the composer subtree).

Non-negotiable:

- **`ChatComposerDock` owns the dock shell.** Background, scrim, padding, max-width column, slot ordering, and the inset region wrappers all live in `ChatComposerDock.tsx`. The production app (`ChatView`) and the dev playground (`ChatPlaygroundPage`) both render `ChatComposerDock` directly. Do not reconstruct this backdrop in a third place — if you need it somewhere new, reuse the dock.
- **No `backdrop-blur` on the dock's transcript-covering layer.** That layer sits over the scrolling transcript, and backdrop blur forces WKWebView to re-blur everything behind it on every frame. The implementation is a gradient fade into an opaque-ish `bg-background/95` sheet (`ChatComposerDock.tsx`), not a blur.
- **`ChatInput` is the composer surface only.** It does not own any of the outer wrapping. It takes no `topSlot` prop. Everything above and below the composer surface is the dock's responsibility; product-specific footer context must render through the dock rather than ad hoc workspace logic in `ChatInput.tsx`.
- **Do not add in-composer read-only status badges.** MCP/plugin state belongs in settings, session details, or explicit action surfaces, not as a persistent strip inside `ChatInput`.
- **The composer surface paints the seam.** There is no `flatTop` prop or alternate composer mode. Ordinary light composers own one complete depth recipe: a full border-heavy perimeter plus controlled ink-tinted lift; dark composers remain fill-only. Ordinary dock-region panels remain narrower attached trays above the composer. When the full-width workspace-activity cap is present, `ChatComposerDock` squares the composer's top corners with a local `:has()` selector so the cap and input read as one card; removing the cap restores the normal composer radius. The composer still paints after the dock regions so its own top edge remains visible at the seam.
- **Composer command overlays are composer-local, not dock-region inhabitants.** The slash-command tray renders from `ChatInput` in a small host directly above `ChatComposerSurface` while a prompt-leading `/` trigger is active. It is transient editor UI and does not participate in `useComposerDockSlots` precedence.

### Editor behavior

The workspace, Home, and queued-prompt editors use the same product-client-owned Lexical adapter. Workspace drafts keep the existing `ChatComposerDraft`; Home and queued edits keep their existing Markdown string state. Every submitted prompt boundary remains Markdown, and Lexical state is an editing detail that must not cross the runtime or server boundary.

While a workspace draft is live, `ChatComposerDraft` may carry a versioned, opaque editor snapshot beside its Markdown nodes. The product client uses that snapshot only to restore editor-only identity such as whether Markdown link syntax came from an HTTPS paste; submission still serializes only Markdown. Home and queued-edit state retain the same opaque snapshot locally while their Markdown draft is live. Empty drafts, plain-text compatibility writes, and external draft replacements discard the snapshot.

Assistant-response excerpts added from the transcript are workspace-scoped composer context, stored separately from `ChatComposerDraft`. Each excerpt is shown above the editor as a removable quoted preview; preview truncation is visual only, and submission includes the full selected text exactly once in the serialized prompt. An excerpt makes an otherwise empty composer submittable. After a successful direct submit, `ChatInput` clears only the excerpt ids captured by that submission so context attached during the in-flight send is retained. Immediate transcript follow-ups do not clear or replace the current composer draft.

The live editor recognizes `*`/`_` emphasis, `**`/`__` strong emphasis, line-leading unordered and ordered list shortcuts, and triple-backtick fenced code blocks. A typed fence becomes a code block only after a matching closing fence exists on its own line; an incomplete fence remains literal text. A complete pasted fence is imported as the same editable code block. The editor serializes that block back to fenced Markdown, so draft and submission boundaries remain unchanged. Cmd/Ctrl-B and Cmd/Ctrl-I toggle marks through the rich-text command layer; the global left-sidebar toggle yields the B chord to the editor only while composer text is highlighted (PRO-265) — with a collapsed caret, or focus anywhere else including the terminal, it keeps toggling the sidebar. Tab/Shift-Tab indent or outdent only when the selection is inside a list item. Every composer surface — workspace, Home, and queued edits — submits on plain Enter or Cmd/Ctrl-Enter, including from a list item or code block, and Shift-Enter inserts a newline without submitting. Queued edits use the workspace editor's minimum height, row cap, and overflow scrolling.

Rich clipboard code is normalized on entry. A pasted rendered code block (`text/html` `<pre><code>`) imports as one editable code block — Lexical's double `<pre>`/`<code>` conversion is dissolved — and a code block that ends the draft always keeps a continuation paragraph after it, so the caret can always leave the block (the same continuation the typed-fence path creates). Bold and italic are the only authorable text formats, and no block-level alignment or indent is authorable outside list nesting. Everything beyond that in a rich paste — the inline-code text format (typed backticks stay literal), underline, strikethrough, centered or indented blocks — keeps its characters and structure and drops the formatting on entry (`ComposerFormatGuardPlugin`, PRO-159/PRO-265). An external draft replacement resets inherited selection formats along with the content; without that reset the format bits survive the clear and re-apply to everything typed after a send (PRO-159).

Lexical's high-priority Enter and Tab commands own this decision before native editor mutation. The surface applies the shared submit contract exactly once; Shift-Enter and list indentation stay Lexical-owned. The same native `beforeinput`, `keydown`, or `paste` event timestamp is forwarded to typing measurement when that event changes the document.

The editable surface keeps WebKit's native selection and browser-owned editing semantics. On macOS, where current WebKit paints its redesigned insertion caret at two CSS pixels, the product client paints a one-pixel visual caret at the collapsed Lexical selection. The visual caret uses Lexical's DOM-range mapping, does not mutate editor content, and hides the native caret only after it has a valid attached rectangle. Failed measurement, blur, a non-collapsed selection, IME composition, and unmount restore the native caret immediately. Its height scales from the independent composer appearance tokens; composer font size and line height remain unchanged, including user-selected scale changes.

Link creation is deliberately paste-only. An exact `https://` clipboard value becomes a link, wrapping a non-collapsed selection or inserting the URL when the selection is collapsed. Complete Markdown HTTPS links in pasted text also become links while preserving all surrounding clipboard text, and a single paste may contain multiple links. Typed URLs, typed Markdown link syntax, `http://` destinations, and incomplete pasted Markdown link syntax remain literal editor text. The Markdown exporter still serializes an actual pasted link, so the existing prompt submission and sent-message Markdown renderer need no special link transport.

Pasted complete Markdown lists are also imported as editable list blocks, including inline emphasis and links within their items. This path is paste-only: typing list-shaped Markdown remains governed by the normal live shortcut contract, and an incomplete or bare list marker remains literal text.

Slash-command discovery remains prompt-leading and composer-local. IME composition bypasses submission and command keyboard handling. The editor root retains `data-chat-composer-editor` and `data-telemetry-mask` so focus routing, privacy masking, and surface behavior remain shared with the prior input. Discovery follows the current caret rather than the end of the document, and a selection replaces only the active slash-token range while preserving text and formatting around it.

The Home composer offers the same slash menu before any session exists (`HomeComposerCommandEditor.tsx`). Its source is not a live transcript: each session's `available_commands_update` also records that harness's catalog into a persisted per-agent-kind store (`slash-command-catalog-store.ts`), and Home reads the catalog for the harness the composer is about to launch. The same desktop runnable-command policy applies, the tray anchors absolutely above the surface (the mid-screen composer must not shift as the menu opens), and file mentions are deliberately absent — there is no workspace to search before launch. Until a harness has streamed one session, its Home menu is empty.

File-mention discovery keeps the runtime's full supported result page instead of applying a smaller presentation limit or discarding fuzzy matches with a stricter client-side filter. The shared inline-menu viewport stays visually capped at about ten rows and scrolls the remaining matches; Arrow-key navigation keeps the highlighted row in view while focus remains in the composer editor.

Composer focus follows the app lifecycle. The workspace composer takes focus after mount and workspace switches (`ChatInput.tsx`), and the Home composer takes focus after mount (`HomeComposerForm.tsx`); both surfaces mark their region with `data-focus-zone="chat"` so `focusChatInput` can route focus. On Desktop, the visible composer also regains focus when the app window becomes active again, via `focusChatInputOnActivation` (`apps/packages/product-client/src/lib/domain/focus-zone.ts`, mounted through `DesktopProductLifecycleRoot`). Activation restore never steals focus: it moves focus only when focus is unowned (the document body) or resting on a non-interactive chat-zone surface — any other zone, dialog, menu, portaled overlay, control, or editor keeps ownership, and a live text selection is never collapsed. A composer kept mounted behind an `aria-hidden` route host (the settings overlay) is never focused. Hosted Web applies no activation restore.

## 1.1 Model Selector Semantics

Before launch, the composer model selector presents the selected target's exact `HarnessLaunchOptions` contract from `specs/systems/harnesses/launch-options.md`. After launch, it presents the active session's `SessionLiveConfigSnapshot`. Identity is the raw observed ID, never a display label or inferred provider shape.

Rules:

- The model pill opens the searchable grouped observed-model popover
  (`ComposerModelPickerPopover`) and owns model/harness selection only. Under
  the ruled composer input grammar (owner rev #1851, superseding the earlier
  combined `Model · Effort` pill), reasoning effort, `fast_mode`, and the
  working mode are separate composer chips — see §1.2 for their placement and
  interaction contracts. Model-only contexts such as plan handoff render just
  the model selection.
- `Ctrl+Shift+M` toggles the model picker popover open and closed, including
  while the composer editor is focused. It does nothing while that selector is
  unavailable.
- Closing the picker with `Ctrl+Shift+M`, Escape, or a keyboard model
  selection returns focus to the active composer editor without changing its
  draft or caret. Pointer dismissal and model selectors outside an active
  composer keep their own focus behavior.
- Preserve observed effort labels (`Extra High`, `Max`, `Ultra`, and
  so on) wherever effort values render, including the effort stepper chip; do
  not rewrite distinct values to internal spellings such as `Xhigh`.
- The current composer chip uses the active session's effective runtime model
  once AnyHarness reports one. Pending launches may show requested model intent.
- Picker selected state uses exact observed identity. Presentation may label,
  order, group, or search rows, but it may not alias, deduplicate, hide, add, or
  remove executable membership. An unknown ID renders with its observed label
  or raw ID.
- Runtime live config values are preserved exactly for update calls. A
  presentation label may decorate the row without changing the submitted ID.
- After AnyHarness confirms a user-selected model, working mode, reasoning,
  effort, or speed value in a standard workspace, ProductClient persists that
  value as the per-agent launch default. New chats in the current workspace and
  newly created workspaces may reuse those exact IDs as saved intent. Every
  execution revalidates them against the selected target; invalid saved intent
  is shown for repair and is never aliased or replaced. With no saved intent,
  only defaults reported by `HarnessLaunchOptions` apply. Cowork working-mode
  and tuning changes do not update standard-workspace saved intent.
- [Models and harness launch options](../harnesses/launch-options.md) owns whether a
  selection is current, `update_current_chat`, or `open_new_chat`; Composer
  presents that action and does not derive it from live setter availability.
- [Chat Lifecycle](lifecycle.md) owns the visible create, preserve, and replace
  transition after the classified action is selected.

Any provider-specific compatibility mapping in Desktop must be backed by a domain-level selector test and, when possible, a recorded AnyHarness fixture showing the raw session values that required the mapping.

## 1.2 Session control placement

The chat and Home composers use the same control partition and visible order (`ComposerLeadingControls` in `ChatInputControlRow.tsx`, shared verbatim; home feeds it launch-time descriptors instead of live-session ones):

1. the model/harness selector (§1.1)
2. the Fast toggle, when the harness exposes `fast_mode`
3. the reasoning-effort stepper, when the harness exposes an effort ladder
4. the primary working mode badge
5. independent execution access, when present
6. every other observed control through the standard generic control renderer
7. the goal button (live sessions only) and urgent-only integrations

`buildComposerSessionControlGroups` owns presentation partitioning only. It promotes working mode, independent access, effort, and `fast_mode` descriptors to dedicated chips. `SessionConfigControls` renders every remaining observed axis in the same standard row. Promotion never removes an executable control.

The two cycling chips share one interaction contract:

- The reasoning-effort stepper (`ComposerEffortStepper`) is a six-bar ladder
  chip. Click steps to the next level and wraps at the top; `⌘ click`
  (`Ctrl click` on non-Apple platforms) steps back and wraps at the bottom.
  `⌃⇧E` steps forward and `⌃⌥⇧E` steps back from anywhere on the main screen.
- The working mode badge (`ComposerModeBadge`) is icon-only at every width —
  the mode's configured glyph and nothing else, remounted per value so the
  step is legible from the glyph swap. Click steps to the next mode;
  `⌘ click`/`Ctrl click` steps back. `Shift+Tab` from the composer editor also
  steps back.
- Both chips' tooltips use `keepOpenOnPress`, report the value just landed on,
  and carry the click-to-step and `⌘ click`-to-step-back hints
  (`appendSessionControlStepHint`); the modifier word is platform-resolved,
  never hardcoded.

Visible controls use one consistent inter-item rhythm. Compact controls must not reserve a trailing pending-state slot when no pending state exists; that empty flex child shifts icon-only controls and creates uneven visual gaps.

`collaboration_mode` is the primary working mode whenever it is observed. Otherwise a legacy fused `mode` control is presented as working mode only when its observed choices carry working-mode semantics such as plan, agent, ask, build, bypass, or chat. This is presentation classification, not value mapping. Codex's `collaboration_mode` (**Mode**) and `mode` (**Access**) render simultaneously; observed access values include `read-only`, `agent`, and `agent-full-access`. First-party code never emits obsolete `full-access`.

A reasoning-effort ladder with two or more ordered values keeps its chip visible when the runtime reports it as non-settable, but the chip is disabled — it still reads the level. Cowork, plan handoff, Home, and standard chat retain the same exact observed axes; a surface may change layout but cannot filter an executable control.

### Compact control tier (narrow composers)

Below a 32rem composer-container width (`chat-layout.ts` owns the class-string constants; the dock column's `@container` anchors the query in chat, and the Home composer wrapper anchors its own), labeled control pills shed their words so the row degrades to icons instead of truncating mid-word or painting over neighboring controls:

- The working-mode badge is already icon-only at every width (§1.2), so the
  compact tier changes nothing about it.
- The reasoning pill hides the level word; the lit level bars keep reading
  the level.
- The integrations pill hides the connected count and keeps the glyph. The
  urgent re-auth label stays visible (and shrinkable) at every width.
- The model pill keeps its provider icon and name and remains the flexible
  item — it truncates with an ellipsis before any icon pill compresses. Its
  max-width is `min(15rem, 100%)`: the wrapper bound is load-bearing, because
  a bare rem cap replaces the primitive's `max-w-full` in tailwind-merge and
  the pill's column-flex wrapper (`items-start`, for the inline error) does
  not otherwise constrain the button — an uncapped button paints over the
  mode pill instead of truncating.
- Each swap is CSS visibility on one button (wrapper-span classes via
  `ComposerControlButton`), so `data-*` driver attributes, handlers, and
  `aria-label`s are width-independent. Pending-state indicators stay visible
  at every width.

The main pane's floor is sized so the compact row sits at its natural width: `MAIN_PANE_MIN_WIDTH` (`right-panel-model.ts`) clamps the right rail's rendered width so the chat pane never drops below 440px, whatever the persisted panel width, sidebar width, and window size add up to. At the floor, every pill renders at content size with the shared 8px rhythm intact — minimizing the pane must not compress the spacing between pills or truncate the model name for the canonical control row. The persisted panel width is not clamped — the user's chosen width returns when the window affords it.

## 2. Dock Regions

`resolveComposerDockSlots` (`apps/packages/product-client/src/domain/chats/composer/resolve-dock-slots.ts`) owns the pure precedence rules for the named regions above the composer. `useComposerDockSlots` (`apps/packages/product-client/src/hooks/chat/ui/use-composer-dock-slots.tsx`) adapts that data resolution to the shared Desktop/Web React nodes. Classify each inhabitant by state role first, not by component family. They always render in this order:

1. **`outboundSlot`** — queued outbound work: user prompts, queued wake prompts,
   review feedback prompts, and review-complete prompts.
2. **`activeSlot`** — the active agent state. Permission approvals, user-input
   questions, and MCP elicitation forms are its only inhabitants; it is empty
   when none of those is pending.
3. **`attachedSlot`** — parallel delegated work: review agents and linked
   same-workspace subagents. Persistent workspace/runtime blocking state is
   not an attached panel; it takes over the composer itself (below).

Plan/todo progress is **not** a dock-region inhabitant. It renders through the separate `floatingSlot` described in §2.2 — a transient overlay that never occupies or displaces `activeSlot`, so a permission/question/MCP form is never competing with plan state for the slot.

Review status lives in `attachedSlot`, not in active state. The shared `DelegatedWorkComposerControl` owns the compact `Agents` summary-control + popover pattern for reviews and subagents. The review section owns reviewer rows, critique links, stop, send-feedback, and review-revision actions. Review automation and linked subagents are parallel delegated work and must not make normal parent chat input unavailable by themselves. They should not displace blocking requests or todo state with a full card. Cowork managed workspaces are surfaced exclusively in the cowork sidebar — they are not duplicated in the composer Agents popover.

Review runs have two composer-facing classes: blocking workflow runs (`reviewing`, `feedback_ready`, `parent_revising`, `waiting_for_revision`) and terminal result notices (`passed`, `stopped`, `system_failed`). The composer may show one blocking workflow or the latest terminal notice, but dismissing a terminal notice must not reveal older terminal runs underneath it. Starting a new review is blocked by workflow runs and optimistic starting state, not by a finished result notice. This review-start gate is separate from chat input availability; `parent_revising` keeps review controls visible but leaves parent chat input enabled.

**Blocked-status composer takeover** (`useComposerBlockedState` + `lib/domain/chat/composer/composer-blocked-state.ts`): when a persistent condition blocks chat — worktree/local checkout missing, a FAILED cloud/cowork provisioning attempt, the cloud workspace-status screen demanding attention, or a live cloud runtime out of `ready` — `ChatInput` replaces the draft textarea with a one-line status (`ComposerBlockedStatusLine`) and swaps the control row for the state's recovery actions (`ComposerBlockedControlRow`); send stays disabled with the blocked message as its reason, and irreversible actions (lost-workspace delete) confirm first. In-flight (non-failed) provisioning is deliberately NOT a takeover: availability keeps the composer enabled so the first prompt can be typed and queued against the pending workspace. The panel-derived buckets are mutually exclusive upstream (`use-workspace-status-panel-state` yields one kind, resolving a pending entry before a missing directory); the resolver then prefers any panel bucket over the runtime bucket. Cowork threads suppress the takeover via `suppressWorkspaceTakeover` exactly as they used to suppress the ambient workspace-status panel.

If you need to introduce another dock-region inhabitant, classify it by state role first: outbound work, active agent state, or attached context/parallel work. Add the precedence decision to `resolve-dock-slots.ts` and the shared DOM adapter to `use-composer-dock-slots.tsx` — do not compute it inline in `ChatView` and do not introduce a parallel arbiter elsewhere.

`attachedSlot` preserves the shared `DelegatedWorkComposerPanel` containing one compact `Agents` control for review agents and linked same-workspace child sessions. The control opens a popover with sections in review, subagent order. Individual child chips should not be rendered directly above the composer. Attached delegated work is an indicator layer for adjacent work, not a blocking prompt panel. `outboundSlot` must render before `activeSlot`; both stack above attached context/parallel work when present.

The workspace-activity cap is a separate Git/PR surface. It renders last in the attached stack, after delegated work and session goal/activity, so it joins directly to the composer. Its collapsed trigger is text-only, has no disclosure arrow, and shows at most three ordered Git/PR facts: conflicts or failing checks first, then sync and changed-file state, then a healthy branch/clean fallback. It never shows filenames, diff stats, or PR titles.

*The cap is scheduled for replacement.* The ruled end-state (locked 2026-07-14, mock accepted in the playground `workspace-status-card` scenario) is the **workspace status card**: the composer carries no ambient-state bar at all. A single icon-only bulleted-list trigger sits in the trailing control cluster (right of the runtime-pressure ring — never a count, never a warning tint) and opens a structured popover card (`workspace-status/WorkspaceStatusComposerControl.tsx`):

- Surface: 300px, 1.25rem radius, solid popover background, `overflow-hidden`,
  border painted as a 0.5px stroke in the shadow stack plus two soft shadows —
  no ring, no translucency on the card itself.
- Sections in order: **Source control** (Review N changes via the
  `AppShellReviewIcon` ± glyph → review panel; Commit or push with
  ahead/behind meta; Compare branch with PR number meta → PR view; a distinct
  checks row with inline Fix), then **Subagents** (ours) as grouped rows —
  pixel-sprite cluster (`PixelAgentSprite`, ≤4) + "N working" /
  "N done", click opens the subagents surface — then **Native agents &
  terminals** as count rows (single basic agent icon / terminal / loop icons).
- Leaf detail is hover-only: checks, native counts, and subagent group rows
  open a radix-portaled tooltip card (rounded-xl, popover/90, 0.5px ring,
  backdrop blur) listing the individual items.
- Diff stats (`+N −N`) never appear anywhere on this surface.
- Queued prompts, goal, and blocking approvals stay in the composer dock —
  they are conversation-flow state, not ambient state, and do not move into
  the card. The activity-chips row and the composer `Agents` chip retire into
  the card when it ships connected.

`DelegatedWorkComposerControl` uses delegated-work identity from the shared domain view model. The trigger stays the generic `Agents` control when there are zero or multiple visible delegated items. When exactly one visible item needs attention or is active, the trigger may use that item's colored robot and canonical generated display identity.

The delegated-work popover hides completed-success/no-action items by default. Failed, needs-attention, feedback-ready, and waiting-for-revision items remain visible until the user acts or dismisses them.

Dock panes share one width and one neutral tray treatment. Hierarchy comes from state order, copy, and control weight, not from different colors or a width staircase.

### Goal lifecycle safety

Fresh goals created from the Desktop/Web product surface request a finite 50,000-token budget. Engines that implement GoalPort token budgets enforce that default; a harness that reports no native token budget remains governed by its own native stopping semantics. The product does not fabricate budget accounting in the strict goal mirror. Editing an active or paused goal preserves the native engine's existing accounting instead of silently replacing its budget.

Product goal writes and cancellation share a per-client-session lifecycle queue, so a later cancel cannot overtake an earlier goal create or edit. When cancel reaches the head of that queue, it re-reads the strict goal mirror and also considers the latest confirmed product-side intent while the stream catches up. It confirms native pause first when the goal supports pause; otherwise it confirms native clear or authoritative absence. Only then does it interrupt the current turn. The goal bar's Pause and Clear controls follow the same stop-before-cancel order.

A stop failure leaves the turn running and cancellation unrequested, so the full safe sequence can be retried. If stopping succeeds but cancellation fails, the confirmed stopped intent survives long enough for retry to cancel directly without re-running or reversing the stop. A harness that cannot confirm a clear for a deferred goal fails closed instead of interrupting and risking re-arm. Deliberate Resume remains the only product transition from paused back to active, and an active goal does not prevent an idle session from accepting an intentional prompt.

Queued user prompts render only in `outboundSlot`; they are not transcript rows while they remain pending. The queue supports drag or keyboard reorder, steer-next, edit, and delete. A queue entry's `seq` is its immutable runtime identity; array order is authoritative. Reorder mutations use compare-and-swap semantics by sending both the expected sequence order and desired sequence order. UI edit and steer state retain `seq`. `promptId` is reserved for local outbox reconciliation and is not required or assumed unique on runtime queue rows. With an empty composer at the start of the input, `ArrowUp` begins editing the newest editable queued prompt. Steering promotes the selected prompt to the head and interrupts the active turn so normal durable queue drain executes it next.

Plain queued-message rows keep Steer and Delete as direct actions. The former Edit slot is a keyboard-native action menu, ordered Edit message, Move up, then Move down. The menu renders when the row's Edit slot is visible or the plain runtime row is reorder-eligible. A pre-ack Edit item remains visible with its current disabled reason; boundary Move items also remain visible and disabled. Move commands target the nearest eligible plain runtime row and disable while a queue mutation is in flight, so local optimistic, agent-update, and review rows never acquire no-op reorder actions. Menu dismissal returns focus to its trigger. Selecting Edit enters the existing queued-edit workflow, and the explicit composer edit banner remains the pointer/touch Cancel path.

### The todo progress pill (`floatingSlot`)

`TodoProgressPill.tsx` replaced the persistent `TodoTrackerPanel`/`TodoTrackerStrip` dock inhabitants with a transient floating pill. It is mounted through `ChatComposerDock`'s `floatingSlot` prop — an absolutely positioned overlay, centered directly above `ChatInput`, that reserves no layout space of its own and therefore never shifts the dock when it shows or hides.

- **Data source.** Driven by `useActiveTodoTracker()`
  (any agent's live plan, including Claude's TodoWrite — see §3.4). `todo-progress-summary.ts`
  reduces `PlanEntry[]` to a `{ completedCount, total, currentStepNumber, label }`
  summary (`"Step N/Total"`); `hasTodoStepAdvanced` compares two summaries to
  detect a step completing.
- **Nothing renders by default.** The pill appears only when the current step
  number advances — never on a tracker's first appearance — lingers ~4s
  (fade starts at 3.4s, 600ms opacity ease), then unmounts. Hovering pins it
  (cancels the fade, reveals a checklist card above it with one row per
  entry); mouse-leave unpins and restarts a short fade (starts at 1.2s, gone
  by 1.8s). A step advance while the pointer is on the pill/checklist does
  not restart that cycle: the pinned checklist stays mounted and its rows
  update in place, so the in-progress spinner never remounts mid-hover.
  `todo-progress-pill-state.ts` owns this show → linger → fade →
  hide state machine as a pure reducer (`todoPillReducer`); the connected
  component only owns the timers and the hovered guard.
- **No dock-slot precedence.** Because it floats independently of
  `activeSlot`/`attachedSlot`, it never competes with `ConnectedApprovalCard`,
  `ConnectedUserInputCard`, or `ConnectedMcpElicitationCard` for the slot —
  there is no more "todo strip" companion under an interaction card.
- **Reduced motion:** shows/hides directly instead of animating the opacity
  fade (`usePrefersReducedMotion`).
- Pure pieces (`TodoProgressPillView`, `TodoProgressChecklistCard`) are
  exported for fixtures; the playground's `todos-short`/`todos-mid`/`todos-long`
  scenarios render them pinned open via `PlaygroundFloatingSlotFixtures.tsx`
  since the connected pill only appears on a live step advance.

## 2.1 Composer footer semantics

The dock owns footer placement when a product-specific footer exists. This document does not define a shipped workspace migration footer or move flow; current workspace migration product behavior is absent and owned by [Workspace migration](../workspace-surface/migration.md).

## 3. The three composer-area components

All three sit inside the composer area. They differ by lifecycle and role, and their visual language is deliberately unified.

| Component | Lifecycle | Renders | Header shape |
|---|---|---|---|
| `TodoProgressPill` | Transient, non-gating — floats above the dock, not in it (§2.2) | `PlanEntry[]` reduced to a `Step N/Total` pill + hover checklist | `DotCellLoader` + tabular-nums step label |
| `ApprovalCard` | Short-lived, gating (demands a decision) | options from `pendingApproval`, one variant for all three `toolKind`s | plain title only — NO icon, NO label chip, NO separator |
| `ProposedPlanCard` | Lives in the **transcript**, not above composer | immutable markdown plan snapshot, decision state, and plan actions | bold plan title + icon-only Copy/Collapse buttons |
| `PlanReferenceAttachmentCard` | Draft/user-prompt attachment | immutable markdown plan snapshot attached to a prompt | compact draft chip + preview action before send; full collapsible transcript card after send |

### 3.1 `ApprovalCard` covers all three approval kinds

There is **one** `ApprovalCard` component with two exports:

- `ApprovalCard` — pure presentational, takes `title / actions / onSelectOption / onAllow / onDeny` props. Usable from the dev playground.
- `ConnectedApprovalCard` — wraps the above with `useActivePendingApproval()` + `useChatPermissionActions()`. Used in production by `useComposerDockSlots`.

Do not split this into `ExecuteApprovalCard` / `EditApprovalCard` / `SwitchModeApprovalCard`. All three kinds use the same shell and the same button row. If a variant ever needs genuinely different rendering (e.g. a radio group with an inline rejection textarea for switch_mode), add a branch inside `ApprovalCard` on `pendingApproval.toolKind` — do not fork the component.

`toolKind` is available on the derived `pendingApproval` from pending interactions (preserved by the SDK reducer at `anyharness/sdk/src/reducer/transcript.ts:applyInteractionRequested`). Do not parse `toolCallId` with regexes.

### 3.2 Proposed plans live in the transcript

Claude's `ExitPlanMode` tool call and Codex's explicit proposed-plan adapter signal carry markdown plan bodies. They render in the **transcript** as `ProposedPlanCard`, not above the composer.

- New runtime sessions emit `proposed_plan` transcript items, and the card owns
  approve/reject/implement-here actions.
- The Claude tool-call intercept in `MessageList.tsx` is a compatibility
  fallback for older runtimes. If a first-class proposed plan exists for the
  same tool call, the tool-call fallback is hidden.
- Do not duplicate the plan body inside the approval card, and do not move it
  above the composer. The plan is a transcript artifact that persists after the
  approval resolves.

### 3.3 Plan references are prompt attachments

Users can attach an existing stored plan to a prompt or hand off a `ProposedPlanCard` into a new session. This is modeled as a prompt block with `planId + snapshotHash`; the runtime resolves the trusted markdown snapshot and echoes it back as a `plan_reference` content part.

- The composer plan picker uses `PopoverButton` + `ComposerPopoverSurface`, the
  same popover primitives as the workspace location control.
- When the add popover launches review-agent configuration from the settings
  icon, keep the add popover visible. The review setup panel is a continuation
  of the add-action path, not a replacement for the `Add file` / `Add plan` /
  review-agent menu.
- The picker list is summary-backed, so its search filters title, agent, source
  kind, and decision status. It does not claim body search unless the runtime
  exposes body snippets or a dedicated search endpoint.
- `PlanReferenceAttachmentCard` renders attached plan refs as compact draft
  chips with a preview dialog before send, and as full inline collapsible cards
  when echoed back in user-message transcripts.
- Do not gate plan references on file/image prompt capabilities. Plans have a
  text fallback in the runtime, so the attach affordance only needs an active
  workspace.
- Plan title/body UI must be `data-telemetry-mask`, including picker rows,
  draft previews, transcript echo cards, and handoff dialogs.
- Attaching or handing off a plan does not approve, reject, or mutate the
  source proposed plan. Approval state remains local to the session that
  received the original proposed-plan item.

### 3.4 Todo tracker covers every agent's live plan

`deriveActiveTodoTracker` reads `plan` items straight off the transcript (latest in-progress item with entries, any `sourceAgentKind`) instead of `deriveCanonicalPlan`. The SDK's canonical derivation excludes Claude's `TodoWrite` because the *formal plan UI* treats it as internal bookkeeping — but internal task tracking is exactly what the progress pill surfaces, so the tracker deliberately bypasses that gate. Keep the two derivations separate: the SDK exclusion still governs the formal plan surfaces, and the pill-side derivation must not feed them.

### 3.5 Workspace-creation receipts belong to one session

The local/worktree creation receipt is a synthetic transcript projection, not a persisted session event. Its settled row belongs only to the session created with the workspace. During the pending-to-materialized handoff, the workspace arrival event carries that ProductClient session alias so the row stays mounted without waiting for the session-list query. After materialization or reload, the earliest server `createdAt` session (ID tie-break) is authoritative. The arrival event remains workspace-scoped for setup and arrival lifecycle state; switching session tabs must not clear it or project its receipt into another session.

### 3.6 File drops attach by upload or local reference

Dropping onto the chat surface accepts every file type and folders. Two transports back the chips:

- **Byte uploads** stay the transport for what the upload pipeline already
  accepts — images within the image cap and small text files — because they
  work on any workspace and put actual pixels in front of the model
  (`promptUploadKind` in `prompt-attachment-rules.ts` is the single
  eligibility source for `addFiles` and drop partitioning).
- **Local references** (`kind: "local_ref"`) cover everything else: folders,
  binaries, and oversize files. They carry an absolute path and submit as
  `resource_link` prompt blocks (`file://` URI), which the runtime passes
  through to the agent untouched; the co-located agent opens the path itself.
  No bytes are read, so there is no size cap and no preview affordance on the
  chip. Folder refs use the `inode/directory` MIME type, which is what flips
  the chip and transcript icon to the folder visual and the metadata label to
  "Folder".

HTML5 drops never expose filesystem paths, so `ChatView` recovers them through the host seam: `host.desktop.files.readDroppedPaths()` reads the macOS drag pasteboard right after the DOM drop (`dragDropEnabled` stays `false`; native Tauri drag-drop would swallow DOM drops app-wide). The resolver is only wired for local-runtime workspaces, mirroring `resolveRuntimeTargetForWorkspace`: `cloud:*` sandboxes cannot read this machine's paths and keep the byte-upload-only behavior, as do the web host and any drag whose pasteboard carries no filenames or whose shape does not correspond to the dropped FileList (`droppedPathsMatchFiles`: every File must consume a distinct candidate, leftover candidates must be directories — the stale-pasteboard guard; the flow falls back to `addFiles`). The pasteboard snapshot is additionally bound to the drop's drag session: `ChatView` captures the pasteboard changeCount while the drag is over the surface and rejects a snapshot read under a different count, and the native read discards snapshots whose changeCount moved mid-read. In-flight path resolutions are discarded when the workspace scope changes so a drop never lands attachments into another workspace's draft. Drops still require an active session with prompt capabilities; the new-chat attachment flow is separate scope (PRO-186).

These are the calls that get broken most easily.

### 4.1 Panels are one dock stack

`ChatComposerDock` wraps dock panes in one shared inset width (`px-5`) so queue, active state, and attached context read as one dock. Slots have no bottom margin and no positive z-index: `ComposerAttachedPanel` is an attached cap above the composer, using `rounded-t-[13px] border-x-[0.5px] border-t-[0.5px] border-border bg-[color:color-mix(in_oklab,var(--color-foreground)_2%,var(--color-background))] backdrop-blur-sm` (the Superset tray shell: 13px top radius, 0.5px hairlines, a 2% foreground tint on the background), while the composer surface paints after the dock panes so the light input's top edge remains visible at the seam. When several trays stack, only the top visible tray keeps top rounding; inner trays flatten into a hairline seam. Do not add a `flatTop` mode, a detached gap, a full-perimeter dock card, a width staircase, a separate color per slot, or a `z-*` layer that lets a dock pane cover the composer's light edge.

The Git/PR workspace-activity cap is the deliberate exception to the inset width: it cancels the slot's `px-5` so its outer edges align with the composer, then `ChatComposerDock` squares the composer's top corners while that cap is present. This is one attached source-control card, not a general alternate dock-panel style.

### 4.2 Headers are minimalist

At most **one** visual element in a header's leading position:

| Pattern | Example | Where |
|---|---|---|
| Loader + tabular-nums step label | `DotCellLoader` + "Step 2/5" | TodoProgressPill |
| Bold content label (no icon) | "Plan" / plan title | ProposedPlanCard |
| Plain medium-weight title (no icon, no label chip) | "git push origin main" / "Ready to code?" | ApprovalCard |

Do **not** stack icon + uppercase label + `·` separator + title. That was the pre-cleanup pattern and it read as noise. If you find yourself adding a second leading element, stop and pick one.

### 4.3 Approval options are Superset-style rows, not buttons

`APPROVAL_BUTTON_CLASSNAME` is gone. Approval options render as full-width `ComposerOptionRow` rows (`apps/packages/product-client/src/components/workspace/chat/input/ComposerOptionRow.tsx`): hairline `border-t border-border/60` separators, a leading number-key badge (`ComposerOptionKeyBadge` — 24px square, 3px radius, `bg-surface-control`, mono), and a hover accent fill that promotes the label from muted to foreground. `useComposerOptionNumberKeys` makes pressing 1–9 select the corresponding option (skipped while typing in an input/textarea/contenteditable). Destructive options (deny/reject/cancel) render their label in `text-destructive`. Both branches (explicit actions and the fallback Allow/Deny pair) go through the same row component — do not reintroduce a button row.

### 4.4 Todo progress pill specifics

See §2.2 for lifecycle/state-machine detail. Visual specifics:

- Pill: `rounded-full bg-popover shadow-popover` + a 0.5px `ring-border` hairline,
  `px-3 py-[5px]`, `text-ui-sm text-muted-foreground` (hover → foreground).
  Content: `DotCellLoader` (`size="compact" variant="wave"`, scaled via
  `--dot-cell-size: 0.125rem; --dot-cell-gap: 0.078rem`) + `"Step N/Total"`
  (`tabular-nums`).
- Hover checklist card: `rounded-[10px] bg-popover shadow-popover` + the same
  0.5px ring, `px-1 py-2`, `max-w-[520px]`. Rows: `CheckCircleFilled` muted +
  `line-through` `text-muted-foreground/60` label (done); `Spinner` +
  `text-foreground` label (in progress); `Circle` faint + `text-muted-foreground`
  label (pending).
- No scroll cap — the pill is transient and the checklist only appears on
  hover, so there is no persistent 160px budget to protect.

Do **not** reintroduce a persistent, always-mounted todo panel in the dock — that is exactly the pattern this pill replaced.

### 4.5 ProposedPlanCard specifics

- `ProposedPlanCard` (ProductClient `workspace/chat/transcript`) is built on
  `CollapsiblePlanCard`, which owns the shell and collapse behavior.
- Shell: `rounded-md border border-border/70 bg-card/85 shadow-sm`.
- Header: bold plan title + optional decision state + icon-only Copy/Collapse
  buttons.
- Body expanded: plain markdown.
- Body collapsed: capped height with a bottom-only `mask-image` fade + a
  floating expand pill labeled "Expand plan summary" centered near the bottom.
- Approve copy: "Approve and continue" when the plan is a native continuation
  (the harness resumes implementation in-session after approval), "Approve
  plan" otherwise.
- Pending decision actions render in the transcript card, not in the composer
  interaction slot. Generic linked permission interactions are suppressed from
  `ConnectedApprovalCard`.
- Default: expanded. Collapse is via the header chevron.

### 4.6 Composer surface + control-row tone (owner rev 2026-07-02)

Control-row tone rule — the pills are **monochrome**:

- Every control pill is a `ComposerControlButton`
  ([ComposerControlButton.tsx](../../../apps/packages/product-client/src/primitives/patterns/composer/ComposerControlButton.tsx)). It has no
  `tone` prop; the tone system was deleted 2026-07-02 along with the plan-mode
  tint (`--color-plan-border` is gone). Do **not** reintroduce mode-based
  tinting on the mode pill or any other control.
- Hierarchy is two-tone value-vs-affordance, not color. Two bright paths:
  `emphasizeLabel` brightens ONLY the label span (icons/chevrons/details stay
  in `--color-composer-control-foreground` / `-muted-foreground`, dim), while
  `active` brightens the whole button — including its icon — with only the
  detail span forced back to muted. Idle pills are fully dim.
- The intelligence selector uses `emphasizeLabel` for the model and the muted
  detail slot for effort, with a dim chevron. Fast mode is only a small state
  glyph inside that same pill when enabled.

As-built composer surface — `ChatComposerSurface` (ProductClient) tags itself with the `chat-composer-surface` class, whose paint lives in `apps/packages/design/src/css/product.css`:

- Background: `--color-composer-background`. Opaque in both modes; light takes
  the `#f6f6f6` rail plane and dark takes the `#2d2d2d` lifted surface.
- Depth: ordinary light composers paint `--shadow-composer`, which combines one
  full CSS-pixel `--color-border-heavy` perimeter with controlled 5px and 20px
  ink-tinted layers. It consumes no layout space and makes the opaque rail fill
  read as an available input even when the editor is empty and the send action
  is disabled. Dark resolves the same token to `none` and stays fill-only. Dock
  layers may not cover the light edge; the workspace-activity cap remains the
  deliberate composite exception with its own ring and squared top seam.
- Radius: `rounded-composer`; `--radius-composer` is 1.75rem (28px).
  `ChatComposerDock` locally overrides only the top corners to zero while the
  full-width workspace-activity cap is present.

Placeholder variants — strings live in `apps/packages/product-client/src/copy/chat/chat-copy.ts` (`CHAT_COMPOSER_LABELS`):

- "Describe a task" — the home composer and any chat whose transcript has no
  turns yet.
- "Ask for a follow-up" — once the session transcript has turns. The signal is
  `ChatView`'s surface mode (`session-transcript`), threaded into `ChatInput`
  as the optional `hasSessionTurns` prop; no store or query is involved.

## 5. No raw primitives, no inline SVGs

Rules that apply throughout ProductClient feature code but are easy to violate in this area specifically:

- **No raw `<button>`.** Use `Button` from `#product/primitives/Button`. If the existing variants don't fit, add a new size/variant to the primitive table — don't hand-roll.
- **No inline SVG icons.** Import each reusable glyph from its concrete `#product/primitives/icons/<owner>` module (`Circle` from `core`, `CheckCircleFilled` from `status`). If you need a new one, add it to the concrete owner module and import it.
- **No inline constants in `.tsx` files** for fixture data. Playground fixtures live in `lib/domain/chat/__fixtures__/playground.ts`. Scenario config lives in `config/playground.ts`.

## 6. Things that are explicitly forbidden

These are patterns that were tried and rejected. Reintroducing them reopens known problems:

- **Detached dock-region cards (`rounded-2xl border` plus a dock gap).** Panels above the composer are attached trays, not separate floating cards. Keep `ComposerAttachedPanel` on the rounded-top hairline tray shell (§4.1) and keep dock-region wrappers gapless.
- **Positive z-index on dock-region wrappers.** The composer must paint after attached trays so its light top edge remains visible at the seam.
- **Ad hoc `first:*` stacking rounded-corner tricks.** Dock-region order is explicit in `ChatComposerDock`; do not fake region-specific corner behavior with selector tricks.
- **`flatTop` on `ChatComposerSurface`.** The prop was deleted. The one allowed squared-top state is owned by `ChatComposerDock`'s workspace-activity selector; do not add a composer API or reuse that state for ordinary attached trays.
- **Regex classifier on `toolCallId` in `permission-prompt.ts`.** Dead code. Read `pendingApproval.toolKind` directly.
- **`embeddedInComposer` permission variant that replaces the textarea.** Dead code. Approvals always sit above the composer; the textarea stays usable.
- **Merging generic tool approval buttons into `ProposedPlanCard`.** Generic
  tool approvals go in `ApprovalCard`; formal plan decisions go in
  `ProposedPlanCard`.
- **`!h-8 !px-2.5` style `!important` button overrides.** Fixed at the root by adding `tailwind-merge` to the `Button` primitive. Don't reintroduce `!` bangs.
- **`useActivePlan` hook.** Renamed to `useActiveTodoTracker`; it now derives from raw `plan` items across all agents (see §3.4). The old name and signature are gone.
- **Icons + label chips + separator + title stacked in a header.** The whole "RUN COMMAND · git push origin main" pattern was dropped. Just the title.

## 7. Iterating visually — the playground

`ChatPlaygroundPage` at `pages/ChatPlaygroundPage.tsx` renders every interesting composer-area state from fake fixtures so you don't need a Claude/Codex session to iterate. Navigate to `http://localhost:1420/playground` while `make dev` is running.

Scenarios (selectable via `?s=<key>`):

- `clean` — baseline, no panel
- `composer-follow-up-empty` — ordinary empty editable follow-up composer with normal controls and disabled send
- `composer-long-input` — long populated read-only composer at the workspace row cap
- `todos-short`, `todos-mid`, `todos-long` — TodoProgressPill pinned open (pill + checklist) at three plan sizes, via `PlaygroundFloatingSlotFixtures.tsx`
- `execute-approval`, `edit-approval` — ApprovalCard execute/edit variants
- `workspace-receipt-setup-succeeded`, `workspace-receipt-setup-failed` — WorkspaceCreationReceiptView (transcript creation receipt) collapsed/expanded
- `cloud-first-runtime`, `cloud-provisioning`, `cloud-applying-files`, `cloud-blocked`, `cloud-error`, `cloud-reconnecting`, `cloud-reconnect-error` — cloud workspace/runtime composer states
- `claude-plan-short`, `claude-plan-long` — ProposedPlanCard in transcript
- `review-feedback-message`, `review-complete-message` — collapsed transcript receipts for review feedback and completed reviews
- `tool-subagent-creation-single`, `tool-subagent-creations`, `subagent-parent-send-card`, `subagent-wake-card` — delegated-work transcript receipt coverage for single creation, grouped creation, parent-send provenance, and wake/completion receipts
- `subagents-composer-few`, `subagents-composer-many`, `subagents-queued-wake`, `subagents-queued-wake-with-approval`, `subagents-coding-review-with-approval` — delegated-work strip, queued wake prompt, coding/review agent, and approval stack coverage
- `subagents-review-starting-plan`, `subagents-review-starting-code`, `subagents-reviewing-plan`, `subagents-reviewing-code`, `subagents-review-feedback-ready`, `subagents-review-complete` — review-agent composer lifecycle coverage
- delegated-work identity coverage must include: single active subagent trigger,
  multiple-agent generic trigger, failed/attention agent visible in the popover,
  completed-success agent hidden by default, and parent composer enabled while
  review/subagent background work is running.
The playground is **dev-only**. It is lazy-loaded via `React.lazy()` gated on `import.meta.env.DEV` in `App.tsx`, so neither the page nor its fixtures land in production bundles.

`/playground/subagents` is a separate fixture-only UX lab for Subagents receipts, navigation, panes, transcripts, and close/archive behavior. It is DEV-gated and does not read or mutate production sessions.

When you change any composer-area component, **load the playground and verify every scenario still looks right** before opening a PR. The playground exists to catch drift — if it stops looking like the real app, either fix the real app or fix the playground (and add a regression scenario).

### Playground structure

Thin page → fat components, per the `pages/**` orchestration-only rule:

- `pages/ChatPlaygroundPage.tsx` — reads the scenario query param, renders layout, delegates
- `config/playground.ts` — `ScenarioKey`, `SCENARIOS`, `resolveScenarioKey`
- `lib/domain/chat/__fixtures__/playground.ts` — fixture data (`TODOS_*`, `CLAUDE_PLAN_*`, `*_OPTIONS`)
- `components/playground/PlaygroundScenarioBar.tsx` — top-bar scenario picker
- `components/playground/PlaygroundTranscript.tsx` — transcript area (renders `ProposedPlanCard` when applicable)
- `components/playground/PlaygroundComposer.tsx` — `ChatComposerDock` + scenario-driven dock slots + read-only composer surface
- `components/playground/composer-slots/PlaygroundFloatingSlotFixtures.tsx` — `floatingSlot` fixture renderer (todo progress pill scenarios)

Adding a new scenario: update `config/playground.ts` (add the key + label), optionally add fixture data in `__fixtures__/playground.ts`, then extend the relevant slot renderer in `PlaygroundComposer` and/or `PlaygroundTranscript`.
