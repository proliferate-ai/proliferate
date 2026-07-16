import { cloudWorkspaceSyntheticId } from "#product/lib/domain/workspaces/cloud/cloud-ids";
import { targetWorkspaceSyntheticId } from "#product/lib/domain/compute/target-workspace-id";
import { cloudWorkspaceUsesCloudRuntime } from "#product/lib/domain/workspaces/cloud/cloud-runtime-kind";
import type {
  CloudWorkspaceMaterializationSummary,
  CloudWorkspaceSummary,
} from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";
import type { LogicalWorkspace } from "#product/lib/domain/workspaces/cloud/logical-workspace-model";

/** A local materialization is a durable copy this install can open (vs. a
 * pending/failed attempt). Only these establish an explicit association. */
const HEALTHY_LOCAL_MATERIALIZATION_STATES: ReadonlySet<string> = new Set([
  "hydrated",
]);

/** True when the Cloud response carries an explicit materialization ledger.
 * Legacy rows (pre-PR 4) omit the array and fall back to repository/branch
 * heuristics; rows that carry it use explicit association instead. */
export function cloudWorkspaceHasMaterializations(
  workspace: Pick<CloudWorkspaceSummary, "materializations">,
): boolean {
  return (workspace.materializations?.length ?? 0) > 0;
}

/**
 * The AnyHarness workspace id of this install's explicit, healthy local
 * materialization for a Cloud workspace, or null. This is the authoritative
 * `(desktopInstallId, anyharnessWorkspaceId)` link the server selected; a
 * redacted row from another install (null path/id) never matches here.
 */
export function explicitLocalMaterializationAnyharnessId(
  workspace: Pick<CloudWorkspaceSummary, "materializations">,
  desktopInstallId: string | null | undefined,
): string | null {
  if (!desktopInstallId) {
    return null;
  }
  const rows: CloudWorkspaceMaterializationSummary[] = workspace.materializations ?? [];
  for (const row of rows) {
    if (
      row.targetKind === "local_desktop"
      && row.desktopInstallId === desktopInstallId
      && HEALTHY_LOCAL_MATERIALIZATION_STATES.has(row.state)
      && row.anyharnessWorkspaceId
    ) {
      return row.anyharnessWorkspaceId;
    }
  }
  return null;
}

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
