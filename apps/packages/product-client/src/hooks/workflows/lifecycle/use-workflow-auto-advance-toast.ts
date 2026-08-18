import { useCallback, useEffect, useMemo, useRef } from "react";
import type { WorkflowRunNodeV2, WorkflowRunProjectionV2 } from "@anyharness/sdk";
import {
  useWorkflowRunMutations,
  useWorkflowRunQuery,
  useWorkflowRunsQuery,
} from "@anyharness/sdk-react";
import { WORKFLOW_RUN_VIEW_COPY } from "#product/copy/workflows/workflow-run-view-copy";
import { selectNewestWorkflowRun } from "#product/domain/workflows/run-selection";
import { detectWorkflowAutoAdvance } from "#product/domain/workflows/run-view-model";
import { useWorkflowNodeSessionRoster } from "#product/hooks/workflows/lifecycle/use-workflow-node-session-roster";
import { useWorkflowRunCommand } from "#product/hooks/workflows/workflows/use-workflow-run-command";
import { isWorkflowsV2Enabled } from "#product/lib/domain/capabilities/workflows-v2";
import { showToast } from "#product/primitives/utils/show-toast";

/**
 * The announcement key for one auto-advance: the started row plus the instant
 * it started.
 *
 * Not the bare row id. `UndoAdvance` returns the started row to pending with
 * `started_at = NULL` (the runtime store's own update), so a genuine second
 * advance into that same row — after an undo and a fail-and-redo of the step
 * before it — carries a fresh `startedAt` and reads as a new announcement,
 * while a poll re-delivering the advance already announced does not.
 */
export function workflowAutoAdvanceAnnouncementKey(startedNode: WorkflowRunNodeV2): string {
  return `${startedNode.id}@${startedNode.startedAt ?? "unstarted"}`;
}

/**
 * Watches the workspace's run for auto-advances and raises the undo offer,
 * independent of the right panel.
 *
 * Mounted by the right-panel controller — the one place that exists for as
 * long as the workspace shell does, whatever tool the panel shows and whether
 * it is open or collapsed. The ADR's contract is "the undo toast appears on
 * every auto-advance", and an offer that only appears while the workflow pane
 * happens to be the visible tool would pass silently in exactly the cases the
 * user most needs it. Both queries are the same hooks (and so the same cache
 * entries) the pane uses, so mounting this beside a live pane costs no extra
 * fetch.
 */
export function useWorkflowAutoAdvanceWatch({
  workspaceId,
  enabled,
}: {
  workspaceId: string | null;
  enabled: boolean;
}): void {
  // Owns its own launch gate rather than trusting the caller's, the same way
  // the resume popover does: a gated-off build asks the runtime nothing.
  const watching = enabled && isWorkflowsV2Enabled() && Boolean(workspaceId);
  const runsQuery = useWorkflowRunsQuery(workspaceId, {
    enabled: watching,
    watchActiveRuns: true,
  });
  const run = useMemo(
    () => selectNewestWorkflowRun(runsQuery.data?.runs),
    [runsQuery.data],
  );
  const runId = run?.id ?? "";
  const runQuery = useWorkflowRunQuery(runId, { enabled: watching && runId.length > 0 });
  const mutations = useWorkflowRunMutations(runId);
  const runCommand = useWorkflowRunCommand({ runId, refetchRun: runQuery.refetch });
  const undoAdvance = useCallback(() => {
    void runCommand(() => mutations.undoAdvance.mutateAsync(undefined));
  }, [mutations, runCommand]);

  // Whatever the disabled query still holds is not this workspace's run.
  const projection = watching && runId ? runQuery.data : undefined;

  useWorkflowAutoAdvanceToast({
    projection,
    runId,
    onUndo: undoAdvance,
  });
  // Same reason this watcher is panel-independent: the node the run advanced
  // into has to reach the workspace's tab strip whether or not the workflow
  // pane is the visible tool.
  useWorkflowNodeSessionRoster({
    workspaceId: watching ? workspaceId : null,
    projection,
  });
}

/**
 * Raises the undo offer when the run advanced on its own.
 *
 * Fires at most once per advance (a poll re-delivering the same projection
 * must not re-offer an undo the user already dismissed), and it carries one id
 * per run so a second advance replaces the stale offer rather than stacking
 * beside it — only the latest advance is undoable anyway.
 */
function useWorkflowAutoAdvanceToast({
  projection,
  runId,
  onUndo,
}: {
  projection: WorkflowRunProjectionV2 | undefined;
  runId: string;
  onUndo: () => void;
}): void {
  const previousProjectionRef = useRef<WorkflowRunProjectionV2 | undefined>(undefined);
  const announcedAdvanceKeysRef = useRef<Set<string>>(new Set());
  // The toast outlives the render that raised it, so its action reads the
  // latest callback instead of pinning the one that was current at raise time.
  const undoRef = useRef(onUndo);
  undoRef.current = onUndo;

  useEffect(() => {
    previousProjectionRef.current = undefined;
    announcedAdvanceKeysRef.current = new Set();
  }, [runId]);

  useEffect(() => {
    if (!projection) {
      return;
    }
    const previous = previousProjectionRef.current;
    previousProjectionRef.current = projection;
    const advance = detectWorkflowAutoAdvance(previous, projection);
    if (!advance) {
      return;
    }
    const announcementKey = workflowAutoAdvanceAnnouncementKey(advance.startedNode);
    if (announcedAdvanceKeysRef.current.has(announcementKey)) {
      return;
    }
    announcedAdvanceKeysRef.current.add(announcementKey);
    showToast({
      id: `workflow-auto-advance:${projection.run.id}`,
      weight: "announcement",
      tone: "info",
      badge: WORKFLOW_RUN_VIEW_COPY.toastBadge,
      title: WORKFLOW_RUN_VIEW_COPY.autoAdvanceTitle(
        WORKFLOW_RUN_VIEW_COPY.nodeLabel(advance.completedNode),
        WORKFLOW_RUN_VIEW_COPY.nodeLabel(advance.startedNode),
      ),
      description: WORKFLOW_RUN_VIEW_COPY.autoAdvanceDescription,
      commit: {
        label: WORKFLOW_RUN_VIEW_COPY.undoLabel,
        onClick: () => undoRef.current(),
      },
    });
  }, [projection]);
}
