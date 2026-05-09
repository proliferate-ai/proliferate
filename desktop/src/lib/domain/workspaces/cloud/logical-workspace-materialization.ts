import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";

export function resolvePreferredLogicalWorkspaceMaterialization(
  localWorkspace: LogicalWorkspace["localWorkspace"],
  cloudWorkspace: LogicalWorkspace["cloudWorkspace"],
  mobilityWorkspace: LogicalWorkspace["mobilityWorkspace"],
  currentSelectionId: string | null,
  effectiveOwnerHint: "local" | "cloud" | null,
): { workspaceId: string | null; owner: "local" | "cloud" } {
  const cloudId = cloudWorkspace
    ? cloudWorkspaceSyntheticId(cloudWorkspace.id)
    : mobilityWorkspace?.cloudWorkspaceId
      ? cloudWorkspaceSyntheticId(mobilityWorkspace.cloudWorkspaceId)
      : null;

  if (effectiveOwnerHint === "local" && localWorkspace) {
    return { workspaceId: localWorkspace.id, owner: "local" };
  }

  if (effectiveOwnerHint === "cloud" && cloudId) {
    return {
      workspaceId: cloudId,
      owner: "cloud",
    };
  }

  if (localWorkspace && currentSelectionId === localWorkspace.id) {
    return { workspaceId: localWorkspace.id, owner: "local" };
  }

  if (cloudId) {
    if (currentSelectionId === cloudId) {
      return { workspaceId: cloudId, owner: "cloud" };
    }
  }

  if (localWorkspace) {
    return { workspaceId: localWorkspace.id, owner: "local" };
  }

  return {
    workspaceId: cloudId,
    owner: "cloud",
  };
}

export function resolveLogicalWorkspaceMaterializationId(
  workspace: LogicalWorkspace,
  currentSelectionId?: string | null,
): string | null {
  const selected = resolvePreferredLogicalWorkspaceMaterialization(
    workspace.localWorkspace,
    workspace.cloudWorkspace,
    workspace.mobilityWorkspace,
    currentSelectionId ?? null,
    workspace.mobilityWorkspace?.owner === "local" || workspace.mobilityWorkspace?.owner === "cloud"
      ? workspace.mobilityWorkspace.owner
      : null,
  );
  return selected.workspaceId;
}

export function logicalWorkspaceCloudMaterializationId(
  workspace: Pick<LogicalWorkspace, "cloudWorkspace" | "mobilityWorkspace">,
): string | null {
  if (workspace.cloudWorkspace) {
    return cloudWorkspaceSyntheticId(workspace.cloudWorkspace.id);
  }
  if (workspace.mobilityWorkspace?.cloudWorkspaceId) {
    return cloudWorkspaceSyntheticId(workspace.mobilityWorkspace.cloudWorkspaceId);
  }
  return null;
}
