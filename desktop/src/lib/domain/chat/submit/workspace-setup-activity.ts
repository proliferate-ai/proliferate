import type { GetSetupStatusResponse } from "@anyharness/sdk";
import type { WorkspaceArrivalEvent } from "@/lib/domain/workspaces/creation/arrival";

export type CachedWorkspaceSetupStatus = GetSetupStatusResponse["status"] | null;

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
  // and setup runs in the background. Treat a cache miss as potentially active
  // so the panel isn't dismissed before the first setup-status poll returns.
  const isAsyncSetupSource =
    arrival.source === "worktree-created" || arrival.source === "local-created";
  if (isAsyncSetupSource && status === null) return true;
  return status === "running" || status === "queued";
}
