import { resolveWorkspaceConnection } from "#product/lib/access/anyharness/resolve-workspace-connection";
import {
  elapsedMs,
  logLatency,
  startLatencyTimer,
} from "#product/lib/infra/measurement/measurement-port";
import { ensureRuntimeReady } from "#product/hooks/workspaces/workflows/runtime-ready";
import { parseTargetWorkspaceSyntheticId } from "#product/lib/domain/compute/target-workspace-id";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import type {
  ReadyCloudReadinessResult,
  WorkspaceConnectionResult,
  WorkspaceSelectionContext,
  WorkspaceSelectionDeps,
} from "#product/hooks/workspaces/workflows/selection/types";

export async function resolveSelectionConnection(
  deps: WorkspaceSelectionDeps,
  context: WorkspaceSelectionContext,
  cloudReadiness: ReadyCloudReadinessResult,
): Promise<WorkspaceConnectionResult> {
  const runtimeReadyStartedAt = startLatencyTimer();
  const targetWorkspace = parseTargetWorkspaceSyntheticId(context.workspaceId);
  const localWorkspaceId = cloudReadiness.kind === "local"
    ? cloudReadiness.runtimeWorkspaceId ?? context.workspaceId
    : context.workspaceId;
  const desktopRuntimeUrl = cloudReadiness.kind === "local" && !targetWorkspace
    ? await ensureRuntimeReady(deps.localRuntime)
    : useHarnessConnectionStore.getState().runtimeUrl;
  logLatency("workspace.select.runtime_ready", {
    workspaceId: context.workspaceId,
    cloudWorkspaceId: context.cloudWorkspaceId,
    elapsedMs: elapsedMs(runtimeReadyStartedAt),
  });

  const connectionStartedAt = startLatencyTimer();
  const workspaceConnection = cloudReadiness.kind === "local"
    ? await resolveWorkspaceConnection(desktopRuntimeUrl, localWorkspaceId, deps.ssh ?? null, deps.cloudClient)
    : await deps.cache.refreshCloudWorkspaceConnection(cloudReadiness.cloudWorkspaceId)
      .then((connection) => ({
        runtimeUrl: connection.runtimeUrl,
        authToken: connection.accessToken ?? undefined,
        anyharnessWorkspaceId: connection.anyharnessWorkspaceId ?? "",
      }));
  logLatency("workspace.select.connection_resolved", {
    workspaceId: context.workspaceId,
    anyharnessWorkspaceId: workspaceConnection.anyharnessWorkspaceId,
    elapsedMs: elapsedMs(connectionStartedAt),
  });

  return {
    runtimeUrl: desktopRuntimeUrl,
    workspaceConnection,
    materializedWorkspaceId: cloudReadiness.kind === "local" ? localWorkspaceId : context.workspaceId,
  };
}
