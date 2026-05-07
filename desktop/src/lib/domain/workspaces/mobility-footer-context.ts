import type { LogicalWorkspace } from "@/lib/domain/workspaces/logical-workspaces";
import {
  isWorkspaceMobilityTransitionPhase,
  mobilityDestinationKind,
  type WorkspaceMobilityDestinationKind,
  type WorkspaceMobilityStatusModel,
} from "@/lib/domain/workspaces/mobility-state-machine";
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
