import type { GetSetupStatusResponse } from "@anyharness/sdk";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import type { WorkspaceArrivalEvent } from "@/lib/domain/workspaces/creation/arrival";
import { trackProductEvent } from "@/lib/integrations/telemetry/client";

type CachedWorkspaceSetupStatus = GetSetupStatusResponse["status"] | null;

interface WorkspaceSetupActivityInput {
  workspaceArrivalEvent: WorkspaceArrivalEvent | null;
  workspaceId: string | null;
  cachedSetupStatus: CachedWorkspaceSetupStatus;
}

export function isWorkspaceSetupActive({
  workspaceArrivalEvent,
  workspaceId,
  cachedSetupStatus,
}: WorkspaceSetupActivityInput): boolean {
  if (!workspaceId) return false;
  const arrival = workspaceArrivalEvent;
  if (!arrival || arrival.workspaceId !== workspaceId) return false;

  const status = cachedSetupStatus ?? arrival.setupScript?.status ?? null;
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
  workspaceId,
  workspaceArrivalEvent,
  getCachedWorkspaceSetupStatus,
  agentKind,
  reuseSession,
  setWorkspaceArrivalEvent,
}: {
  workspaceId: string;
  workspaceArrivalEvent: WorkspaceArrivalEvent | null;
  getCachedWorkspaceSetupStatus: (workspaceId: string) => CachedWorkspaceSetupStatus;
  agentKind: string;
  reuseSession: boolean;
  setWorkspaceArrivalEvent: (event: null) => void;
}): void {
  if (!isWorkspaceSetupActive({
    workspaceArrivalEvent,
    workspaceId,
    cachedSetupStatus: getCachedWorkspaceSetupStatus(workspaceId),
  })) {
    setWorkspaceArrivalEvent(null);
  }
  trackProductEvent("chat_prompt_submitted", {
    workspace_kind: parseCloudWorkspaceSyntheticId(workspaceId) ? "cloud" : "local",
    agent_kind: agentKind,
    reuse_session: reuseSession,
  });
}
