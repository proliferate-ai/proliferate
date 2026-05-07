import { resolveWorkspaceConnection } from "@/lib/access/anyharness/resolve-workspace-connection";
import {
  elapsedMs,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/measurement/debug-latency";
import { ensureRuntimeReady } from "@/hooks/workspaces/runtime-ready";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { cloudWorkspaceConnectionKey } from "@/hooks/access/cloud/query-keys";
import { getCloudWorkspaceConnection } from "@/lib/access/cloud/workspaces";
import type {
  ReadyCloudReadinessResult,
  WorkspaceConnectionResult,
  WorkspaceSelectionContext,
  WorkspaceSelectionDeps,
} from "./types";

export async function resolveSelectionConnection(
  deps: WorkspaceSelectionDeps,
  context: WorkspaceSelectionContext,
  cloudReadiness: ReadyCloudReadinessResult,
): Promise<WorkspaceConnectionResult> {
  const runtimeReadyStartedAt = startLatencyTimer();
  const desktopRuntimeUrl = cloudReadiness.kind === "local"
    ? await ensureRuntimeReady()
    : useHarnessConnectionStore.getState().runtimeUrl;
  logLatency("workspace.select.runtime_ready", {
    workspaceId: context.workspaceId,
    cloudWorkspaceId: context.cloudWorkspaceId,
    elapsedMs: elapsedMs(runtimeReadyStartedAt),
  });

  const connectionStartedAt = startLatencyTimer();
  const workspaceConnection = cloudReadiness.kind === "local"
    ? await resolveWorkspaceConnection(desktopRuntimeUrl, context.workspaceId)
    : await deps.queryClient.invalidateQueries({
      queryKey: cloudWorkspaceConnectionKey(cloudReadiness.cloudWorkspaceId),
      exact: true,
      refetchType: "none",
    }).then(async () => {
      const connection = await getCloudWorkspaceConnection(cloudReadiness.cloudWorkspaceId);
      deps.queryClient.setQueryData(
        cloudWorkspaceConnectionKey(cloudReadiness.cloudWorkspaceId),
        connection,
      );
      return {
        runtimeUrl: connection.runtimeUrl,
        authToken: connection.accessToken,
        anyharnessWorkspaceId: connection.anyharnessWorkspaceId ?? "",
      };
    });
  logLatency("workspace.select.connection_resolved", {
    workspaceId: context.workspaceId,
    anyharnessWorkspaceId: workspaceConnection.anyharnessWorkspaceId,
    elapsedMs: elapsedMs(connectionStartedAt),
  });

  return {
    runtimeUrl: desktopRuntimeUrl,
    workspaceConnection,
  };
}
