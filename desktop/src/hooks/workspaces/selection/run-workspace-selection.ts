import { useHarnessStore } from "@/stores/sessions/harness-store";
import {
  markWorkspaceViewed,
  trackWorkspaceInteraction,
  useWorkspaceUiStore,
} from "@/stores/preferences/workspace-ui-store";
import { getLatestWorkspaceInteractionTimestamp } from "@/lib/domain/workspaces/selection";
import {
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/debug-latency";
import { cancelLatencyFlow } from "@/lib/infra/latency-flow";
import { resolveCloudWorkspaceReadiness } from "./cloud-readiness";
import { resolveSelectionConnection } from "./connection";
import { isWorkspaceSelectionCurrent } from "./guards";
import type {
  WorkspaceSelectionContext,
  WorkspaceSelectionDeps,
  WorkspaceSelectionRequest,
} from "./types";

export async function runWorkspaceSelection(
  deps: WorkspaceSelectionDeps,
  request: WorkspaceSelectionRequest,
): Promise<void> {
  const selectionStartedAt = startLatencyTimer();
  const currentId = useHarnessStore.getState().selectedWorkspaceId;
  if (currentId === request.workspaceId && !request.options?.force) {
    cancelLatencyFlow(request.options?.latencyFlowId, "workspace_already_selected");
    return;
  }

  logLatency("workspace.select.start", {
    workspaceId: request.workspaceId,
    force: !!request.options?.force,
    preservePending: !!request.options?.preservePending,
  });

  const cachedSessionId =
    useWorkspaceUiStore.getState().lastViewedSessionByWorkspace[request.workspaceId] ?? null;
  deps.setSelectedWorkspace(request.workspaceId, {
    clearPending: !request.options?.preservePending,
    initialActiveSessionId: cachedSessionId,
  });

  const baseContext: WorkspaceSelectionContext = {
    workspaceId: request.workspaceId,
    selectionNonce: useHarnessStore.getState().workspaceSelectionNonce,
    selectionStartedAt,
    cloudWorkspaceId: null,
  };

  const cloudReadiness = await resolveCloudWorkspaceReadiness(baseContext);
  if (
    cloudReadiness.kind === "stale"
  ) {
    cancelLatencyFlow(request.options?.latencyFlowId, "workspace_selection_stale");
    return;
  }
  if (
    cloudReadiness.kind === "cloud-missing"
    || cloudReadiness.kind === "cloud-pending"
  ) {
    cancelLatencyFlow(request.options?.latencyFlowId, cloudReadiness.kind, {
      cloudWorkspaceId: cloudReadiness.cloudWorkspaceId,
      status: cloudReadiness.kind === "cloud-pending" ? cloudReadiness.status : null,
    });
    return;
  }

  const context: WorkspaceSelectionContext = {
    ...baseContext,
    cloudWorkspaceId: cloudReadiness.kind === "cloud-ready"
      ? cloudReadiness.cloudWorkspaceId
      : null,
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
    workspaceId: context.workspaceId,
    runtimeUrl: connectionResult.runtimeUrl,
    workspaceConnection: connectionResult.workspaceConnection,
    startedAt: context.selectionStartedAt,
    latencyFlowId: request.options?.latencyFlowId,
    isCurrent: () => isWorkspaceSelectionCurrent(context.workspaceId, context.selectionNonce),
  });
  if (!isWorkspaceSelectionCurrent(context.workspaceId, context.selectionNonce)) {
    cancelLatencyFlow(request.options?.latencyFlowId, "workspace_selection_stale");
    return;
  }

  const latestSessionTimestamp = getLatestWorkspaceInteractionTimestamp(bootstrapResult.sessions);
  if (latestSessionTimestamp) {
    trackWorkspaceInteraction(context.workspaceId, latestSessionTimestamp);
  }
  markWorkspaceViewed(context.workspaceId);
}
