import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";
import {
  resolvePendingWorkspacePath,
  type PendingWorkspaceEntry,
} from "@/lib/domain/workspaces/creation/pending-entry";
import {
  isWorkspaceMobilityTransitionPhase,
  mobilityDestinationKind,
  type WorkspaceMobilityDestinationKind,
  type WorkspaceMobilityStatusModel,
} from "@/lib/domain/workspaces/mobility/mobility-state-machine";
import {
  mobilityDetailCopyLabel,
  mobilityLocationLabel,
} from "@/lib/domain/workspaces/mobility/presentation";
import type { WorkspaceMobilityLocationKind } from "@/lib/domain/workspaces/mobility/types";

export type WorkspaceMobilitySelectedMaterializationKind = "local" | "cloud";
export type MobilityFooterDetailKind = "path" | "repository";

export interface MobilityFooterContext {
  locationKind: WorkspaceMobilityLocationKind;
  locationLabel: string;
  detailKind: MobilityFooterDetailKind;
  detailValue: string | null;
  detailCopyLabel: "Path" | "Repository";
  branchLabel: string | null;
  branchValue: string | null;
  isInteractive: boolean;
  isActive: boolean;
}

function resolveLocationKind(
  logicalWorkspace: LogicalWorkspace | null,
  selectedMaterializationKind: WorkspaceMobilitySelectedMaterializationKind | null,
  status: WorkspaceMobilityStatusModel,
): WorkspaceMobilityLocationKind {
  const ownerKind: WorkspaceMobilityDestinationKind | null =
    mobilityDestinationKind(status)
    ?? selectedMaterializationKind
    ?? logicalWorkspace?.effectiveOwner
    ?? null;

  if (ownerKind === "cloud") {
    return "cloud_workspace";
  }

  return logicalWorkspace?.localWorkspace?.kind === "worktree"
    ? "local_worktree"
    : "local_workspace";
}

function resolvePathValue(
  logicalWorkspace: LogicalWorkspace | null,
): string | null {
  if (!logicalWorkspace) {
    return null;
  }

  return logicalWorkspace.localWorkspace?.path?.trim()
    || logicalWorkspace.localWorkspace?.sourceRepoRootPath?.trim()
    || logicalWorkspace.repoRoot?.path?.trim()
    || logicalWorkspace.sourceRoot.trim();
}

function formatRepoIdentity(
  repo: { owner?: string | null; name?: string | null } | null | undefined,
): string | null {
  const owner = repo?.owner?.trim();
  const name = repo?.name?.trim();
  return owner && name ? `${owner}/${name}` : null;
}

function resolveCloudDetailValue(logicalWorkspace: LogicalWorkspace): string {
  const topLevelOwner = logicalWorkspace.owner?.trim();
  const topLevelRepoName = logicalWorkspace.repoName?.trim();
  return formatRepoIdentity(logicalWorkspace.cloudWorkspace?.repo)
    || formatRepoIdentity(logicalWorkspace.mobilityWorkspace?.repo)
    || (topLevelOwner && topLevelRepoName ? `${topLevelOwner}/${topLevelRepoName}` : null)
    || logicalWorkspace.displayName.trim()
    || mobilityLocationLabel("cloud_workspace");
}

function detailKindForLocation(
  locationKind: WorkspaceMobilityLocationKind,
): MobilityFooterDetailKind {
  return locationKind === "cloud_workspace" ? "repository" : "path";
}

function pendingLocationKind(entry: PendingWorkspaceEntry): WorkspaceMobilityLocationKind {
  switch (entry.request.kind) {
    case "worktree":
      return "local_worktree";
    case "cloud":
      return "cloud_workspace";
    case "local":
    case "cowork":
    case "select-existing":
      return "local_workspace";
  }
}

function pendingDetailValue(
  entry: PendingWorkspaceEntry,
  locationKind: WorkspaceMobilityLocationKind,
): string | null {
  if (locationKind === "cloud_workspace") {
    const repoLabel = entry.repoLabel?.trim();
    if (repoLabel) {
      return repoLabel;
    }
    return entry.request.kind === "cloud"
      ? `${entry.request.input.gitOwner}/${entry.request.input.gitRepoName}`
      : null;
  }

  return resolvePendingWorkspacePath(entry);
}

function pendingBranchValue(entry: PendingWorkspaceEntry): string | null {
  if (entry.request.kind === "worktree") {
    return entry.request.input.branchName?.trim()
      || entry.baseBranchName?.trim()
      || null;
  }

  if (entry.request.kind === "cloud") {
    return entry.request.input.branchName?.trim()
      || entry.request.input.baseBranch?.trim()
      || entry.baseBranchName?.trim()
      || null;
  }

  return entry.baseBranchName?.trim() || null;
}

function resolveDetailValue(
  logicalWorkspace: LogicalWorkspace | null,
  locationKind: WorkspaceMobilityLocationKind,
): string | null {
  if (!logicalWorkspace) {
    return null;
  }
  return locationKind === "cloud_workspace"
    ? resolveCloudDetailValue(logicalWorkspace)
    : resolvePathValue(logicalWorkspace);
}

export function buildMobilityFooterContext(args: {
  logicalWorkspace: LogicalWorkspace | null;
  status: WorkspaceMobilityStatusModel;
  selectedMaterializationKind?: WorkspaceMobilitySelectedMaterializationKind | null;
}): MobilityFooterContext | null {
  const { logicalWorkspace, selectedMaterializationKind = null, status } = args;
  if (!logicalWorkspace) {
    return null;
  }

  const locationKind = resolveLocationKind(logicalWorkspace, selectedMaterializationKind, status);
  const detailValue = resolveDetailValue(logicalWorkspace, locationKind);
  const branchValue = logicalWorkspace.branchKey?.trim() || null;

  return {
    locationKind,
    locationLabel: mobilityLocationLabel(locationKind),
    detailKind: detailKindForLocation(locationKind),
    detailValue,
    detailCopyLabel: mobilityDetailCopyLabel(locationKind),
    branchLabel: branchValue,
    branchValue,
    isInteractive: !isWorkspaceMobilityTransitionPhase(status.phase),
    isActive: status.isBlocking,
  };
}

export function buildPendingMobilityFooterContext(
  entry: PendingWorkspaceEntry,
): MobilityFooterContext | null {
  if (entry.request.kind === "cowork") {
    return null;
  }

  const locationKind = pendingLocationKind(entry);
  const detailValue = pendingDetailValue(entry, locationKind);
  const branchValue = pendingBranchValue(entry);

  return {
    locationKind,
    locationLabel: mobilityLocationLabel(locationKind),
    detailKind: detailKindForLocation(locationKind),
    detailValue,
    detailCopyLabel: mobilityDetailCopyLabel(locationKind),
    branchLabel: branchValue,
    branchValue,
    isInteractive: false,
    isActive: true,
  };
}
