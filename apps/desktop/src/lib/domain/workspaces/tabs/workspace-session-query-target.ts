import { parseTargetWorkspaceSyntheticId } from "@/lib/domain/compute/target-workspace-id";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";

export function shouldUseLocalRuntimeWorkspaceSessionsQuery(input: {
  workspaceId: string | null;
  hotPaintPending: boolean;
}): boolean {
  if (!input.workspaceId || input.hotPaintPending) {
    return false;
  }

  return !parseCloudWorkspaceSyntheticId(input.workspaceId)
    && !parseTargetWorkspaceSyntheticId(input.workspaceId);
}
