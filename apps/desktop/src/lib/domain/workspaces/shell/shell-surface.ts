import type { Workspace } from "@anyharness/sdk";
import type { PendingWorkspaceEntry } from "@/lib/domain/workspaces/creation/pending-entry";

export type WorkspaceShellSurface = "standard" | "cowork";

export function resolveWorkspaceShellSurface(
  selectedWorkspace: Workspace | null,
  pendingWorkspaceEntry: PendingWorkspaceEntry | null,
): WorkspaceShellSurface {
  if (selectedWorkspace?.surface === "cowork") {
    return "cowork";
  }

  if (pendingWorkspaceEntry?.source === "cowork-created") {
    return "cowork";
  }

  return "standard";
}
