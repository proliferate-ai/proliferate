# Chat Composer Standards

Status: authoritative for the chat composer area (`desktop/src/components/workspace/chat/input/**`, the panels above the input, and the Claude plan card in the transcript).

Scope:

- `desktop/src/components/workspace/chat/input/**`
- `desktop/src/components/workspace/chat/transcript/ProposedPlanCard.tsx`
- `desktop/src/components/workspace/chat/content/PlanReferenceAttachmentCard.tsx`
- `desktop/src/components/workspace/chat/plans/**`
- `desktop/src/components/workspace/reviews/**`
- `desktop/src/hooks/chat/use-composer-dock-slots.tsx`
- `desktop/src/hooks/chat/use-active-todo-tracker.ts`
- `desktop/src/hooks/reviews/**`
- `desktop/src/lib/domain/chat/active-todo-tracker.ts`
- `desktop/src/lib/domain/chat/claude-plan-tool-call.ts`
- `desktop/src/lib/domain/reviews/**`
- `desktop/src/stores/reviews/**`

Read this doc before changing the composer, the panels that sit above it (todo tracker, approval card, workspace status, cloud runtime), or where the Claude plan body renders. The structure below was chosen to mirror Codex's reference (`references/codex_todo.html`, `references/codex_plan.html`) and is load-bearing for several visual decisions that are not obvious from the code alone.

## 1. Layout

Three layers, top to bottom:

```text
ChatView
└── ChatComposerDock                        (backdrop + scrim + padded max-width column + inset dock regions)
    ├── contextSlot: at most one of
    │     ├── WorkspaceArrivalAttachedPanel (workspace arrival/setup/pending/cloud-status)
    │     ├── CloudRuntimeAttachedPanel     (cloud runtime connecting/resuming/error)
    │     └── TodoTrackerPanel              (Codex/Gemini structured plan)
    ├── queueSlot
    │     └── PendingPromptList             (queued prompts)
    ├── interactionSlot
    │     ├── ConnectedApprovalCard         (pending tool approval)
    │     ├── ConnectedUserInputCard        (agent question/form)
    │     └── ConnectedMcpElicitationCard   (MCP form)
    ├── delegationSlot
    │     ├── ComposerReviewRunPanel        (summary control + popover list/actions for review agents)
    │     ├── CoworkComposerStrip           (summary control + popover list for coding workspaces)
    │     └── SubagentComposerStrip         (summary control + popover list for linked child sessions)
    ├── ChatInput
    │   └── ChatComposerSurface
    │       └── form: ComposerMentionEditor + ModelSelector + SessionConfigControls + ChatComposerActions
    └── footerSlot
        └── WorkspaceMobilityFooterRow
```

Non-negotiable:

- **`ChatComposerDock` owns the dock shell.** Background, scrim, padding, max-width column, slot ordering, and the inset region wrappers all live in `ChatComposerDock.tsx`. The production app (`ChatView`) and the dev playground (`ChatPlaygroundPage`) both render `ChatComposerDock` directly. Do not reconstruct this backdrop in a third place — if you need it somewhere new, reuse the dock.
- **`ChatInput` is the composer surface only.** It does not own any of the outer wrapping. It takes no `topSlot` prop. Everything above and below the composer surface is the dock's responsibility, and the workspace footer row is rendered via the dock's dedicated footer slot rather than ad hoc workspace logic in `ChatInput.tsx`.
- **Do not add in-composer read-only status badges.** MCP/plugin state belongs in settings, session details, or explicit action surfaces, not as a persistent strip inside `ChatInput`.
- **The composer surface stays unchanged and paints the seam.** There is no `flatTop` mode. Dock-region panels are narrower attached trays that sit directly above the composer: rounded top corners, side/top borders, no bottom border, and no gap. The composer surface paints after the dock regions so its own top outline remains visible at the seam.
- **File mention search is composer-local, not a dock-region inhabitant.** The `@` file search tray renders from `ChatInput` in a small host directly above `ChatComposerSurface` while a trigger is active. It is transient editor UI and does not participate in `useComposerDockSlots` precedence.

## 2. Dock Regions

`useComposerDockSlots` (`desktop/src/hooks/chat/use-composer-dock-slots.tsx`)
derives the named regions above the composer. They always render in this order:

1. **`contextSlot`** — workspace/worktree/runtime context first. The slot holds at most one of `WorkspaceArrivalAttachedPanel`, `CloudRuntimeAttachedPanel`, or `TodoTrackerPanel`.
2. **`queueSlot`** — queued prompts and queued wake prompts.
3. **`interactionSlot`** — active questions/forms: permission approvals, user-input questions, and MCP elicitation forms.
4. **`delegationSlot`** — composer-attached delegated work summaries: review agents, cowork coding sessions, and linked same-workspace subagents.

Review status lives in `delegationSlot`, not `contextSlot`. `ComposerReviewRunPanel`
uses the same compact summary-control + popover pattern as subagents/cowork.
The popover owns reviewer rows, critique links, stop, send-feedback, and
review-revision actions. Review automation can still make the composer
unavailable through chat availability state, but it should not displace the
todo tracker or workspace/cloud panels with a full card.

Review runs have two composer-facing classes: blocking workflow runs
(`reviewing`, `feedback_ready`, `parent_revising`, `waiting_for_revision`) and
terminal result notices (`passed`, `stopped`, `system_failed`). The composer may
show one blocking workflow or the latest terminal notice, but dismissing a
terminal notice must not reveal older terminal runs underneath it. Starting a
new review is blocked by workflow runs and optimistic starting state, not by a
finished result notice.

If you need to introduce another dock-region inhabitant, classify it by state
role first: context, delegated work, queued work, or active interaction. Add it
to `use-composer-dock-slots.tsx` — do not compute it inline in `ChatView` and
do not introduce a parallel arbiter elsewhere.

`delegationSlot` renders one shared `DelegatedWorkComposerPanel` containing
compact summary controls for review agents, cowork coding sessions, and linked
same-workspace child sessions. Each control opens a popover list with the full
child-session/action set; individual child chips should not be rendered directly
above the composer. `delegationSlot` is the bottom dock pane and must remain
directly attached to `ChatInput`; it is an indicator layer for adjacent work,
not a blocking prompt panel. `queueSlot` must render before active questions,
forms, and permission approvals in `interactionSlot`; both stack above
delegated work when present. When multiple delegated-work controls are visible,
they live in the same panel in review, cowork, subagent order.

Dock panes are narrower than the composer. When several panes stack, higher
context panes are slightly narrower than lower panes so each layer reads as
attached to, but lighter than, the section below it.

## 2.1 Composer footer semantics

`WorkspaceMobilityFooterRow` is the dedicated mobility row beneath the composer surface.

- It holds persistent workspace identity and mobility entry controls.
- It is rendered beneath `ChatInput` via `ChatComposerDock.footerSlot`.
- It uses `ComposerControlButton`, not ad hoc button treatments.
- The location control is the only footer control that opens UI, via `PopoverButton` + `ComposerPopoverSurface`.
- The detail and branch controls are direct utility actions: local workspaces copy a filesystem path, cloud workspaces copy repository identity, and branch copies the branch name.
- In-flight workspace mobility does **not** render in the dock-slot path anymore. It uses the dedicated `ChatView` overlay instead.

## 3. The three composer-area components

All three sit inside the composer area. They differ by lifecycle and role, and their visual language is deliberately unified.

| Component | Lifecycle | Renders | Header shape |
|---|---|---|---|
| `TodoTrackerPanel` | Long-lived, non-gating (ambient status) | `PlanEntry[]` as a fade-masked list | tiny muted icon + muted status text |
| `ApprovalCard` | Short-lived, gating (demands a decision) | options from `pendingApproval`, one variant for all three `toolKind`s | plain title only — NO icon, NO label chip, NO separator |
| `ProposedPlanCard` | Lives in the **transcript**, not above composer | immutable markdown plan snapshot, decision state, and plan actions | bold plan title + icon-only Copy/Collapse buttons |
| `PlanReferenceAttachmentCard` | Draft/user-prompt attachment | immutable markdown plan snapshot attached to a prompt | compact draft chip + preview action before send; full collapsible transcript card after send |

### 3.1 `ApprovalCard` covers all three approval kinds

There is **one** `ApprovalCard` component with two exports:

- `ApprovalCard` — pure presentational, takes `title / actions / onSelectOption / onAllow / onDeny` props. Usable from the dev playground.
- `ConnectedApprovalCard` — wraps the above with `useActiveChatSessionState()` + `useChatPermissionActions()`. Used in production by `useComposerDockSlots`.

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

### 4.1 Panels are narrower than the composer

`ChatComposerDock` wraps dock panes in inset region wrappers so every pane is narrower than the composer surface. Delegated-work panes use `px-5` because they attach directly to `ChatInput`; interaction, queue, and context panes are progressively narrower as they stack upward. Slots have no bottom margin and no positive z-index: `ComposerAttachedPanel` is an attached cap above the composer, using `rounded-t-2xl border-x border-t border-border/80`, while the composer surface paints after the dock panes so the input's top outline remains visible at the seam. Do not add a `flatTop` mode, a detached gap, a full-perimeter dock card, or a `z-*` layer that lets a dock pane cover the composer border.

### 4.2 Headers are minimalist

At most **one** visual element in a header's leading position:

| Pattern | Example | Where |
|---|---|---|
| Tiny muted icon + muted text | `ClipboardList` icon + "1 out of 5 tasks completed" | TodoTrackerPanel |
| Bold content label (no icon) | "Plan" / plan title | ProposedPlanCard |
| Plain medium-weight title (no icon, no label chip) | "git push origin main" / "Ready to code?" | ApprovalCard |

Do **not** stack icon + uppercase label + `·` separator + title. That was the pre-cleanup pattern and it read as noise. If you find yourself adding a second leading element, stop and pick one.

### 4.3 Button sizing is uniform in ApprovalCard

All approval action buttons use `size="sm"` with `className="rounded-xl px-2.5 text-sm"`. Both branches (explicit-actions and fallback allow/deny) use the same constant (`APPROVAL_BUTTON_CLASSNAME`). Do not diverge the two rows, and do not use `!important` modifiers — the `Button` primitive uses `tailwind-merge` so plain className overrides win.

### 4.4 Todo tracker specifics

- Header: tiny icon + muted status text (`text-muted-foreground`), no bold.
- Body: `vertical-scroll-fade-mask max-h-40` (160px cap) with `[--edge-fade-distance:2rem]`.
- Completed entries: `line-through` + `text-muted-foreground/60` on both the index and the content span.
- Default: expanded. Collapse chevron in header.

Do **not** grow the scroll cap past `max-h-40` — the Codex reference is exactly this size and larger caps dominate the composer visually.

### 4.5 ProposedPlanCard specifics

- Shell: `rounded-lg bg-foreground/5` (borderless, very subtle tint — no outline).
- Header: bold plan title + optional decision state + `Button size="icon-sm"` Copy + `Button size="icon-sm"` Collapse.
- Body expanded: plain markdown at `px-4 py-3`.
- Body collapsed: `max-height: min(20rem, 45vh)` with a bottom-only `mask-image` fade + a floating `Button size="pill" variant="inverted"` "Expand plan" pill centered near the bottom.
- Pending decision actions render in the transcript card, not in the composer
  interaction slot. Generic linked permission interactions are suppressed from
  `ConnectedApprovalCard`.
- Default: expanded. Collapse is via the header chevron.

## 5. No raw primitives, no inline SVGs

Rules that apply everywhere in `desktop/src/**` but are easy to violate in this area specifically:

- **No raw `<button>`.** Use `Button` from `components/ui/Button.tsx`. If the existing variants don't fit, add a new size/variant to the primitive table — don't hand-roll.
- **No inline SVG icons.** Status icons (`Circle`, `CheckCircleFilled`, etc.) live in `components/ui/icons.tsx`. If you need a new one, add it there and import it.
- **No inline constants in `.tsx` files** for fixture data. Playground fixtures live in `lib/domain/chat/__fixtures__/playground.ts`. Scenario config lives in `config/playground.ts`.

## 6. Things that are explicitly forbidden

These are patterns that were tried and rejected. Reintroducing them reopens known problems:

- **Detached dock-region cards (`rounded-2xl border` plus a dock gap).** Panels above the composer are attached trays, not separate floating cards. Keep `ComposerAttachedPanel` on the `rounded-t-2xl border-x border-t` shell and keep dock-region wrappers gapless.
- **Positive z-index on dock-region wrappers.** The composer must paint after attached trays so its top outline remains visible at the seam.
- **Ad hoc `first:*` stacking rounded-corner tricks.** Dock-region order is explicit in `ChatComposerDock`; do not fake region-specific corner behavior with selector tricks.
- **`flatTop` on `ChatComposerSurface`.** The prop was deleted. The composer surface keeps its normal styling. Panels above are attached trays, not a replacement shell for the composer.
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
- `subagents-composer-few`, `subagents-composer-many`, `subagents-queued-wake`, `subagents-queued-wake-with-approval`, `subagents-coding-review-with-approval` — delegated-work strip, queued wake prompt, coding/review agent, and approval stack coverage
- `subagents-review-starting-plan`, `subagents-review-starting-code`, `subagents-reviewing-plan`, `subagents-reviewing-code`, `subagents-review-feedback-ready`, `subagents-review-complete` — review-agent composer lifecycle coverage
- `mobility-local-actionable`, `mobility-local-blocked`, `mobility-unpublished-branch`, `mobility-unpushed-commits`, `mobility-out-of-sync-branch`, `mobility-cloud-active`, `mobility-in-flight`, `mobility-failed` — composer footer row + mobility states

The playground is **dev-only**. It is lazy-loaded via `React.lazy()` gated on `import.meta.env.DEV` in `App.tsx`, so neither the page nor its fixtures land in production bundles.

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
