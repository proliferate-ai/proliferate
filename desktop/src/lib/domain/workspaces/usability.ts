import type { Workspace } from "@anyharness/sdk";
import { isCloudWorkspaceId } from "@/lib/domain/workspaces/cloud-ids";

export function isStructuralRepoWorkspace(workspace: Workspace): boolean {
  return workspace.kind === "repo" && !isCloudWorkspaceId(workspace.id);
}

export function isCoworkWorkspace(workspace: Workspace): boolean {
  return workspace.surface === "cowork";
}

export function isStandardWorkspace(workspace: Workspace): boolean {
  return !isStructuralRepoWorkspace(workspace) && workspace.surface !== "cowork";
}

export function isUsableWorkspace(workspace: Workspace): boolean {
  return !isStructuralRepoWorkspace(workspace);
}
