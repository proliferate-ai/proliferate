import type { Workspace } from "@anyharness/sdk";
import type { CloudWorkspaceSummary } from "@/lib/domain/workspaces/cloud/cloud-workspace-model";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { humanizeBranchName } from "@/lib/domain/workspaces/creation/branch-naming";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";
import { workspaceDisplayName } from "@/lib/domain/workspaces/display/workspace-display";

export function cloudWorkspaceMatchesSelection(
  workspace: CloudWorkspaceSummary,
  logicalId: string,
  currentSelectionId: string | null | undefined,
): boolean {
  return currentSelectionId === logicalId
    || currentSelectionId === cloudWorkspaceSyntheticId(workspace.id);
}

function cloudWorkspaceSelectedByMaterialization(
  workspace: CloudWorkspaceSummary,
  currentSelectionId: string | null | undefined,
): boolean {
  return currentSelectionId === cloudWorkspaceSyntheticId(workspace.id);
}

function cloudWorkspaceIsArchived(workspace: CloudWorkspaceSummary): boolean {
  return workspace.productLifecycle === "archived"
    || workspace.status === "archived"
    || workspace.workspaceStatus === "archived";
}

function cloudWorkspaceTimestamp(workspace: CloudWorkspaceSummary): number {
  return new Date(workspace.updatedAt ?? workspace.createdAt ?? "").getTime() || 0;
}

export function preferCloudWorkspaceForLogicalSlot(
  current: CloudWorkspaceSummary | null,
  candidate: CloudWorkspaceSummary,
  currentSelectionId: string | null | undefined,
): CloudWorkspaceSummary {
  if (!current) {
    return candidate;
  }

  const candidateArchived = cloudWorkspaceIsArchived(candidate);
  const currentArchived = cloudWorkspaceIsArchived(current);
  if (candidateArchived !== currentArchived) {
    return candidateArchived ? current : candidate;
  }

  const candidateSelected = cloudWorkspaceSelectedByMaterialization(candidate, currentSelectionId);
  const currentSelected = cloudWorkspaceSelectedByMaterialization(current, currentSelectionId);
  if (candidateSelected !== currentSelected) {
    return candidateSelected ? candidate : current;
  }

  return cloudWorkspaceTimestamp(candidate) >= cloudWorkspaceTimestamp(current)
    ? candidate
    : current;
}

export function localDefaultDisplayName(workspace: Workspace): string {
  return workspaceDisplayName(workspace);
}

export function cloudDefaultDisplayName(workspace: CloudWorkspaceSummary): string {
  const override = workspace.displayName?.trim();
  if (override) {
    return override;
  }

  return workspace.repo.branch?.trim()
    ? humanizeBranchName(workspace.repo.branch)
    : workspace.repo.name;
}

export function latestUpdatedAt(
  localWorkspace: Workspace | null,
  cloudWorkspace: CloudWorkspaceSummary | null,
): string {
  const localUpdatedAt = localWorkspace?.updatedAt ?? "";
  const cloudUpdatedAt = cloudWorkspace?.updatedAt ?? cloudWorkspace?.createdAt ?? "";
  return [localUpdatedAt, cloudUpdatedAt]
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? "";
}

export function inferLifecycle(
  localWorkspace: Workspace | null,
  cloudWorkspace: CloudWorkspaceSummary | null,
  owner: "local" | "cloud",
): LogicalWorkspace["lifecycle"] {
  if (owner === "cloud") {
    return "cloud_active";
  }

  if (localWorkspace || cloudWorkspace) {
    return "local_active";
  }

  return "handoff_failed";
}
