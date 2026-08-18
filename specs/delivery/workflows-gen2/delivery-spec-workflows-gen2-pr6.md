# Delivery Spec — PR6 of workflows-gen2 — run view: graph pane, docs pane, controls, undo toast, resume popover

Parent ADR: Workflows ADR §UX flows (run view, journeys 2-4) + §core flows. Base: codex/workflows-gen2-pr5b-sdk-courier.
Branch: codex/workflows-gen2-pr6-run-view
Status: FROZEN before implementation.

## Scope

The run view per the ADR: "the existing workspace view plus a right rail with two panes", all behind
workflows_v2 (still OFF). PR6 adds ZERO data-layer code — it consumes PR5b hooks only.

1. New right-panel tool "workflow" (extend RightPanelTool union "scratch"|"git"|"agents" + branch in
   RightPanelContent + header entry key), visible only when isWorkflowsV2Enabled() AND the workspace has a
   workflow run (useWorkflowRunsQuery(workspaceId) non-empty). AgentsPane is the composition precedent
   (facade hook + pane component).
2. Graph pane: the chain top-to-bottom as node cards — state color via StatusDot tone adapter (follow
   components/workflows/workflow-run-status-dot.tsx pattern; node status → tone: pending=muted,
   running=current, needs_attention=warning, awaiting_human=info, completed=success, failed=danger),
   kind badges (replacement beside predecessor, adhoc rendered secondary off its anchor), chain_index prefix,
   needs-input badge when the linked session has a pending permission request (from existing session
   projections), click → focus that node's session (existing session-selection wiring).
3. Per-state controls on node cards, mapped 1:1 to the transition table (the authority; controls appear only
   when legal so a 409 is a race, not a UI bug):
   - awaiting_human: Approve (ApproveGate), Fail & redo, flip-to-agent toggle
   - running agent node: flip-to-human toggle
   - failed / needs_attention: Fail & redo (prompt editable, prefilled — inline editor in the card or small
     dialog composing existing primitives)
   - run interrupted: Resume button surfaces at the top of the pane
   - AddAdhocNode: an "add side node" affordance on each node card (anchor = that node) opening a small
     prompt dialog.
   All mutations via useWorkflowRunMutations; 409 WORKFLOW_TRANSITION_ILLEGAL surfaces as a toast (stale
   control raced the run), projection write-through refreshes the pane.
4. Docs pane: registry list from the projection (filename NN-slug.md, producing node title, updated-at),
   each row opening the REAL file: primary action opens in-app FileEditorView at workspace-relative path
   `.proliferate/context/<filename>` (binds to the real file on disk via the workspace files read/edit stack);
   secondary: OpenTargetMenu (existing) for external editors. NEVER a widget mock or inline recreation.
5. Undo toast: on every observed auto-advance (projection poll shows a NEW currentNodeRowId whose
   predecessor completed as an agent node — detect via projection diff in the facade hook), showToast
   "Node N done — starting N+1" with an Undo action → undoAdvance mutation. Toast dedupe per transition.
6. Resume popover: on app start when interrupted runs exist (useWorkflowRunsQuery() with no workspaceId,
   filtered to status=interrupted): run title (definition title from the snapshot), workspace, when
   interrupted, current node; actions Resume (resume mutation + navigate to the run workspace) and Dismiss
   (session-local dismissal, sessionStorage, per run id). Composes existing Popover/patterns primitives;
   mounted in the authenticated shell behind the flag.

## Non-goals
Builder, main page, templates, flag flip, intent specs (PR7). Any new data hooks (PR5b owns the data layer —
if PR6 needs a hook shape PR5b lacks, that is a journaled finding and the fix lands as a PR5b commit).

## Structure
- components/workspace/shell/right-panel: minimal union/branch edits.
- components/workflows/run-view/*.tsx — WorkflowPane, WorkflowGraphNodeCard, WorkflowDocsList,
  WorkflowResumePopover, etc. (feature-code surfaces; first-instance shapes stay in feature code per the
  rule of two; compose RosterRow/Card/StatusDot/Button/Popover/Dialog/ModalShell/showToast only).
- hooks/workflows/facade/use-workflow-pane.ts — the pane facade (projection query + mutations + advance-diff
  detection + toast firing + selection wiring).
- hooks/workflows/lifecycle/use-workflow-resume-popover.ts — startup interrupted-run detection + dismissal.
- copy in copy/workflows/.

## Tests
Vitest component tests per existing *.test.tsx conventions: node card renders per-status controls (one test
per transition-table row that has a control; negative control: completed node renders NO controls), docs row
invokes the file-open action with the exact workspace-relative path, undo toast fires exactly once per
advance diff, resume popover lists only interrupted runs and dismissal persists. Facade hook tests with fake
query data. UI-conformance checklist self-review + report_frontend_structure --strict + boundaries clean.

## Revert
Flag still OFF; plain revert of the PR.

## Acceptance proof
Scoped vitest + product-client typecheck green; structure/boundary gates green; checklist pass journaled.
