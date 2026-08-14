import { useCallback, useEffect, useMemo, useRef } from "react";
import { AnyHarnessError } from "@anyharness/sdk";
import type {
  WorkflowNodeTypeV2,
  WorkflowRunDocV2,
  WorkflowRunNodeV2,
  WorkflowRunProjectionV2,
  WorkflowRunV2,
} from "@anyharness/sdk";
import {
  useWorkflowRunMutations,
  useWorkflowRunQuery,
  useWorkflowRunsQuery,
} from "@anyharness/sdk-react";
import { WORKFLOW_RUN_VIEW_COPY } from "#product/copy/workflows/workflow-run-view-copy";
import {
  buildWorkflowGraph,
  detectWorkflowAutoAdvance,
  type WorkflowGraphSlotVM,
} from "#product/domain/workflows/run-view-model";
import { useWorkspaceSidebarActivityStates } from "#product/hooks/workspaces/derived/use-workspace-sidebar-activities";
import { useWorkspaceActivationWorkflow } from "#product/hooks/workspaces/workflows/use-workspace-activation-workflow";
import { showToast, toastError } from "#product/primitives/utils/show-toast";

export type WorkflowPaneStatus = "loading" | "empty" | "ready" | "error";

export interface WorkflowPaneActions {
  approve: (nodeRowId: string) => void;
  failRedo: (nodeRowId: string, prompt?: string) => void;
  flipType: (nodeRowId: string, nodeType: WorkflowNodeTypeV2) => void;
  undoAdvance: () => void;
  resume: () => void;
  addAdhocNode: (anchorNodeRowId: string, prompt: string) => void;
  focusNodeSession: (nodeRowId: string) => void;
}

export interface WorkflowPaneModel {
  status: WorkflowPaneStatus;
  run: WorkflowRunV2 | null;
  slots: WorkflowGraphSlotVM[];
  docs: WorkflowRunDocV2[];
  nodesById: ReadonlyMap<string, WorkflowRunNodeV2>;
  interrupted: boolean;
  /** Any node/lifecycle command is in flight; every control disables together. */
  busy: boolean;
  /**
   * Node rows whose session is waiting on the user. The join is by row id
   * rather than session id because the card takes `needsInput` beside its VM
   * (the domain VM is the frozen contract and gains no presentation field).
   */
  needsInputNodeRowIds: ReadonlySet<string>;
  actions: WorkflowPaneActions;
}

const NO_SLOTS: WorkflowGraphSlotVM[] = [];
const NO_DOCS: WorkflowRunDocV2[] = [];
const NO_NODES: ReadonlyMap<string, WorkflowRunNodeV2> = new Map();
const NO_NEEDS_INPUT: ReadonlySet<string> = new Set();

/**
 * The workspace's run for this pane: the newest one it has. Runs are keyed by
 * `createdAt`, and an exact tie falls back to the row id so two runs minted in
 * the same millisecond still resolve to one deterministic winner rather than
 * flickering between polls.
 */
export function selectNewestWorkflowRun(
  runs: readonly WorkflowRunV2[] | undefined,
): WorkflowRunV2 | null {
  let newest: WorkflowRunV2 | null = null;
  for (const candidate of runs ?? []) {
    if (
      !newest
      || candidate.createdAt > newest.createdAt
      || (candidate.createdAt === newest.createdAt && candidate.id > newest.id)
    ) {
      newest = candidate;
    }
  }
  return newest;
}

/**
 * Whether a rejected command lost a race with the run rather than failing.
 *
 * The runtime answers an illegal transition with `WORKFLOW_TRANSITION_ILLEGAL`
 * (HTTP 409). Because `workflowNodeControls` renders a control only where the
 * transition table has a row for it, that answer never means the UI offered
 * something impossible — it means the run moved between the render and the
 * click. Matched on the stable problem code, not the status: the code is the
 * contract and the status is the transport's rendering of it.
 */
export function isWorkflowTransitionRace(error: unknown): boolean {
  return (
    error instanceof AnyHarnessError
    && error.problem.code === "WORKFLOW_TRANSITION_ILLEGAL"
  );
}

function describeCause(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : undefined;
}

export function useWorkflowPane({ workspaceId }: { workspaceId: string }): WorkflowPaneModel {
  const runsQuery = useWorkflowRunsQuery(workspaceId);
  const run = useMemo(
    () => selectNewestWorkflowRun(runsQuery.data?.runs),
    [runsQuery.data],
  );
  const runId = run?.id ?? "";
  const runQuery = useWorkflowRunQuery(runId, { enabled: runId.length > 0 });
  const mutations = useWorkflowRunMutations(runId);
  const { openWorkspaceSession } = useWorkspaceActivationWorkflow();
  // The same signal the session roster badges with: a directory-derived
  // activity state per session id, where `waiting_input` is "this session is
  // waiting on the user". Reused whole rather than probed again here.
  const sessionActivityStates = useWorkspaceSidebarActivityStates();

  // No run means no projection, whatever the disabled query still holds: a
  // pane that has nothing to show must not render the last run it saw.
  const projection = runId ? runQuery.data : undefined;
  // The list picks *which* run; the projection is the fresher copy of it. Only
  // the detail query polls, so a run that parks while the pane is open changes
  // status here and nowhere else.
  const currentRun = projection?.run ?? run;
  const slots = useMemo(
    () => (projection ? buildWorkflowGraph(projection) : NO_SLOTS),
    [projection],
  );
  const nodesById = useMemo(() => {
    if (!projection) {
      return NO_NODES;
    }
    return new Map(projection.nodes.map((node) => [node.id, node]));
  }, [projection]);
  const needsInputNodeRowIds = useMemo(() => {
    if (!projection) {
      return NO_NEEDS_INPUT;
    }
    const rowIds = new Set<string>();
    for (const node of projection.nodes) {
      if (node.sessionId && sessionActivityStates[node.sessionId] === "waiting_input") {
        rowIds.add(node.id);
      }
    }
    return rowIds;
  }, [projection, sessionActivityStates]);

  const runCommand = useCallback(async (command: () => Promise<unknown>) => {
    try {
      await command();
    } catch (error) {
      if (isWorkflowTransitionRace(error)) {
        // The control raced the run: say so, refresh, and never let the
        // rejection reach the component that rendered the control.
        showToast({
          id: `workflow-run-race:${runId}`,
          weight: "announcement",
          tone: "warning",
          badge: WORKFLOW_RUN_VIEW_COPY.toastBadge,
          title: WORKFLOW_RUN_VIEW_COPY.raceTitle,
          description: WORKFLOW_RUN_VIEW_COPY.raceDescription,
        });
        void runQuery.refetch();
        return;
      }
      toastError({
        headline: WORKFLOW_RUN_VIEW_COPY.commandFailedHeadline,
        consequence: WORKFLOW_RUN_VIEW_COPY.commandFailedConsequence,
        cause: describeCause(error),
      });
    }
  }, [runId, runQuery]);

  const focusNodeSession = useCallback((nodeRowId: string) => {
    const sessionId = nodesById.get(nodeRowId)?.sessionId;
    if (!sessionId) {
      // A node that has not started yet owns no session; there is nothing to
      // focus, and minting one here would start work the user did not ask for.
      return;
    }
    void openWorkspaceSession({
      workspaceId,
      sessionId,
      forceWorkspaceSelection: false,
    });
  }, [nodesById, openWorkspaceSession, workspaceId]);

  const actions = useMemo<WorkflowPaneActions>(() => ({
    approve: (nodeRowId) => {
      void runCommand(() => mutations.approve.mutateAsync({ nodeRowId }));
    },
    failRedo: (nodeRowId, prompt) => {
      void runCommand(() => mutations.failRedo.mutateAsync({
        nodeRowId,
        request: prompt === undefined ? {} : { prompt },
      }));
    },
    flipType: (nodeRowId, nodeType) => {
      void runCommand(() => mutations.flipType.mutateAsync({
        nodeRowId,
        request: { nodeType },
      }));
    },
    undoAdvance: () => {
      void runCommand(() => mutations.undoAdvance.mutateAsync(undefined));
    },
    resume: () => {
      void runCommand(() => mutations.resume.mutateAsync(undefined));
    },
    addAdhocNode: (anchorNodeRowId, prompt) => {
      void runCommand(() => mutations.addAdhocNode.mutateAsync({
        request: { anchorNodeRowId, prompt },
      }));
    },
    focusNodeSession,
  }), [focusNodeSession, mutations, runCommand]);

  useWorkflowAutoAdvanceToast({
    projection,
    runId,
    onUndo: actions.undoAdvance,
  });

  return {
    status: resolveWorkflowPaneStatus({
      runsLoaded: runsQuery.data !== undefined,
      runsFailed: runsQuery.isError,
      hasRun: run !== null,
      projectionLoaded: projection !== undefined,
      projectionFailed: runQuery.isError,
    }),
    run: currentRun,
    slots,
    docs: projection?.docs ?? NO_DOCS,
    nodesById,
    interrupted: currentRun?.status === "interrupted",
    busy: mutations.approve.isPending
      || mutations.failRedo.isPending
      || mutations.flipType.isPending
      || mutations.undoAdvance.isPending
      || mutations.resume.isPending
      || mutations.addAdhocNode.isPending,
    needsInputNodeRowIds,
    actions,
  };
}

/**
 * What the pane shows, from the two queries behind it. An error only wins
 * where there is nothing to render instead: a poll that fails while a
 * projection is already on screen leaves the run standing rather than
 * replacing it with a failure.
 */
export function resolveWorkflowPaneStatus(input: {
  runsLoaded: boolean;
  runsFailed: boolean;
  hasRun: boolean;
  projectionLoaded: boolean;
  projectionFailed: boolean;
}): WorkflowPaneStatus {
  if (!input.runsLoaded) {
    return input.runsFailed ? "error" : "loading";
  }
  if (!input.hasRun) {
    return "empty";
  }
  if (!input.projectionLoaded) {
    return input.projectionFailed ? "error" : "loading";
  }
  return "ready";
}

/**
 * Raises the undo offer when the run advanced on its own.
 *
 * Fires at most once per started node (a poll re-delivering the same
 * projection must not re-offer an undo the user already dismissed), and it
 * carries one id per run so a second advance replaces the stale offer rather
 * than stacking beside it — only the latest advance is undoable anyway.
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
  const announcedStartedNodeIdsRef = useRef<Set<string>>(new Set());
  // The toast outlives the render that raised it, so its action reads the
  // latest callback instead of pinning the one that was current at raise time.
  const undoRef = useRef(onUndo);
  undoRef.current = onUndo;

  useEffect(() => {
    previousProjectionRef.current = undefined;
    announcedStartedNodeIdsRef.current = new Set();
  }, [runId]);

  useEffect(() => {
    if (!projection) {
      return;
    }
    const previous = previousProjectionRef.current;
    previousProjectionRef.current = projection;
    const advance = detectWorkflowAutoAdvance(previous, projection);
    if (!advance || announcedStartedNodeIdsRef.current.has(advance.startedNode.id)) {
      return;
    }
    announcedStartedNodeIdsRef.current.add(advance.startedNode.id);
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
