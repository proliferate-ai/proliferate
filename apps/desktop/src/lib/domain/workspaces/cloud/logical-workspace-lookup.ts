import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";
import {
  logicalWorkspaceCloudMaterializationId,
  logicalWorkspaceTargetMaterializationId,
} from "@/lib/domain/workspaces/cloud/logical-workspace-materialization";
import {
  buildLocalSlotLogicalWorkspaceId,
  parseLogicalWorkspaceId,
} from "@/lib/domain/workspaces/cloud/logical-workspace-id";

export function logicalWorkspaceMatchesId(
  workspace: LogicalWorkspace,
  candidateId: string | null | undefined,
): boolean {
  if (!candidateId) {
    return false;
  }

  const localSlotWorkspaceId = parseLocalSlotWorkspaceId(candidateId);
  return candidateId === workspace.id
    || candidateId === workspace.localWorkspace?.id
    || (!!localSlotWorkspaceId && localSlotWorkspaceId === workspace.localWorkspace?.id)
    || candidateId === (
      workspace.localWorkspace
        ? buildLocalSlotLogicalWorkspaceId(workspace.localWorkspace.id)
        : null
    )
    || candidateId === logicalWorkspaceCloudMaterializationId(workspace)
    || candidateId === logicalWorkspaceTargetMaterializationId(workspace);
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
  if (workspace.localWorkspace) {
    pushId(buildLocalSlotLogicalWorkspaceId(workspace.localWorkspace.id));
  }
  pushId(logicalWorkspaceCloudMaterializationId(workspace));
  pushId(logicalWorkspaceTargetMaterializationId(workspace));
  pushId(workspace.preferredMaterializationId);
  return ids;
}

export function expandLogicalWorkspaceRelatedIdSet(
  workspaces: readonly Pick<
    LogicalWorkspace,
    "id" | "localWorkspace" | "cloudWorkspace" | "mobilityWorkspace" | "preferredMaterializationId"
  >[],
  ids: Iterable<string>,
): Set<string> {
  const seed = new Set(ids);
  const expanded = new Set(seed);
  for (const workspace of workspaces) {
    const relatedIds = logicalWorkspaceRelatedIds(workspace);
    if (!relatedIds.some((id) => seed.has(id))) {
      continue;
    }
    for (const id of relatedIds) {
      expanded.add(id);
    }
  }
  return expanded;
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

function parseLocalSlotWorkspaceId(candidateId: string): string | null {
  const parsed = parseLogicalWorkspaceId(candidateId);
  if (parsed?.kind !== "local-slot" || parsed.segments.length !== 1) {
    return null;
  }
  return parsed.segments[0] ?? null;
}
