import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { targetWorkspaceSyntheticId } from "@/lib/domain/compute/target-workspace-id";
import { cloudWorkspaceUsesCloudRuntime } from "@/lib/domain/workspaces/cloud/cloud-runtime-kind";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";

export function logicalWorkspaceTargetMaterializationId(
  workspace: Pick<LogicalWorkspace, "cloudWorkspace">,
): string | null {
  const directTarget = workspace.cloudWorkspace?.directTargetContext;
  if (
    directTarget?.targetKind !== "ssh"
    || !directTarget.targetId
    || !directTarget.anyharnessWorkspaceId
  ) {
    return null;
  }
  return targetWorkspaceSyntheticId(
    directTarget.targetId,
    directTarget.anyharnessWorkspaceId,
  );
}

export function resolvePreferredLogicalWorkspaceMaterialization(
  localWorkspace: LogicalWorkspace["localWorkspace"],
  cloudWorkspace: LogicalWorkspace["cloudWorkspace"],
  mobilityWorkspace: LogicalWorkspace["mobilityWorkspace"],
  currentSelectionId: string | null,
  effectiveOwnerHint: "local" | "cloud" | null,
): { workspaceId: string | null; owner: "local" | "cloud" } {
  const cloudWorkspaceUsesRuntime = cloudWorkspace
    ? cloudWorkspaceUsesCloudRuntime(cloudWorkspace)
    : false;
  const directTargetId = cloudWorkspace
    ? logicalWorkspaceTargetMaterializationId({ cloudWorkspace })
    : null;
  const managedCloudId = cloudWorkspace
    ? cloudWorkspaceUsesRuntime
      ? cloudWorkspaceSyntheticId(cloudWorkspace.id)
      : null
    : mobilityWorkspace?.cloudWorkspaceId
      ? cloudWorkspaceSyntheticId(mobilityWorkspace.cloudWorkspaceId)
      : null;
  const cloudId = directTargetId ?? managedCloudId;
  const fallbackOwner = cloudWorkspace && !cloudWorkspaceUsesRuntime
    ? "local"
    : "cloud";

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
    owner: fallbackOwner,
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

export function logicalWorkspaceCloudRuntimeMaterializationId(
  workspace: Pick<LogicalWorkspace, "cloudWorkspace" | "mobilityWorkspace">,
): string | null {
  if (workspace.cloudWorkspace && !cloudWorkspaceUsesCloudRuntime(workspace.cloudWorkspace)) {
    return null;
  }
  return logicalWorkspaceCloudMaterializationId(workspace);
}
