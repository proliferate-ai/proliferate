import type { Workspace } from "@anyharness/sdk";
import type { PendingWorkspaceEntry } from "@/lib/domain/workspaces/pending-entry";

export type WorkspaceShellSurface = "standard" | "cowork";

export function resolveWorkspaceShellSurface(
  selectedWorkspace: Workspace | null,
  pendingWorkspaceEntry: PendingWorkspaceEntry | null,
  options: { pendingCoworkLaunch?: boolean } = {},
): WorkspaceShellSurface {
  if (selectedWorkspace?.surface === "cowork") {
    return "cowork";
  }

  if (pendingWorkspaceEntry?.source === "cowork-created" || options.pendingCoworkLaunch) {
    return "cowork";
  }

  return "standard";
}
