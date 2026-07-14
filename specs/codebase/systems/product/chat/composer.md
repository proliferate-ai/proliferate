# Chat Composer Standards

Status: authoritative for the chat composer area (`apps/desktop/src/components/workspace/chat/input/**`, the panels above the input, and the Claude plan card in the transcript). Owner rev 2026-07-02.

Scope:

- `apps/desktop/src/components/workspace/chat/input/**`
- `apps/packages/product-ui/src/chat/composer/**` — the shared composer surface
  pieces live here, not in Desktop: `ChatComposerSurface`,
  `ChatComposerControlRowFrame`, `ComposerPopoverSurface`.
- `apps/packages/product-ui/src/chat/transcript/ProposedPlanCard.tsx` — the
  desktop file at
  `apps/desktop/src/components/workspace/chat/transcript/ProposedPlanCard.tsx`
  is a re-export only.
- `apps/desktop/src/components/workspace/chat/content/PlanReferenceAttachmentCard.tsx`
- `apps/desktop/src/components/workspace/chat/plans/**`
- `apps/desktop/src/components/workspace/reviews/**`
- `apps/desktop/src/hooks/chat/ui/use-composer-dock-slots.tsx`
- `apps/packages/product-domain/src/chats/composer/resolve-dock-slots.ts`
- `apps/desktop/src/hooks/chat/derived/use-active-todo-tracker.ts`
- `apps/desktop/src/hooks/reviews/**`
- `apps/packages/product-domain/src/chats/tools/active-todo-tracker.ts`
- `apps/packages/product-domain/src/chats/tools/claude-plan-tool-call.ts`
- `apps/desktop/src/lib/domain/reviews/**`
- `apps/desktop/src/stores/reviews/**`

Read this doc before changing the composer, the panels that sit above it (todo tracker, approval card, workspace status, cloud runtime), or where the Claude plan body renders. The structure below was chosen to mirror Codex's reference (`references/codex_todo.html`, `references/codex_plan.html`) and is load-bearing for several visual decisions that are not obvious from the code alone.

For delegated work semantics across subagents, cowork sessions, plan review
agents, code review agents, tab indicators, and delegated-work delete behavior,
also read [delegated-work.md](../agents/delegated-work.md).

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
    │     ├── ConnectedMcpElicitationCard   (MCP form)
    │     └── TodoTrackerPanel              (Codex/Gemini structured plan)
    ├── attachedSlot
    │     ├── WorkspaceArrivalAttachedPanel (workspace arrival/setup/pending/cloud-status)
    │     ├── CloudRuntimeAttachedPanel     (cloud runtime connecting/resuming/error)
    │     ├── DelegatedWorkComposerControl  (one Agents trigger + popover for reviews and subagents)
    │     └── WorkspaceActivityComposerCard (Git/PR summary and source-control actions)
    ├── ChatInput
    │   └── ChatComposerSurface
    │       └── form: ComposerCommandEditor + ModelSelector + SessionConfigControls + ChatComposerActions
    └── footerSlot
        └── reserved for product-specific footer context when present
```

The home screen reuses the same composer: `HomeComposerForm`
(`apps/desktop/src/components/home/screen/HomeComposerForm.tsx`) renders the
same `ChatComposerSurface` + `ChatComposerControlRowFrame` from
`@proliferate/product-ui`, with slot-based render isolation (controls, trailing
controls, and actions are passed in as stable slot elements so keystrokes only
re-render the composer subtree).

Non-negotiable:

- **`ChatComposerDock` owns the dock shell.** Background, scrim, padding, max-width column, slot ordering, and the inset region wrappers all live in `ChatComposerDock.tsx`. The production app (`ChatView`) and the dev playground (`ChatPlaygroundPage`) both render `ChatComposerDock` directly. Do not reconstruct this backdrop in a third place — if you need it somewhere new, reuse the dock.
- **No `backdrop-blur` on the dock's transcript-covering layer.** That layer sits over the scrolling transcript, and backdrop blur forces WKWebView to re-blur everything behind it on every frame. The implementation is a gradient fade into an opaque-ish `bg-background/95` sheet (`ChatComposerDock.tsx`), not a blur.
- **`ChatInput` is the composer surface only.** It does not own any of the outer wrapping. It takes no `topSlot` prop. Everything above and below the composer surface is the dock's responsibility; product-specific footer context must render through the dock rather than ad hoc workspace logic in `ChatInput.tsx`.
- **Do not add in-composer read-only status badges.** MCP/plugin state belongs in settings, session details, or explicit action surfaces, not as a persistent strip inside `ChatInput`.
- **The composer surface paints the seam.** There is no `flatTop` prop or alternate composer mode. Ordinary dock-region panels remain narrower attached trays above the composer. When the full-width workspace-activity cap is present, `ChatComposerDock` squares the composer's top corners with a local `:has()` selector so the cap and input read as one card; removing the cap restores the normal composer radius. The composer still paints after the dock regions so its own top outline remains visible at the seam.
- **Composer command overlays are composer-local, not dock-region inhabitants.** The slash-command tray renders from `ChatInput` in a small host directly above `ChatComposerSurface` while a prompt-leading `/` trigger is active. It is transient editor UI and does not participate in `useComposerDockSlots` precedence.

## 1.1 Model Selector Semantics

The composer model selector presents the model-catalog contract from
`specs/codebase/platforms/product/model-catalog.md`. It must not infer identity from
display labels or from one provider's raw runtime id shape.

Rules:

- Model and reasoning effort share one composer pill: `Model · Effort`. Its
  popover contains the searchable grouped model catalog followed by explicit
  reasoning-effort choices and Fast mode when the harness exposes them. Do not
  render a separate click-to-cycle effort-bars button or a separate Fast icon
  button. Model-only contexts such as plan handoff may omit the tuning section.
- Preserve authored catalog effort labels (`Extra High`, `Max`, `Ultra`, and
  so on); do not rewrite distinct values to internal spellings such as
  `Xhigh`.
- The current composer chip uses the active session's effective runtime model
  once AnyHarness reports one. Pending launches may show requested model intent.
- Picker selected state, dedupe, visibility, and display labels use canonical
  catalog identity after alias/normalization resolution.
- Runtime live config values are preserved for update calls, but they are not
  the rendered product name when a catalog match exists.
- [Model Catalog](../../../platforms/product/model-catalog.md) owns whether a
  selection is current, `update_current_chat`, or `open_new_chat`; Composer
  presents that action and does not derive it from live setter availability.
- [Chat Lifecycle](lifecycle.md) owns the visible create, preserve, and replace
  transition after the classified action is selected.

Any provider-specific compatibility mapping in Desktop must be backed by a
domain-level selector test and, when possible, a recorded AnyHarness fixture
showing the raw session values that required the mapping.

## 1.2 Session control placement

The chat and Home composers use the same control partition and visible order:

1. the combined model/harness, reasoning-effort, and Fast selector
2. the primary working mode selector

Reasoning effort and `fast_mode` live inside the model selector described in
§1.1; they must not also render as separate composer controls. The primary
working mode is compact text plus a subtle disclosure chevron, without a
leading mode icon.

Visible controls use one consistent inter-item rhythm. Compact controls must
not reserve a trailing pending-state slot when no pending state exists; that
empty flex child shifts icon-only controls and creates uneven visual gaps.

`collaboration_mode` is the primary working mode whenever it exposes a choice.
Otherwise a legacy fused `mode` control is primary only when its choices carry
working-mode semantics such as plan, agent, ask, build, bypass, or chat. This
keeps Codex's collaboration mode independent from its read-only/auto/full-access
permissions while preserving harnesses such as Claude, Cursor, and OpenCode
whose working and access behavior still share one mode control.

Permission/access mode and every other unclaimed configuration control render
only under the rightmost three-dot configuration menu. A reasoning-level
control with two or more ordered values remains visible in the combined picker
when the runtime reports it as non-settable, but its choices are disabled.
Cowork hides the permission/access `mode` because its access policy is
product-defined, but retains independent working-mode controls such as
`collaboration_mode` together with model tuning in the combined picker.

## 2. Dock Regions

`resolveComposerDockSlots`
(`apps/packages/product-domain/src/chats/composer/resolve-dock-slots.ts`) owns the
pure precedence rules for the named regions above the composer.
`useComposerDockSlots` (`apps/desktop/src/hooks/chat/ui/use-composer-dock-slots.tsx`)
adapts that data resolution to Desktop React nodes. Classify each inhabitant by
state role first, not by component family. They always render in this order:

1. **`outboundSlot`** — queued outbound work: user prompts, queued wake prompts,
   review feedback prompts, and review-complete prompts.
2. **`activeSlot`** — the active agent state. Permission approvals, user-input
   questions, and MCP elicitation forms take precedence. If there is no blocking
   request, this slot may show `TodoTrackerPanel`.
3. **`attachedSlot`** — ambient attached context and parallel work:
   workspace/worktree/runtime panels plus review agents and linked
   same-workspace subagents.

Review status lives in `attachedSlot`, not in active state. The shared
`DelegatedWorkComposerControl` owns the compact `Agents` summary-control +
popover pattern for reviews and subagents. The review section owns reviewer
rows, critique links, stop, send-feedback, and review-revision actions. Review
automation and linked subagents are parallel delegated work and must not make
normal parent chat input unavailable by themselves. They should not displace
blocking requests or todo state with a full card. Cowork managed workspaces
are surfaced exclusively in the cowork sidebar — they are not duplicated in
the composer Agents popover.

Review runs have two composer-facing classes: blocking workflow runs
(`reviewing`, `feedback_ready`, `parent_revising`, `waiting_for_revision`) and
terminal result notices (`passed`, `stopped`, `system_failed`). The composer may
show one blocking workflow or the latest terminal notice, but dismissing a
terminal notice must not reveal older terminal runs underneath it. Starting a
new review is blocked by workflow runs and optimistic starting state, not by a
finished result notice. This review-start gate is separate from chat input
availability; `parent_revising` keeps review controls visible but leaves parent
chat input enabled.

If you need to introduce another dock-region inhabitant, classify it by state
role first: outbound work, active agent state, or attached context/parallel
work. Add the precedence decision to `resolve-dock-slots.ts` and the Desktop
node adapter to `use-composer-dock-slots.tsx` — do not compute it inline in
`ChatView` and do not introduce a parallel arbiter elsewhere.

`attachedSlot` preserves the shared `DelegatedWorkComposerPanel` containing one
compact `Agents` control for review agents and linked same-workspace child
sessions. The control opens a popover with sections in review, subagent order.
Individual child chips should not be rendered directly above the composer.
Attached delegated work is an indicator layer for adjacent work, not a blocking
prompt panel. `outboundSlot` must render before `activeSlot`; both stack above
attached context/parallel work when present.

The workspace-activity cap is a separate Git/PR surface. It renders last in
the attached stack, after ambient context, delegated work, and session
goal/activity, so it joins directly to the composer. Its collapsed trigger is
text-only, has no disclosure arrow, and shows at most three ordered Git/PR
facts: conflicts or failing checks first, then sync and changed-file state,
then a healthy branch/clean fallback. It never shows filenames, diff stats, or
PR titles. Its detail popover opens from the composer's left edge and owns
Review changes plus the existing Commit, Publish/Push, and Open/Create pull
request entry points.

`DelegatedWorkComposerControl` uses delegated-work identity from the shared
domain view model. The trigger stays the generic `Agents` control when there
are zero or multiple visible delegated items. When exactly one visible item
needs attention or is active, the trigger may use that item's colored robot and
canonical generated display identity.

The delegated-work popover hides completed-success/no-action items by default.
Failed, needs-attention, feedback-ready, and waiting-for-revision items remain
visible until the user acts or dismisses them.

Dock panes share one width and one neutral tray treatment. Hierarchy comes from
state order, copy, and control weight, not from different colors or a width
staircase.

Queued user prompts render only in `outboundSlot`; they are not transcript
rows while they remain pending. The queue supports drag or keyboard reorder,
steer-next, edit, and delete. A queue entry's `seq` is its immutable runtime
identity; array order is authoritative. Reorder mutations use compare-and-swap
semantics by sending both the expected sequence order and desired sequence
order. UI edit and steer state retain `seq`. `promptId` is reserved for local
outbox reconciliation and is not required or assumed unique on runtime queue
rows. With an empty composer at the start of the input, `ArrowUp` begins editing
the newest editable queued prompt. Steering promotes the selected prompt to the
head and interrupts the active turn so normal durable queue drain executes it
next.

## 2.1 Composer footer semantics

The dock owns footer placement when a product-specific footer exists. This
document does not define a shipped workspace migration footer or move flow;
current workspace migration product behavior is absent and owned by
[Workspace migration](../workspaces/migration.md).

## 3. The three composer-area components

All three sit inside the composer area. They differ by lifecycle and role, and their visual language is deliberately unified.

| Component | Lifecycle | Renders | Header shape |
|---|---|---|---|
| `TodoTrackerPanel` | Long-lived, non-gating active agent state | `PlanEntry[]` as a fade-masked list | tiny muted icon + muted status text |
| `ApprovalCard` | Short-lived, gating (demands a decision) | options from `pendingApproval`, one variant for all three `toolKind`s | plain title only — NO icon, NO label chip, NO separator |
| `ProposedPlanCard` | Lives in the **transcript**, not above composer | immutable markdown plan snapshot, decision state, and plan actions | bold plan title + icon-only Copy/Collapse buttons |
| `PlanReferenceAttachmentCard` | Draft/user-prompt attachment | immutable markdown plan snapshot attached to a prompt | compact draft chip + preview action before send; full collapsible transcript card after send |

### 3.1 `ApprovalCard` covers all three approval kinds

There is **one** `ApprovalCard` component with two exports:

- `ApprovalCard` — pure presentational, takes `title / actions / onSelectOption / onAllow / onDeny` props. Usable from the dev playground.
- `ConnectedApprovalCard` — wraps the above with `useActivePendingApproval()` + `useChatPermissionActions()`. Used in production by `useComposerDockSlots`.

Do not split this into `ExecuteApprovalCard` / `EditApprovalCard` / `SwitchModeApprovalCard`. All three kinds use the same shell and the same button row. If a variant ever needs genuinely different rendering (e.g. a radio group with an inline rejection textarea for switch_mode), add a branch inside `ApprovalCard` on `pendingApproval.toolKind` — do not fork the component.

`toolKind` is available on the derived `pendingApproval` from pending
interactions (preserved by the SDK reducer at
`anyharness/sdk/src/reducer/transcript.ts:applyInteractionRequested`). Do not
parse `toolCallId` with regexes.

### 3.2 Proposed plans live in the transcript

Claude's `ExitPlanMode` tool call and Codex's explicit proposed-plan adapter
signal carry markdown plan bodies. They render in the **transcript** as
`ProposedPlanCard`, not above the composer.

- New runtime sessions emit `proposed_plan` transcript items, and the card owns
  approve/reject/implement-here actions.
- The Claude tool-call intercept in `MessageList.tsx` is a compatibility
  fallback for older runtimes. If a first-class proposed plan exists for the
  same tool call, the tool-call fallback is hidden.
- Do not duplicate the plan body inside the approval card, and do not move it
  above the composer. The plan is a transcript artifact that persists after the
  approval resolves.

### 3.3 Plan references are prompt attachments

Users can attach an existing stored plan to a prompt or hand off a
`ProposedPlanCard` into a new session. This is modeled as a prompt block with
`planId + snapshotHash`; the runtime resolves the trusted markdown snapshot and
echoes it back as a `plan_reference` content part.

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

### 3.4 Todo tracker is Codex/Gemini only

`useActiveTodoTracker` narrows `deriveCanonicalPlan` to `sourceKind === "structured_plan"`. Claude's `plan` items are filtered out by the SDK (Claude's `TodoWrite` is internal bookkeeping, not a presented plan). Do not re-enable Claude's structured plans in the todo tracker — they belong elsewhere.

## 4. Visual rules (the Codex minimalist pattern)

Borrowed directly from `references/codex_todo.html` and `references/codex_plan.html`. These are the calls that get broken most easily.

### 4.1 Panels are one dock stack

`ChatComposerDock` wraps dock panes in one shared inset width (`px-5`) so queue,
active state, and attached context read as one dock. Slots have no bottom margin
and no positive z-index: `ComposerAttachedPanel` is an attached cap above the
composer, using `rounded-t-[13px] border-x-[0.5px] border-t-[0.5px]
border-border bg-[color:color-mix(in_oklab,var(--color-foreground)_2%,var(--color-background))]
backdrop-blur-sm` (the Superset tray shell: 13px top radius, 0.5px hairlines, a
2% foreground tint on the background), while the composer surface paints after
the dock panes so the input's top outline remains visible at the seam. When several trays stack, only the top
visible tray keeps top rounding; inner trays flatten into a hairline seam. Do
not add a `flatTop` mode, a detached gap, a full-perimeter dock card, a width
staircase, a separate color per slot, or a `z-*` layer that lets a dock pane
cover the composer border.

The Git/PR workspace-activity cap is the deliberate exception to the inset
width: it cancels the slot's `px-5` so its outer edges align with the composer,
then `ChatComposerDock` squares the composer's top corners while that cap is
present. This is one attached source-control card, not a general alternate
dock-panel style.

### 4.2 Headers are minimalist

At most **one** visual element in a header's leading position:

| Pattern | Example | Where |
|---|---|---|
| Tiny muted icon + muted text | `ClipboardList` icon + "1 out of 5 tasks completed" | TodoTrackerPanel |
| Bold content label (no icon) | "Plan" / plan title | ProposedPlanCard |
| Plain medium-weight title (no icon, no label chip) | "git push origin main" / "Ready to code?" | ApprovalCard |

Do **not** stack icon + uppercase label + `·` separator + title. That was the pre-cleanup pattern and it read as noise. If you find yourself adding a second leading element, stop and pick one.

### 4.3 Approval options are Superset-style rows, not buttons

`APPROVAL_BUTTON_CLASSNAME` is gone. Approval options render as full-width
`ComposerOptionRow` rows (`apps/desktop/src/components/workspace/chat/input/ComposerOptionRow.tsx`):
hairline `border-t border-border/60` separators, a leading number-key badge
(`ComposerOptionKeyBadge` — 24px square, 3px radius, `bg-surface-control`,
mono), and a hover accent fill that promotes the label from muted to
foreground. `useComposerOptionNumberKeys` makes pressing 1–9 select the
corresponding option (skipped while typing in an input/textarea/contenteditable).
Destructive options (deny/reject/cancel) render their label in
`text-destructive`. Both branches (explicit actions and the fallback
Allow/Deny pair) go through the same row component — do not reintroduce a
button row.

### 4.4 Todo tracker specifics

- Header: tiny icon + muted status text (`text-muted-foreground`), no bold.
- Body: `vertical-scroll-fade-mask max-h-40` (160px cap) with `[--edge-fade-distance:2rem]`.
  The fade-mask utility lives in `apps/packages/design/src/css/dom.css` so shared chat
  components can use it on Desktop and Web.
- Completed entries: `line-through` + `text-muted-foreground/60` on both the index and the content span.
- Default: expanded. Collapse chevron in header.

Do **not** grow the scroll cap past `max-h-40` — the Codex reference is exactly this size and larger caps dominate the composer visually.

### 4.5 ProposedPlanCard specifics

- `ProposedPlanCard` (product-ui `chat/transcript`) is built on
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
  (`apps/packages/ui/src/primitives/ComposerControlButton.tsx`). It has no
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

As-built composer surface — `ChatComposerSurface` (product-ui) tags itself with
the `chat-composer-surface` class, whose paint lives in
`apps/packages/design/src/css/dom.css`:

- Background: `--color-composer-background`.
- Outline: a 0.5px stroke-in-shadow (`0 0 0 0.5px var(--color-composer-border)`)
  stacked with `--color-composer-shadow` (the desktop theme sets it to
  `--shadow-composer`; the `dom.css` baseline is `--shadow-subtle`) — there is
  no CSS `border`.
- Radius: `rounded-[var(--radius-composer,1rem)]`; `--radius-composer` is 1rem.
  `ChatComposerDock` locally overrides only the top corners to zero while the
  full-width workspace-activity cap is present.

Placeholder variants — strings live in
`apps/desktop/src/copy/chat/chat-copy.ts` (`CHAT_COMPOSER_LABELS`):

- "Describe a task" — the home composer and any chat whose transcript has no
  turns yet.
- "Ask for a follow-up" — once the session transcript has turns. The signal is
  `ChatView`'s surface mode (`session-transcript`), threaded into `ChatInput`
  as the optional `hasSessionTurns` prop; no store or query is involved.

## 5. No raw primitives, no inline SVGs

Rules that apply everywhere in `apps/desktop/src/**` but are easy to violate in this area specifically:

- **No raw `<button>`.** Use `Button` from `components/ui/Button.tsx`. If the existing variants don't fit, add a new size/variant to the primitive table — don't hand-roll.
- **No inline SVG icons.** Status icons (`Circle`, `CheckCircleFilled`, etc.) live in `components/ui/icons.tsx`. If you need a new one, add it there and import it.
- **No inline constants in `.tsx` files** for fixture data. Playground fixtures live in `lib/domain/chat/__fixtures__/playground.ts`. Scenario config lives in `config/playground.ts`.

## 6. Things that are explicitly forbidden

These are patterns that were tried and rejected. Reintroducing them reopens known problems:

- **Detached dock-region cards (`rounded-2xl border` plus a dock gap).** Panels above the composer are attached trays, not separate floating cards. Keep `ComposerAttachedPanel` on the rounded-top hairline tray shell (§4.1) and keep dock-region wrappers gapless.
- **Positive z-index on dock-region wrappers.** The composer must paint after attached trays so its top outline remains visible at the seam.
- **Ad hoc `first:*` stacking rounded-corner tricks.** Dock-region order is explicit in `ChatComposerDock`; do not fake region-specific corner behavior with selector tricks.
- **`flatTop` on `ChatComposerSurface`.** The prop was deleted. The one allowed squared-top state is owned by `ChatComposerDock`'s workspace-activity selector; do not add a composer API or reuse that state for ordinary attached trays.
- **Regex classifier on `toolCallId` in `permission-prompt.ts`.** Dead code. Read `pendingApproval.toolKind` directly.
- **`embeddedInComposer` permission variant that replaces the textarea.** Dead code. Approvals always sit above the composer; the textarea stays usable.
- **Merging generic tool approval buttons into `ProposedPlanCard`.** Generic
  tool approvals go in `ApprovalCard`; formal plan decisions go in
  `ProposedPlanCard`.
- **`!h-8 !px-2.5` style `!important` button overrides.** Fixed at the root by adding `tailwind-merge` to the `Button` primitive. Don't reintroduce `!` bangs.
- **`useActivePlan` hook.** Renamed to `useActiveTodoTracker` and narrowed to `structured_plan` only. The old name and signature are gone.
- **Icons + label chips + separator + title stacked in a header.** The whole "RUN COMMAND · git push origin main" pattern was dropped. Just the title.

## 7. Iterating visually — the playground

`ChatPlaygroundPage` at `pages/ChatPlaygroundPage.tsx` renders every interesting composer-area state from fake fixtures so you don't need a Claude/Codex session to iterate. Navigate to `http://localhost:1420/playground` while `make dev` is running.

Scenarios (selectable via `?s=<key>`):

- `clean` — baseline, no panel
- `todos-short`, `todos-mid`, `todos-long` — TodoTrackerPanel at three sizes
- `execute-approval`, `edit-approval` — ApprovalCard execute/edit variants
- `workspace-arrival-created` — WorkspaceArrivalAttachedPanel above the composer
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

`/playground/subagents` is a separate fixture-only UX lab for Subagents receipts,
navigation, panes, transcripts, and close/archive behavior. It is DEV-gated and
does not read or mutate production sessions.

When you change any composer-area component, **load the playground and verify every scenario still looks right** before opening a PR. The playground exists to catch drift — if it stops looking like the real app, either fix the real app or fix the playground (and add a regression scenario).

### Playground structure

Thin page → fat components, per the `pages/**` orchestration-only rule:

- `pages/ChatPlaygroundPage.tsx` — reads the scenario query param, renders layout, delegates
- `config/playground.ts` — `ScenarioKey`, `SCENARIOS`, `resolveScenarioKey`
- `lib/domain/chat/__fixtures__/playground.ts` — fixture data (`TODOS_*`, `CLAUDE_PLAN_*`, `*_OPTIONS`)
- `components/playground/PlaygroundScenarioBar.tsx` — top-bar scenario picker
- `components/playground/PlaygroundTranscript.tsx` — transcript area (renders `ProposedPlanCard` when applicable)
- `components/playground/PlaygroundComposer.tsx` — `ChatComposerDock` + scenario-driven dock slots + read-only composer surface

Adding a new scenario: update `config/playground.ts` (add the key + label), optionally add fixture data in `__fixtures__/playground.ts`, then extend the relevant slot renderer in `PlaygroundComposer` and/or `PlaygroundTranscript`.
