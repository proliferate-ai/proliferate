import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import {
  createEmptySessionRecord,
  getSessionRecord,
  patchSessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { writeChatShellIntentForSession } from "#product/hooks/workspaces/workflows/tabs/workspace-shell-intent-writer";
import {
  selectPendingWorkspaceAttempt,
} from "#product/hooks/workspaces/workflows/pending-workspace-attempt-access";
import {
  findLogicalWorkspace,
  logicalWorkspaceRelatedIds,
} from "#product/lib/domain/workspaces/cloud/logical-workspace-lookup";
import { resolveLogicalWorkspaceMaterializationId } from "#product/lib/domain/workspaces/cloud/logical-workspace-materialization";
import {
  markWorkspaceViewed,
  markWorkspaceViewedAt,
  trackWorkspaceInteraction,
  useWorkspaceUiStore,
} from "#product/stores/preferences/workspace-ui-store";
import { getLatestWorkspaceInteractionTimestamp } from "#product/lib/domain/workspaces/selection/selection";
import {
  logLatency,
  startLatencyTimer,
} from "#product/lib/infra/measurement/measurement-port";
import { cancelLatencyFlow } from "#product/lib/infra/measurement/measurement-port";
import { resolveCloudWorkspaceReadiness } from "#product/hooks/workspaces/workflows/selection/cloud-readiness";
import { resolveSelectionConnection } from "#product/hooks/workspaces/workflows/selection/connection";
import { currentWorkspaceSelectionSignal, isWorkspaceSelectionCurrent } from "#product/hooks/workspaces/workflows/selection/guards";
import {
  prepareOptimisticWorkspaceSessionShell,
  resolveInitialActiveSessionId,
} from "#product/hooks/workspaces/workflows/selection/initial-session";
import type {
  WorkspaceSelectionContext,
  WorkspaceSelectionDeps,
  WorkspaceSelectionRequest,
} from "#product/hooks/workspaces/workflows/selection/types";

const INITIAL_SESSION_DEPS = {
  createEmptySessionRecord,
  getSessionRecord,
  logLatency,
  patchSessionRecord,
  putSessionRecord,
  writeChatShellIntentForSession,
};

export async function runWorkspaceSelection(
  deps: WorkspaceSelectionDeps,
  request: WorkspaceSelectionRequest,
): Promise<void> {
  if (selectPendingWorkspaceAttempt({
    workspaceId: request.workspaceId,
    force: request.options?.force,
    latencyFlowId: request.options?.latencyFlowId,
    initialActiveSessionId: request.options?.initialActiveSessionId,
  })) {
    return;
  }

  // UX Latency ADR §4.6, Rung 10 (Q12): warm the global agent catalog now, in parallel with the connection resolution
  // and the blocking session-directory fetch that follow. It has no data dependency on this workspace's connection,
  // so racing it off the critical path removes it as a serial contributor to switch latency. Fire-and-forget:
  // selection never awaits it (the composer submit gate awaits catalog readiness at send time), and it is global so a
  // superseded selection cannot paint wrong-workspace content from it.
  deps.prefetchAgentCatalog?.();

  const logicalWorkspace = findLogicalWorkspace(deps.logicalWorkspaces, request.workspaceId);
  if (!logicalWorkspace) {
    // A just-created workspace can be selected before the workspace-collections cache has projected it into
    // `logicalWorkspaces`/`rawWorkspaces` — the pending-composer flow selects it the instant AnyHarness returns it,
    // and on a fresh actor the collections query may not be populated yet. The creator threads the resolved workspace
    // through `options.knownWorkspace` so we can select it directly instead of hard-failing. The same hint restores
    // the last workspace on reopen. Both local and cowork workspaces resolve through the local runtime.
    const directWorkspace = deps.rawWorkspaces.find(
      (workspace) => workspace.id === request.workspaceId,
    ) ?? (
      request.options?.knownWorkspace?.id === request.workspaceId
        ? request.options.knownWorkspace
        : null
    );
    if (directWorkspace) {
      // A cowork workspace has no logical-workspace slot, so its logical selection is null (unchanged). A local
      // workspace does have one; persist its id as the selected logical workspace so a reload restores it (the
      // collections cache resolves `findLogicalWorkspace(..., workspace.id)` via `localWorkspace.id`). Persisting
      // null here would leave the shell empty after reopen.
      const directLogicalWorkspaceId = directWorkspace.surface === "cowork"
        ? null
        : directWorkspace.id;
      const selectionStartedAt = startLatencyTimer();
      const previousSelection = useSessionSelectionStore.getState();
      const currentId = previousSelection.selectedWorkspaceId;
      if (currentId === directWorkspace.id && !request.options?.force) {
        cancelLatencyFlow(request.options?.latencyFlowId, "workspace_already_selected");
        return;
      }

      logLatency("workspace.select.start", {
        workspaceId: directWorkspace.id,
        logicalWorkspaceId: directLogicalWorkspaceId,
        force: !!request.options?.force,
        preservePending: !!request.options?.preservePending,
      });

      const workspaceUiState = useWorkspaceUiStore.getState();
      const initialActiveSessionId = resolveInitialActiveSessionId({
        workspaceId: directWorkspace.id,
        workspaceUiKey: directWorkspace.id,
        workspaceUiKeys: [directWorkspace.id],
        options: request.options,
        workspaceUiState,
      }, INITIAL_SESSION_DEPS);
      deps.cache.cancelPreviousWorkspaceDisplayQueries({
        runtimeUrl: useHarnessConnectionStore.getState().runtimeUrl,
        previousWorkspaceIds: [
          previousSelection.selectedLogicalWorkspaceId,
          previousSelection.selectedWorkspaceId,
        ],
        nextWorkspaceIds: [directWorkspace.id],
      });
      deps.setSelectedLogicalWorkspaceId(directLogicalWorkspaceId);
      deps.setSelectedWorkspace(directWorkspace.id, { initialActiveSessionId });
      prepareOptimisticWorkspaceSessionShell({
        sessionId: initialActiveSessionId,
        workspaceId: directWorkspace.id,
        workspaceUiKey: directWorkspace.id,
      }, INITIAL_SESSION_DEPS);

      const context: WorkspaceSelectionContext = {
        workspaceId: directWorkspace.id,
        logicalWorkspaceId: directWorkspace.id,
        selectionNonce: useSessionSelectionStore.getState().workspaceSelectionNonce,
        selectionStartedAt,
        cloudWorkspaceId: null,
        abortSignal: currentWorkspaceSelectionSignal(),
      };
      if (!isWorkspaceSelectionCurrent(context.workspaceId, context.selectionNonce)) {
        cancelLatencyFlow(request.options?.latencyFlowId, "workspace_selection_stale");
        return;
      }

      const connectionResult = await resolveSelectionConnection(deps, context, { kind: "local" });
      if (!isWorkspaceSelectionCurrent(context.workspaceId, context.selectionNonce)) {
        cancelLatencyFlow(request.options?.latencyFlowId, "workspace_selection_stale");
        return;
      }

      const bootstrapResult = await deps.bootstrapWorkspace({
        workspaceId: connectionResult.materializedWorkspaceId ?? context.workspaceId,
        logicalWorkspaceId: context.logicalWorkspaceId,
        workspaceConnection: connectionResult.workspaceConnection,
        startedAt: context.selectionStartedAt,
        latencyFlowId: request.options?.latencyFlowId,
        forceSessionDirectoryRefresh: request.options?.forceSessionDirectoryRefresh,
        isCurrent: () => isWorkspaceSelectionCurrent(context.workspaceId, context.selectionNonce),
        signal: context.abortSignal,
      });
      if (!isWorkspaceSelectionCurrent(context.workspaceId, context.selectionNonce)) {
        cancelLatencyFlow(request.options?.latencyFlowId, "workspace_selection_stale");
        return;
      }

      const latestSessionTimestamp = getLatestWorkspaceInteractionTimestamp(bootstrapResult.sessions);
      if (latestSessionTimestamp) {
        trackWorkspaceInteraction(context.logicalWorkspaceId, latestSessionTimestamp);
        markWorkspaceViewedAt(context.logicalWorkspaceId, latestSessionTimestamp);
      } else {
        markWorkspaceViewed(context.logicalWorkspaceId);
      }
      return;
    }

    cancelLatencyFlow(request.options?.latencyFlowId, "workspace_not_found");
    throw new Error("Workspace not found.");
  }

  const resolvedWorkspaceId = resolveLogicalWorkspaceMaterializationId(
    logicalWorkspace,
    request.workspaceId,
  );
  if (!resolvedWorkspaceId) {
    cancelLatencyFlow(request.options?.latencyFlowId, "workspace_not_materialized");
    throw new Error("Workspace is not materialized yet.");
  }
  const selectionStartedAt = startLatencyTimer();
  const previousSelection = useSessionSelectionStore.getState();
  const currentId = previousSelection.selectedWorkspaceId;
  if (currentId === resolvedWorkspaceId && !request.options?.force) {
    cancelLatencyFlow(request.options?.latencyFlowId, "workspace_already_selected");
    return;
  }

  logLatency("workspace.select.start", {
    workspaceId: resolvedWorkspaceId,
    logicalWorkspaceId: logicalWorkspace.id,
    force: !!request.options?.force,
    preservePending: !!request.options?.preservePending,
  });

  const workspaceUiState = useWorkspaceUiStore.getState();
  const initialActiveSessionId = resolveInitialActiveSessionId({
    workspaceId: resolvedWorkspaceId,
    workspaceUiKey: logicalWorkspace.id,
    workspaceUiKeys: logicalWorkspaceRelatedIds(logicalWorkspace),
    options: request.options,
    workspaceUiState,
  }, INITIAL_SESSION_DEPS);
  deps.cache.cancelPreviousWorkspaceDisplayQueries({
    runtimeUrl: useHarnessConnectionStore.getState().runtimeUrl,
    previousWorkspaceIds: [
      previousSelection.selectedLogicalWorkspaceId,
      previousSelection.selectedWorkspaceId,
    ],
    nextWorkspaceIds: [logicalWorkspace.id, resolvedWorkspaceId],
  });
  deps.setSelectedLogicalWorkspaceId(logicalWorkspace.id);
  deps.setSelectedWorkspace(resolvedWorkspaceId, { initialActiveSessionId });
  prepareOptimisticWorkspaceSessionShell({
    sessionId: initialActiveSessionId,
    workspaceId: resolvedWorkspaceId,
    workspaceUiKey: logicalWorkspace.id,
  }, INITIAL_SESSION_DEPS);

  const baseContext: WorkspaceSelectionContext = {
    workspaceId: resolvedWorkspaceId,
    logicalWorkspaceId: logicalWorkspace.id,
    selectionNonce: useSessionSelectionStore.getState().workspaceSelectionNonce,
    selectionStartedAt,
    cloudWorkspaceId: null,
    abortSignal: currentWorkspaceSelectionSignal(),
  };

  const cloudReadiness = await resolveCloudWorkspaceReadiness(baseContext);
  if (
    cloudReadiness.kind === "stale"
  ) {
    cancelLatencyFlow(request.options?.latencyFlowId, "workspace_selection_stale");
    return;
  }
  if (cloudReadiness.kind === "cloud-missing") {
    cancelLatencyFlow(request.options?.latencyFlowId, cloudReadiness.kind, {
      cloudWorkspaceId: cloudReadiness.cloudWorkspaceId,
      status: null,
    });
    return;
  }

  const context: WorkspaceSelectionContext = {
    ...baseContext,
    cloudWorkspaceId: null,
  };
  if (!isWorkspaceSelectionCurrent(context.workspaceId, context.selectionNonce)) {
    cancelLatencyFlow(request.options?.latencyFlowId, "workspace_selection_stale");
    return;
  }

  const connectionResult = await resolveSelectionConnection(deps, context, cloudReadiness);
  if (!isWorkspaceSelectionCurrent(context.workspaceId, context.selectionNonce)) {
    cancelLatencyFlow(request.options?.latencyFlowId, "workspace_selection_stale");
    return;
  }

  const bootstrapResult = await deps.bootstrapWorkspace({
    workspaceId: connectionResult.materializedWorkspaceId ?? context.workspaceId,
    logicalWorkspaceId: context.logicalWorkspaceId,
    workspaceConnection: connectionResult.workspaceConnection,
    startedAt: context.selectionStartedAt,
    latencyFlowId: request.options?.latencyFlowId,
    forceSessionDirectoryRefresh: request.options?.forceSessionDirectoryRefresh,
    isCurrent: () => isWorkspaceSelectionCurrent(context.workspaceId, context.selectionNonce),
    signal: context.abortSignal,
  });
  if (!isWorkspaceSelectionCurrent(context.workspaceId, context.selectionNonce)) {
    cancelLatencyFlow(request.options?.latencyFlowId, "workspace_selection_stale");
    return;
  }

  const latestSessionTimestamp = getLatestWorkspaceInteractionTimestamp(bootstrapResult.sessions);
  if (latestSessionTimestamp) {
    trackWorkspaceInteraction(context.logicalWorkspaceId, latestSessionTimestamp);
    markWorkspaceViewedAt(context.logicalWorkspaceId, latestSessionTimestamp);
  } else {
    markWorkspaceViewed(context.logicalWorkspaceId);
  }
}
