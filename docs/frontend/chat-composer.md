# Chat Composer Standards

Status: authoritative for the chat composer area (`desktop/src/components/workspace/chat/input/**`, the panels above the input, and the Claude plan card in the transcript).

Scope:

- `desktop/src/components/workspace/chat/input/**`
- `desktop/src/components/workspace/chat/transcript/ProposedPlanCard.tsx`
- `desktop/src/components/workspace/chat/content/PlanReferenceAttachmentCard.tsx`
- `desktop/src/components/workspace/chat/plans/**`
- `desktop/src/hooks/chat/use-composer-top-slot.tsx`
- `desktop/src/hooks/chat/use-active-todo-tracker.ts`
- `desktop/src/lib/domain/chat/active-todo-tracker.ts`
- `desktop/src/lib/domain/chat/claude-plan-tool-call.ts`

Read this doc before changing the composer, the panels that sit above it (todo tracker, approval card, workspace status, cloud runtime), or where the Claude plan body renders. The structure below was chosen to mirror Codex's reference (`references/codex_todo.html`, `references/codex_plan.html`) and is load-bearing for several visual decisions that are not obvious from the code alone.

## 1. Layout

Three layers, top to bottom:

```text
ChatView
└── ChatComposerDock                        (backdrop + scrim + padded max-width column + inset top-slot region)
    ├── topSlot: at most one of
    │     ├── ConnectedApprovalCard         (pending tool approval)
    │     ├── TodoTrackerPanel              (Codex/Gemini structured plan)
    │     ├── WorkspaceArrivalAttachedPanel (workspace arrival/setup/pending/cloud-status)
    │     └── CloudRuntimeAttachedPanel     (cloud runtime connecting/resuming/error)
    ├── ChatInput
    │   └── ChatComposerSurface
    │       └── form: ComposerMentionEditor + ModelSelector + SessionConfigControls + ChatComposerActions
    └── footerSlot
        └── WorkspaceMobilityFooterRow
```

Non-negotiable:

- **`ChatComposerDock` owns the dock shell.** Background, scrim, padding, max-width column, and the inset `px-5` top-slot wrapper all live in `ChatComposerDock.tsx`. The production app (`ChatView`) and the dev playground (`ChatPlaygroundPage`) both render `ChatComposerDock` directly. Do not reconstruct this backdrop in a third place — if you need it somewhere new, reuse the dock.
- **`ChatInput` is the composer surface only.** It does not own any of the outer wrapping. It takes no `topSlot` prop. Everything above and below the composer surface is the dock's responsibility, and the workspace footer row is rendered via the dock's dedicated footer slot rather than ad hoc workspace logic in `ChatInput.tsx`.
- **Powers status is in-composer status chrome.** `SessionPowersSummary` is the only approved read-only strip inside `ChatInput`. It summarizes MCP/Powers bindings applied at session launch or resume; it is not a gating top-slot inhabitant and must not compete with approvals, todo tracker, workspace arrival, or runtime status precedence.
- **The composer surface stays unchanged and paints the seam.** There is no `flatTop` mode. Top-slot panels are narrower attached trays that sit directly above the composer: rounded top corners, side/top borders, no bottom border, and no gap. The composer surface paints after the top slot so its own top outline remains visible at the seam.
- **File mention search is composer-local, not a top-slot inhabitant.** The `@` file search tray renders from `ChatInput` in a small host directly above `ChatComposerSurface` while a trigger is active. It is transient editor UI and does not participate in `useComposerTopSlot` precedence.

## 2. Top-slot precedence

The slot holds **at most one** inhabitant at a time. The precedence order is computed once in `useComposerTopSlot` (`desktop/src/hooks/chat/use-composer-top-slot.tsx`):

1. **`ConnectedApprovalCard`** — any `pendingApproval` on the active slot
2. **`TodoTrackerPanel`** — an active structured plan (Codex/Gemini, non-empty entries, status `in_progress`)
3. **`WorkspaceArrivalAttachedPanel`** — workspace arrival / setup / pending / cloud-status
4. **`CloudRuntimeAttachedPanel`** — cloud runtime in any non-ready phase

If you need to introduce a fifth inhabitant, add it to the precedence chain in `use-composer-top-slot.tsx` — do not compute it inline in `ChatView` and do not introduce a parallel arbiter elsewhere.

**Stacking is explicitly deferred.** When a genuine multi-inhabitant scenario arises (e.g. an `execute` approval while a Codex todo tracker is also active), upgrade `useComposerTopSlot` to return `ReactNode[]` and update `ChatComposerDock` to render them stacked. Until then, do not prep for stacking with `first:rounded-t-2xl` tricks or similar — see §6.

## 2.1 Composer footer semantics

`WorkspaceMobilityFooterRow` is the dedicated mobility row beneath the composer surface.

- It holds persistent workspace identity and mobility entry controls.
- It is rendered beneath `ChatInput` via `ChatComposerDock.footerSlot`.
- It uses `ComposerControlButton`, not ad hoc button treatments.
- The location control is the only footer control that opens UI, via `PopoverButton` + `ComposerPopoverSurface`.
- Path and branch controls are direct utility actions that copy their full values.
- In-flight workspace mobility does **not** render in the top-slot path anymore. It uses the dedicated `ChatView` overlay instead.

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
- `ConnectedApprovalCard` — wraps the above with `useActiveChatSessionState()` + `useChatPermissionActions()`. Used in production by `useComposerTopSlot`.

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

`ChatComposerDock` wraps the top-slot in `<div className="... px-5">` so the panel is inset 20px from the composer surface on each side. The slot has no bottom margin and no positive z-index: `ComposerAttachedPanel` is an attached cap above the composer, using `rounded-t-2xl border-x border-t border-border/80`, while the composer surface paints after it so the input's top outline stays visible. Do not add a `flatTop` mode, a detached gap, a full-perimeter top-slot card, or a `z-*` layer that lets the top slot cover the composer border.

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
  top slot. Generic linked permission interactions are suppressed from
  `ConnectedApprovalCard`.
- Default: expanded. Collapse is via the header chevron.

## 5. No raw primitives, no inline SVGs

Rules that apply everywhere in `desktop/src/**` but are easy to violate in this area specifically:

- **No raw `<button>`.** Use `Button` from `components/ui/Button.tsx`. If the existing variants don't fit, add a new size/variant to the primitive table — don't hand-roll.
- **No inline SVG icons.** Status icons (`Circle`, `CheckCircleFilled`, etc.) live in `components/ui/icons.tsx`. If you need a new one, add it there and import it.
- **No inline constants in `.tsx` files** for fixture data. Playground fixtures live in `lib/domain/chat/__fixtures__/playground.ts`. Scenario config lives in `config/playground.ts`.

## 6. Things that are explicitly forbidden

These are patterns that were tried and rejected. Reintroducing them reopens known problems:

- **Detached top-slot cards (`rounded-2xl border` plus a dock gap).** Top-slot panels are attached trays, not separate floating cards. Keep `ComposerAttachedPanel` on the `rounded-t-2xl border-x border-t` shell and keep the dock top-slot wrapper gapless.
- **Positive z-index on the top-slot wrapper.** The composer must paint after the attached tray so its top outline remains visible at the seam.
- **Ad hoc `first:*` stacking rounded-corner tricks.** The top slot currently has one inhabitant. When real stacking lands, update `useComposerTopSlot` and the dock together, not via a CSS trick alone.
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
- `claude-plan-short`, `claude-plan-long` — ProposedPlanCard in transcript
- `mobility-local-actionable`, `mobility-unpublished-branch`, `mobility-unpushed-commits`, `mobility-out-of-sync-branch`, `mobility-in-flight`, `mobility-failed` — composer footer row + mobility states

The playground is **dev-only**. It is lazy-loaded via `React.lazy()` gated on `import.meta.env.DEV` in `App.tsx`, so neither the page nor its fixtures land in production bundles.

When you change any composer-area component, **load the playground and verify every scenario still looks right** before opening a PR. The playground exists to catch drift — if it stops looking like the real app, either fix the real app or fix the playground (and add a regression scenario).

### Playground structure

Thin page → fat components, per the `pages/**` orchestration-only rule:

- `pages/ChatPlaygroundPage.tsx` — reads the scenario query param, renders layout, delegates
- `config/playground.ts` — `ScenarioKey`, `SCENARIOS`, `resolveScenarioKey`
- `lib/domain/chat/__fixtures__/playground.ts` — fixture data (`TODOS_*`, `CLAUDE_PLAN_*`, `*_OPTIONS`)
- `components/playground/PlaygroundScenarioBar.tsx` — top-bar scenario picker
- `components/playground/PlaygroundTranscript.tsx` — transcript area (renders `ProposedPlanCard` when applicable)
- `components/playground/PlaygroundComposer.tsx` — `ChatComposerDock` + scenario-driven top slot + read-only composer surface

Adding a new scenario: update `config/playground.ts` (add the key + label), optionally add fixture data in `__fixtures__/playground.ts`, then extend the switch in `PlaygroundComposer.renderTopSlot` and/or `PlaygroundTranscript`.
