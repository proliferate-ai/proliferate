import type { Workspace } from "@anyharness/sdk";

export function isCoworkWorkspace(workspace: Workspace): boolean {
  return workspace.surface === "cowork";
}

export function isStandardWorkspace(workspace: Workspace): boolean {
  return workspace.surface !== "cowork";
}

export function isUsableWorkspace(workspace: Workspace): boolean {
  return workspace.kind === "local" || workspace.kind === "worktree";
}
