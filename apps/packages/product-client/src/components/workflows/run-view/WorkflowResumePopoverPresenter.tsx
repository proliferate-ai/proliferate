import { useMemo } from "react";
import type { WorkflowRunV2 } from "@anyharness/sdk";
import { Button } from "#product/primitives/Button";
import { ActionRow } from "#product/primitives/patterns/ActionRow";
import { Popover, PopoverAnchor, PopoverContent } from "#product/primitives/Popover";
import { WORKFLOW_RESUME_COPY } from "#product/copy/workflows/workflow-resume-copy";
import { useWorkflowResumePopover } from "#product/hooks/workflows/lifecycle/use-workflow-resume-popover";
import { useLogicalWorkspaces } from "#product/hooks/workspaces/derived/use-logical-workspaces";
import { findLogicalWorkspace } from "#product/lib/domain/workspaces/cloud/logical-workspace-lookup";
import { formatRelativeTime } from "#product/lib/domain/workspaces/display/workspace-display";

/**
 * `WorkflowRunV2.definitionJson` is the frozen invocation JSON
 * (`WorkflowInvocationJsonV2` in `@anyharness/sdk`), and that frozen contract
 * carries no `title` field today — only `workflowDefinitionId`, `definition`
 * (nodes/edges/inputs/docTemplates), `arguments`, and `placement`. This parse
 * is defensive against the contract growing one (top-level or nested under
 * `definition`) rather than a confirmed field: until it does, every row falls
 * back to `WORKFLOW_RESUME_COPY.fallbackRunTitle`. Reported as a contradiction
 * in the PR6 lane-C report rather than resolved by inventing a title source.
 */
function parseWorkflowRunDefinitionTitle(definitionJson: string): string {
  try {
    const parsed = JSON.parse(definitionJson) as {
      title?: unknown;
      definition?: { title?: unknown };
    };
    const candidate = parsed?.title ?? parsed?.definition?.title;
    return typeof candidate === "string" && candidate.trim().length > 0
      ? candidate.trim()
      : WORKFLOW_RESUME_COPY.fallbackRunTitle;
  } catch {
    return WORKFLOW_RESUME_COPY.fallbackRunTitle;
  }
}

/**
 * Mounted globally (beside `HarnessUpdateToastPresenter` in
 * `AuthenticatedProductClient.tsx`): surfaces every interrupted workflow run
 * this runtime knows about, across every workspace, as a floating card
 * anchored to the bottom-left corner.
 *
 * Left, not right, and not a preference: the `Toaster` is pinned
 * `position="bottom-right"` (`Sonner.tsx`), and this feature raises its own
 * toasts there — the resume-failed report, and the run view's undo offer. A
 * nudge card in that corner covers the very message that explains why the nudge
 * is still on screen. Opposite corners is the only arrangement where both can be
 * read at once.
 *
 * Composes the real `Popover` primitive against a fixed, invisible virtual
 * anchor rather than a visible trigger — there is no click that opens this;
 * it appears on its own when `interruptedRuns` is non-empty. `onOpenChange`
 * is a deliberate no-op: like the update-ready toast ("closing a toast is an
 * answer, so it has to stick"), this card stays up across Escape/outside
 * click and closes only through an explicit per-row Resume or Dismiss.
 */
// A nudge surface, not a browsing one: past this many rows the remainder
// collapses into the hint line below the list.
const MAX_VISIBLE_ROWS = 6;

export function WorkflowResumePopoverPresenter() {
  const { interruptedRuns, dismiss, resumeAndOpen } = useWorkflowResumePopover();
  const { logicalWorkspaces } = useLogicalWorkspaces();

  // A corner popover is a nudge, not a browsing surface: it renders a bounded
  // set of the freshest interrupted runs, and resolving (resuming or
  // dismissing) one reveals the next. The bound is what keeps this surface
  // out of long-list territory; the run view remains the place to browse.
  const visible = useMemo(
    () =>
      [...interruptedRuns]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, MAX_VISIBLE_ROWS),
    [interruptedRuns],
  );
  const hiddenCount = interruptedRuns.length - visible.length;

  if (interruptedRuns.length === 0) {
    return null;
  }

  return (
    <Popover open onOpenChange={() => {}}>
      <PopoverAnchor asChild>
        <span aria-hidden="true" className="fixed bottom-4 left-4 h-px w-px" />
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="start"
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="flex w-80 flex-col p-0"
      >
        <div className="border-b border-border-light px-3 py-2.5 text-ui font-medium text-foreground">
          {WORKFLOW_RESUME_COPY.title}
        </div>
        <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto p-1.5">
          {visible.map((run) => (
            <InterruptedRunRow
              key={run.id}
              run={run}
              // Cheaply available: `useLogicalWorkspaces` is already-fetched,
              // already-cached data the sidebar keeps warm globally — this
              // reads it, it does not fetch it. Omitted (per row) when the
              // run's workspace id does not resolve to a known logical
              // workspace, e.g. one only the runtime, not this client's
              // workspace list, currently knows about.
              workspaceName={findLogicalWorkspace(logicalWorkspaces, run.workspaceId)?.displayName ?? null}
              onResume={() => resumeAndOpen(run.id)}
              onDismiss={() => dismiss(run.id)}
            />
          ))}
        </div>
        {hiddenCount > 0 ? (
          <p className="border-t border-border-light px-3 py-2 text-ui-sm text-muted-foreground">
            {WORKFLOW_RESUME_COPY.moreRunsHint(hiddenCount)}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function InterruptedRunRow({
  run,
  workspaceName,
  onResume,
  onDismiss,
}: {
  run: WorkflowRunV2;
  workspaceName: string | null;
  onResume: () => void;
  onDismiss: () => void;
}) {
  const title = useMemo(
    () => parseWorkflowRunDefinitionTitle(run.definitionJson),
    [run.definitionJson],
  );
  const interruptedLabel = `Interrupted ${formatRelativeTime(run.updatedAt)}`;
  const secondary = workspaceName ? `${workspaceName} · ${interruptedLabel}` : interruptedLabel;

  return (
    // `ActionRow`, the pattern this row and `PromptRecoveryPanel`'s unsent-message
    // row were both promoted into (rule of two): a row that is never selectable
    // — its two controls ARE the row — and still carries the hover wash, which is
    // the pair of things `RosterRow` cannot do. Buttons stay at their sanctioned
    // `sm` geometry with no height override: a seventh height on the scale needs a
    // recorded cause, and "slightly denser popover" is not one.
    <ActionRow
      title={title}
      secondary={secondary}
      actions={
        <>
          <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
            {WORKFLOW_RESUME_COPY.dismissLabel}
          </Button>
          <Button type="button" variant="primary" size="sm" onClick={onResume}>
            {WORKFLOW_RESUME_COPY.resumeLabel}
          </Button>
        </>
      }
    />
  );
}
