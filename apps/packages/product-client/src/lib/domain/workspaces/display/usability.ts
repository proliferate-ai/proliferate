import type { Workspace } from "@anyharness/sdk";

export function isUsableWorkspace(workspace: Workspace): boolean {
  return workspace.kind === "local" || workspace.kind === "worktree";
}
