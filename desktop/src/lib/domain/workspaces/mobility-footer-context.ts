import type { LogicalWorkspace } from "@/lib/domain/workspaces/logical-workspaces";
import {
  mobilityDestinationKind,
  type WorkspaceMobilityDestinationKind,
  type WorkspaceMobilityStatusModel,
} from "@/lib/domain/workspaces/mobility-state-machine";
import {
  mobilityLocationLabel,
  type WorkspaceMobilityLocationKind,
} from "@/config/mobility-copy";

export type WorkspaceMobilitySelectedMaterializationKind = "local" | "cloud";

export interface MobilityFooterContext {
  locationKind: WorkspaceMobilityLocationKind;
  locationLabel: string;
  pathLabel: string | null;
  pathValue: string | null;
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
  locationKind: WorkspaceMobilityLocationKind,
): string | null {
  if (!logicalWorkspace) {
    return null;
  }

  if (locationKind !== "cloud_workspace") {
    return logicalWorkspace.localWorkspace?.path?.trim()
      || logicalWorkspace.localWorkspace?.sourceRepoRootPath?.trim()
      || logicalWorkspace.repoRoot?.path?.trim()
      || logicalWorkspace.sourceRoot.trim();
  }

  return logicalWorkspace.repoRoot?.path?.trim()
    || (logicalWorkspace.provider && logicalWorkspace.owner && logicalWorkspace.repoName
      ? `${logicalWorkspace.owner}/${logicalWorkspace.repoName}`
      : logicalWorkspace.sourceRoot.trim());
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
  const pathValue = resolvePathValue(logicalWorkspace, locationKind);
  const branchValue = logicalWorkspace.branchKey?.trim() || null;

  return {
    locationKind,
    locationLabel: mobilityLocationLabel(locationKind),
    pathLabel: pathValue,
    pathValue,
    branchLabel: branchValue,
    branchValue,
    isInteractive: true,
    isActive: status.phase !== "idle",
  };
}
