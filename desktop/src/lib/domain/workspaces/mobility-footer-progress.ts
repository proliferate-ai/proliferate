import {
  getMobilityOverlayTitle,
  mobilityStatusCopy,
} from "@/lib/domain/workspaces/mobility/presentation";
import {
  isWorkspaceMobilityTransitionPhase,
  type WorkspaceMobilityUiPhase,
} from "@/lib/domain/workspaces/mobility-state-machine";
import type { WorkspaceMobilityDirection } from "@/lib/domain/workspaces/mobility/types";

export interface MobilityFooterProgressStatus {
  title: string;
  statusLabel: string;
}

export function resolveMobilityFooterProgressStatus(args: {
  canBringBackLocal: boolean;
  canMoveToCloud: boolean;
  confirmDirection: WorkspaceMobilityDirection | null;
  optimisticProgressDirection: WorkspaceMobilityDirection | null;
  statusDirection: WorkspaceMobilityDirection | null;
  statusPhase: WorkspaceMobilityUiPhase;
}): MobilityFooterProgressStatus | null {
  const statusIsTransitioning = isWorkspaceMobilityTransitionPhase(args.statusPhase);
  if (!statusIsTransitioning && !args.optimisticProgressDirection) {
    return null;
  }

  const direction = statusIsTransitioning
    ? args.statusDirection
    : args.optimisticProgressDirection
      ?? args.statusDirection
      ?? args.confirmDirection
      ?? (args.canMoveToCloud
        ? "local_to_cloud"
        : args.canBringBackLocal
          ? "cloud_to_local"
          : null);
  const phase = statusIsTransitioning ? args.statusPhase : "provisioning";

  return {
    title: getMobilityOverlayTitle(direction, phase),
    statusLabel: mobilityStatusCopy(phase, direction).title,
  };
}
