import type { Workspace } from "@anyharness/sdk";
import { isCloudWorkspaceId } from "@/lib/domain/workspaces/cloud-ids";

export function isStructuralRepoWorkspace(workspace: Workspace): boolean {
  return workspace.kind === "repo" && !isCloudWorkspaceId(workspace.id);
}

export function isUsableWorkspace(workspace: Workspace): boolean {
  return !isStructuralRepoWorkspace(workspace);
}
