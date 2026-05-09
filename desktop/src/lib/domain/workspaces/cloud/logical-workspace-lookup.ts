import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";
import { logicalWorkspaceCloudMaterializationId } from "@/lib/domain/workspaces/cloud/logical-workspace-materialization";

export function logicalWorkspaceMatchesId(
  workspace: LogicalWorkspace,
  candidateId: string | null | undefined,
): boolean {
  if (!candidateId) {
    return false;
  }

  return candidateId === workspace.id
    || candidateId === workspace.localWorkspace?.id
    || candidateId === logicalWorkspaceCloudMaterializationId(workspace);
}

export function logicalWorkspaceRelatedIds(
  workspace: Pick<
    LogicalWorkspace,
    "id" | "localWorkspace" | "cloudWorkspace" | "mobilityWorkspace" | "preferredMaterializationId"
  >,
): string[] {
  const ids: string[] = [];
  const pushId = (id: string | null | undefined) => {
    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  };

  pushId(workspace.id);
  pushId(workspace.localWorkspace?.id);
  pushId(logicalWorkspaceCloudMaterializationId(workspace));
  pushId(workspace.preferredMaterializationId);
  return ids;
}

export function latestLogicalWorkspaceTimestamp(
  timestamps: Record<string, string>,
  workspace: Pick<
    LogicalWorkspace,
    "id" | "localWorkspace" | "cloudWorkspace" | "mobilityWorkspace" | "preferredMaterializationId"
  >,
): string | null {
  let latestTimestamp: string | null = null;
  for (const id of logicalWorkspaceRelatedIds(workspace)) {
    const timestamp = timestamps[id];
    if (!timestamp) {
      continue;
    }
    if (!latestTimestamp || new Date(timestamp).getTime() > new Date(latestTimestamp).getTime()) {
      latestTimestamp = timestamp;
    }
  }
  return latestTimestamp;
}

export function findLogicalWorkspace(
  workspaces: readonly LogicalWorkspace[],
  candidateId: string | null | undefined,
): LogicalWorkspace | null {
  if (!candidateId) {
    return null;
  }

  return workspaces.find((workspace) => logicalWorkspaceMatchesId(workspace, candidateId)) ?? null;
}
