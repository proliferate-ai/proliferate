import { resolveWorkspaceConnection } from "@/lib/integrations/anyharness/resolve-workspace-connection";
import {
  elapsedMs,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/debug-latency";
import { ensureRuntimeReady } from "@/hooks/workspaces/runtime-ready";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { cloudWorkspaceConnectionKey } from "@/hooks/cloud/query-keys";
import { cloudWorkspaceConnectionQueryOptions } from "@/hooks/cloud/use-cloud-workspace-connection";
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
    : useHarnessStore.getState().runtimeUrl;
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
    }).then(() => deps.queryClient.fetchQuery(
      cloudWorkspaceConnectionQueryOptions(cloudReadiness.cloudWorkspaceId),
    )).then((connection) => ({
      runtimeUrl: connection.runtimeUrl,
      authToken: connection.accessToken,
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
  };
}
