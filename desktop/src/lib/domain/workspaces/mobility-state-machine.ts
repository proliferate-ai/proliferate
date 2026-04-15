import type { CloudMobilityHandoffSummary } from "@/lib/integrations/cloud/client";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/logical-workspaces";
import { mobilityStatusCopy } from "@/config/mobility-copy";

export type WorkspaceMobilityUiPhase =
  | "idle"
  | "provisioning"
  | "transferring"
  | "finalizing"
  | "cleanup_pending"
  | "cleanup_failed"
  | "failed"
  | "success";

export interface WorkspaceMobilityStatusModel {
  direction: "local_to_cloud" | "cloud_to_local" | null;
  phase: WorkspaceMobilityUiPhase;
  activeHandoff: CloudMobilityHandoffSummary | null;
  title: string | null;
  description: string | null;
  isBlocking: boolean;
  isFailure: boolean;
  canRetryCleanup: boolean;
}

export type WorkspaceMobilityDestinationKind = "local" | "cloud";

export function mobilityDestinationKind(
  status: Pick<WorkspaceMobilityStatusModel, "direction" | "isBlocking">,
): WorkspaceMobilityDestinationKind | null {
  if (!status.isBlocking) {
    return null;
  }

  switch (status.direction) {
    case "local_to_cloud":
      return "cloud";
    case "cloud_to_local":
      return "local";
    default:
      return null;
  }
}

export function isWorkspaceMobilityTransitionPhase(
  phase: WorkspaceMobilityUiPhase,
): boolean {
  return phase === "provisioning"
    || phase === "transferring"
    || phase === "finalizing"
    || phase === "cleanup_pending";
}

function normalizeDirection(
  direction: string | null | undefined,
): "local_to_cloud" | "cloud_to_local" | null {
  return direction === "local_to_cloud" || direction === "cloud_to_local"
    ? direction
    : null;
}

function summarizeActivePhase(
  handoff: CloudMobilityHandoffSummary,
): Pick<WorkspaceMobilityStatusModel, "phase" | "title" | "description" | "isBlocking" | "isFailure" | "canRetryCleanup"> {
  const direction = normalizeDirection(handoff.direction);

  switch (handoff.phase) {
    case "start_requested":
    case "source_frozen":
      return {
        phase: "provisioning",
        ...mobilityStatusCopy("provisioning", direction),
        isBlocking: true,
        isFailure: false,
        canRetryCleanup: false,
      };
    case "destination_ready":
      return {
        phase: "transferring",
        ...mobilityStatusCopy("transferring", direction),
        isBlocking: true,
        isFailure: false,
        canRetryCleanup: false,
      };
    case "install_succeeded":
      return {
        phase: "finalizing",
        ...mobilityStatusCopy("finalizing", direction),
        isBlocking: true,
        isFailure: false,
        canRetryCleanup: false,
      };
    case "cleanup_pending":
      return {
        phase: "cleanup_pending",
        ...mobilityStatusCopy("cleanup_pending", direction),
        isBlocking: false,
        isFailure: false,
        canRetryCleanup: false,
      };
    case "cleanup_failed":
      return {
        phase: "cleanup_failed",
        title: mobilityStatusCopy("cleanup_failed", direction).title,
        description: handoff.failureDetail
          ?? mobilityStatusCopy("cleanup_failed", direction).description,
        isBlocking: false,
        isFailure: true,
        canRetryCleanup: true,
      };
    case "completed":
      return {
        phase: "success",
        ...mobilityStatusCopy("success", direction),
        isBlocking: false,
        isFailure: false,
        canRetryCleanup: false,
      };
    case "handoff_failed":
      return {
        phase: "failed",
        title: mobilityStatusCopy("failed", direction).title,
        description: handoff.failureDetail
          ?? mobilityStatusCopy("failed", direction).description,
        isBlocking: false,
        isFailure: true,
        canRetryCleanup: false,
      };
    default:
      return {
        phase: "provisioning",
        ...mobilityStatusCopy("idle", direction),
        isBlocking: true,
        isFailure: false,
        canRetryCleanup: false,
      };
  }
}

export function resolveWorkspaceMobilityStatusModel(
  logicalWorkspace: LogicalWorkspace | null,
  handoff: CloudMobilityHandoffSummary | null,
): WorkspaceMobilityStatusModel {
  if (handoff) {
    return {
      direction: normalizeDirection(handoff.direction),
      activeHandoff: handoff,
      ...summarizeActivePhase(handoff),
    };
  }

  if (logicalWorkspace?.lifecycle === "moving_to_cloud") {
    return {
      direction: "local_to_cloud",
      phase: "provisioning",
      activeHandoff: null,
      title: mobilityStatusCopy("provisioning", "local_to_cloud").title,
      description: logicalWorkspace.mobilityWorkspace?.statusDetail
        ?? mobilityStatusCopy("provisioning", "local_to_cloud").description,
      isBlocking: true,
      isFailure: false,
      canRetryCleanup: false,
    };
  }

  if (logicalWorkspace?.lifecycle === "moving_to_local") {
    return {
      direction: "cloud_to_local",
      phase: "provisioning",
      activeHandoff: null,
      title: mobilityStatusCopy("provisioning", "cloud_to_local").title,
      description: logicalWorkspace.mobilityWorkspace?.statusDetail
        ?? mobilityStatusCopy("provisioning", "cloud_to_local").description,
      isBlocking: true,
      isFailure: false,
      canRetryCleanup: false,
    };
  }

  if (logicalWorkspace?.lifecycle === "cleanup_failed") {
    const direction = logicalWorkspace.effectiveOwner === "cloud"
      ? "local_to_cloud"
      : "cloud_to_local";
    return {
      direction,
      phase: "cleanup_failed",
      activeHandoff: null,
      title: mobilityStatusCopy("cleanup_failed", direction).title,
      description: logicalWorkspace.mobilityWorkspace?.lastError
        ?? mobilityStatusCopy("cleanup_failed", direction).description,
      isBlocking: false,
      isFailure: true,
      canRetryCleanup: true,
    };
  }

  if (logicalWorkspace?.lifecycle === "handoff_failed" || logicalWorkspace?.lifecycle === "cloud_lost") {
    return {
      direction: null,
      phase: "failed",
      activeHandoff: null,
      title: logicalWorkspace.lifecycle === "cloud_lost"
        ? "Cloud workspace unavailable"
        : mobilityStatusCopy("failed", null).title,
      description: logicalWorkspace.mobilityWorkspace?.lastError
        ?? logicalWorkspace.mobilityWorkspace?.statusDetail
        ?? mobilityStatusCopy("failed", null).description,
      isBlocking: false,
      isFailure: true,
      canRetryCleanup: false,
    };
  }

  return {
    direction: null,
    phase: "idle",
    activeHandoff: null,
    title: null,
    description: null,
    isBlocking: false,
    isFailure: false,
    canRetryCleanup: false,
  };
}
