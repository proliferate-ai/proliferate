import type { QueryClient } from "@tanstack/react-query";
import { anyHarnessWorkspaceSetupStatusKey } from "@anyharness/sdk-react";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import { trackProductEvent } from "@/lib/integrations/telemetry/client";
import { useHarnessStore } from "@/stores/sessions/harness-store";

export function isWorkspaceSetupActive(
  queryClient: QueryClient,
  runtimeUrl: string,
  workspaceId: string | null,
): boolean {
  if (!workspaceId) return false;
  const arrival = useHarnessStore.getState().workspaceArrivalEvent;
  if (!arrival || arrival.workspaceId !== workspaceId) return false;

  const cachedStatus = queryClient.getQueryData<{ status?: string }>(
    anyHarnessWorkspaceSetupStatusKey(runtimeUrl, workspaceId),
  );
  const status = cachedStatus?.status ?? arrival.setupScript?.status ?? null;
  // For async-setup sources the creation endpoint returns setupScript: null
  // and setup runs in the background. Treat a cache miss (no poll result yet)
  // as potentially active so the panel isn't prematurely dismissed before the
  // first setup-status poll returns.
  const isAsyncSetupSource =
    arrival.source === "worktree-created" || arrival.source === "local-created";
  if (isAsyncSetupSource && status === null) return true;
  return status === "running" || status === "queued";
}

export function completeChatPromptSubmitSideEffects({
  queryClient,
  runtimeUrl,
  workspaceId,
  agentKind,
  reuseSession,
  setWorkspaceArrivalEvent,
}: {
  queryClient: QueryClient;
  runtimeUrl: string;
  workspaceId: string;
  agentKind: string;
  reuseSession: boolean;
  setWorkspaceArrivalEvent: (event: null) => void;
}): void {
  if (!isWorkspaceSetupActive(queryClient, runtimeUrl, workspaceId)) {
    setWorkspaceArrivalEvent(null);
  }
  trackProductEvent("chat_prompt_submitted", {
    workspace_kind: parseCloudWorkspaceSyntheticId(workspaceId) ? "cloud" : "local",
    agent_kind: agentKind,
    reuse_session: reuseSession,
  });
}
