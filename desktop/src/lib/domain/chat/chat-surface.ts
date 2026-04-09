import type { Workspace } from "@anyharness/sdk";
import { isStructuralRepoWorkspace } from "@/lib/domain/workspaces/usability";

export function shouldShowStructuralRepoWorkspaceStatus(
  workspace: Workspace | null,
  activeSessionId: string | null,
): boolean {
  return !!workspace && isStructuralRepoWorkspace(workspace) && !activeSessionId;
}
