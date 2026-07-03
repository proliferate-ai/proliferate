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
  currentSelectionId: string | null,
): { workspaceId: string | null; owner: "local" | "cloud" } {
  const cloudWorkspaceUsesRuntime = cloudWorkspace
    ? cloudWorkspaceUsesCloudRuntime(cloudWorkspace)
    : false;
  const directTargetId = cloudWorkspace
    ? logicalWorkspaceTargetMaterializationId({ cloudWorkspace })
    : null;
  const managedCloudId = cloudWorkspace && cloudWorkspaceUsesRuntime
    ? cloudWorkspaceSyntheticId(cloudWorkspace.id)
    : null;
  const cloudId = directTargetId ?? managedCloudId;
  const fallbackOwner = cloudWorkspace && !cloudWorkspaceUsesRuntime
    ? "local"
    : "cloud";

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
    currentSelectionId ?? null,
  );
  return selected.workspaceId;
}

export function logicalWorkspaceCloudMaterializationId(
  workspace: Pick<LogicalWorkspace, "cloudWorkspace">,
): string | null {
  return workspace.cloudWorkspace ? cloudWorkspaceSyntheticId(workspace.cloudWorkspace.id) : null;
}

export function logicalWorkspaceCloudRuntimeMaterializationId(
  workspace: Pick<LogicalWorkspace, "cloudWorkspace">,
): string | null {
  if (workspace.cloudWorkspace && !cloudWorkspaceUsesCloudRuntime(workspace.cloudWorkspace)) {
    return null;
  }
  return logicalWorkspaceCloudMaterializationId(workspace);
}
