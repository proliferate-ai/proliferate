import { useMemo } from "react";
import type { WorkflowRunV2 } from "@anyharness/sdk";
import { Button } from "#product/primitives/Button";
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
 * anchored to the bottom-right corner.
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
        <span aria-hidden="true" className="fixed bottom-4 right-4 h-px w-px" />
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="end"
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
    // Recorded exclusion (DESIGN_SYSTEM.md UI-conformance review, check 7) —
    // second instance of the shape `PromptRecoveryPanel` already carries for
    // the same documented reason: `RosterRow` ties its hover wash to
    // `onSelect`, but this row is never selectable (its two actions ARE the
    // row) and still wants the hover wash, and its secondary line has no tone
    // axis to spare for a two-line workspace+time caption. Flag for
    // promotion into `RosterRow` alongside `PromptRecoveryPanel`'s row rather
    // than re-deriving a third bespoke instance.
    <div className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-hover">
      <div className="min-w-0 flex-1">
        <div className="truncate text-ui font-medium text-foreground">{title}</div>
        <div className="truncate text-ui-sm text-muted-foreground">{secondary}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-ui-sm"
          onClick={onDismiss}
        >
          {WORKFLOW_RESUME_COPY.dismissLabel}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          className="h-7 px-2.5 text-ui-sm"
          onClick={onResume}
        >
          {WORKFLOW_RESUME_COPY.resumeLabel}
        </Button>
      </div>
    </div>
  );
}
