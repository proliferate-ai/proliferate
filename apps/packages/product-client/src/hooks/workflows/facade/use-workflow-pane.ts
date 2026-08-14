import { useCallback, useMemo } from "react";
import type {
  WorkflowNodeTypeV2,
  WorkflowRunDocV2,
  WorkflowRunNodeV2,
  WorkflowRunV2,
} from "@anyharness/sdk";
import {
  useWorkflowRunMutations,
  useWorkflowRunQuery,
  useWorkflowRunsQuery,
} from "@anyharness/sdk-react";
import { selectNewestWorkflowRun } from "#product/domain/workflows/run-selection";
import {
  buildWorkflowGraph,
  type WorkflowGraphSlotVM,
} from "#product/domain/workflows/run-view-model";
import { useWorkflowRunCommand } from "#product/hooks/workflows/workflows/use-workflow-run-command";
import { useWorkspaceSidebarActivityStates } from "#product/hooks/workspaces/derived/use-workspace-sidebar-activities";
import { useWorkspaceActivationWorkflow } from "#product/hooks/workspaces/workflows/use-workspace-activation-workflow";

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

export function useWorkflowPane({ workspaceId }: { workspaceId: string }): WorkflowPaneModel {
  // The roster decides which run this pane shows and whether the workflow tool
  // is offered at all, so it has to notice a run triggered from anywhere else:
  // watched, not read once.
  const runsQuery = useWorkflowRunsQuery(workspaceId, { watchActiveRuns: true });
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

  const runCommand = useWorkflowRunCommand({ runId, refetchRun: runQuery.refetch });

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

  // The auto-advance undo offer is deliberately not raised here: it has to
  // survive a collapsed panel and a switch to another tool, so it is watched
  // above the tool switch (`useWorkflowAutoAdvanceWatch`).
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
