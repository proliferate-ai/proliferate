import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";
import {
  type PendingWorkspaceEntry,
} from "@/lib/domain/workspaces/creation/pending-entry";
import type { ComputeTargetAppearance } from "@/lib/domain/compute/target-appearance";
import {
  isWorkspaceMobilityTransitionPhase,
  mobilityDestinationKind,
  type WorkspaceMobilityDestinationKind,
  type WorkspaceMobilityStatusModel,
} from "@/lib/domain/workspaces/mobility/mobility-state-machine";
import {
  mobilityActionableCopy,
  mobilityLocationLabel,
} from "@/lib/domain/workspaces/mobility/presentation";
import {
  logicalWorkspaceSshTargetId,
  sidebarWorkspaceVariantForLogicalWorkspace,
  type SidebarWorkspaceVariant,
} from "@/lib/domain/workspaces/sidebar/sidebar-indicators";
import type { WorkspaceMobilityLocationKind } from "@/lib/domain/workspaces/mobility/types";

export type WorkspaceMobilitySelectedMaterializationKind = "local" | "cloud";

export interface MobilityFooterContext {
  locationKind: WorkspaceMobilityLocationKind;
  locationLabel: string;
  movementLabel: string;
  variant: SidebarWorkspaceVariant;
  targetAppearance: ComputeTargetAppearance | null;
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

function pendingVariant(entry: PendingWorkspaceEntry): SidebarWorkspaceVariant {
  switch (entry.request.kind) {
    case "worktree":
      return "worktree";
    case "cloud":
      return "cloud";
    case "local":
    case "cowork":
    case "select-existing":
      return "local";
  }
}

export function buildMobilityFooterContext(args: {
  logicalWorkspace: LogicalWorkspace | null;
  status: WorkspaceMobilityStatusModel;
  selectedMaterializationKind?: WorkspaceMobilitySelectedMaterializationKind | null;
  targetAppearanceById?: Record<string, ComputeTargetAppearance>;
}): MobilityFooterContext | null {
  const {
    logicalWorkspace,
    selectedMaterializationKind = null,
    status,
    targetAppearanceById,
  } = args;
  if (!logicalWorkspace) {
    return null;
  }

  const locationKind = resolveLocationKind(logicalWorkspace, selectedMaterializationKind, status);
  const variant = sidebarWorkspaceVariantForLogicalWorkspace(logicalWorkspace);
  const sshTargetId = variant === "ssh" ? logicalWorkspaceSshTargetId(logicalWorkspace) : null;
  const targetAppearance = sshTargetId
    ? targetAppearanceById?.[sshTargetId] ?? null
    : null;

  return {
    locationKind,
    locationLabel: mobilityLocationLabel(locationKind),
    movementLabel: mobilityActionableCopy(locationKind).actionLabel,
    variant,
    targetAppearance,
    isInteractive: !isWorkspaceMobilityTransitionPhase(status.phase),
    isActive: status.isBlocking,
  };
}

export function buildPendingMobilityFooterContext(
  entry: PendingWorkspaceEntry,
): MobilityFooterContext | null {
  if (entry.source === "cowork-created") {
    return null;
  }

  const locationKind = pendingLocationKind(entry);

  return {
    locationKind,
    locationLabel: mobilityLocationLabel(locationKind),
    movementLabel: mobilityActionableCopy(locationKind).actionLabel,
    variant: pendingVariant(entry),
    targetAppearance: null,
    isInteractive: false,
    isActive: true,
  };
}
