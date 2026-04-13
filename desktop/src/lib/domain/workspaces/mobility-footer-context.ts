import type { LogicalWorkspace } from "@/lib/domain/workspaces/logical-workspaces";
import type { WorkspaceMobilityStatusModel } from "@/lib/domain/workspaces/mobility-state-machine";
import {
  mobilityLocationLabel,
  type WorkspaceMobilityLocationKind,
} from "@/config/mobility-copy";

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
): WorkspaceMobilityLocationKind {
  if (logicalWorkspace?.effectiveOwner === "cloud") {
    return "cloud_workspace";
  }

  return logicalWorkspace?.localWorkspace?.kind === "worktree"
    ? "local_worktree"
    : "local_workspace";
}

function resolvePathValue(logicalWorkspace: LogicalWorkspace | null): string | null {
  if (!logicalWorkspace) {
    return null;
  }

  if (logicalWorkspace.effectiveOwner === "local") {
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
}): MobilityFooterContext | null {
  const { logicalWorkspace, status } = args;
  if (!logicalWorkspace) {
    return null;
  }

  const locationKind = resolveLocationKind(logicalWorkspace);
  const pathValue = resolvePathValue(logicalWorkspace);
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
