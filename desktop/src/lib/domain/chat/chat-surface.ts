import type { Workspace } from "@anyharness/sdk";
import { isStructuralRepoWorkspace } from "@/lib/domain/workspaces/usability";

export function shouldShowStructuralRepoWorkspaceStatus(
  workspace: Workspace | null,
  activeSessionId: string | null,
): boolean {
  return !!workspace && isStructuralRepoWorkspace(workspace) && !activeSessionId;
}

export function shouldKeepBootstrappedWorkspaceLoading(args: {
  activeSessionId: string | null;
  hasBootstrappedWorkspace: boolean;
  rememberedSessionId: string | null;
}): boolean {
  return !args.activeSessionId
    && args.hasBootstrappedWorkspace
    && !!args.rememberedSessionId;
}
