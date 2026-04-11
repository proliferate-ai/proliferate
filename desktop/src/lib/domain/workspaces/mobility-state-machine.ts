import type { CloudMobilityHandoffSummary } from "@/lib/integrations/cloud/client";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/logical-workspaces";

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
  switch (handoff.phase) {
    case "start_requested":
    case "source_frozen":
      return {
        phase: "provisioning",
        title: handoff.direction === "local_to_cloud"
          ? "Provisioning cloud workspace"
          : "Preparing local destination",
        description: handoff.direction === "local_to_cloud"
          ? "Starting a cloud runtime on the current branch."
          : "Preparing a local workspace at the requested base commit.",
        isBlocking: true,
        isFailure: false,
        canRetryCleanup: false,
      };
    case "destination_ready":
      return {
        phase: "transferring",
        title: "Transferring workspace",
        description: "Syncing files and supported sessions.",
        isBlocking: true,
        isFailure: false,
        canRetryCleanup: false,
      };
    case "install_succeeded":
      return {
        phase: "finalizing",
        title: "Finalizing move",
        description: "Switching this workspace to the new owner.",
        isBlocking: true,
        isFailure: false,
        canRetryCleanup: false,
      };
    case "cleanup_pending":
      return {
        phase: "cleanup_pending",
        title: "Cleaning up source workspace",
        description: "The workspace is ready on the destination. Finishing source cleanup.",
        isBlocking: false,
        isFailure: false,
        canRetryCleanup: false,
      };
    case "cleanup_failed":
      return {
        phase: "cleanup_failed",
        title: "Source cleanup failed",
        description: handoff.failureDetail ?? "The workspace moved successfully, but source cleanup needs another pass.",
        isBlocking: false,
        isFailure: true,
        canRetryCleanup: true,
      };
    case "completed":
      return {
        phase: "success",
        title: "Workspace move complete",
        description: handoff.direction === "local_to_cloud"
          ? "This workspace is now running in cloud."
          : "This workspace is now running locally.",
        isBlocking: false,
        isFailure: false,
        canRetryCleanup: false,
      };
    case "handoff_failed":
      return {
        phase: "failed",
        title: "Workspace move failed",
        description: handoff.failureDetail ?? "The move did not complete.",
        isBlocking: false,
        isFailure: true,
        canRetryCleanup: false,
      };
    default:
      return {
        phase: "provisioning",
        title: "Preparing move",
        description: "Starting the handoff workflow.",
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
      title: "Provisioning cloud workspace",
      description: logicalWorkspace.mobilityWorkspace?.statusDetail ?? "Starting a cloud runtime on the current branch.",
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
      title: "Preparing local destination",
      description: logicalWorkspace.mobilityWorkspace?.statusDetail ?? "Preparing a local workspace at the requested base commit.",
      isBlocking: true,
      isFailure: false,
      canRetryCleanup: false,
    };
  }

  if (logicalWorkspace?.lifecycle === "cleanup_failed") {
    return {
      direction: logicalWorkspace.effectiveOwner === "cloud" ? "local_to_cloud" : "cloud_to_local",
      phase: "cleanup_failed",
      activeHandoff: null,
      title: "Source cleanup failed",
      description: logicalWorkspace.mobilityWorkspace?.lastError ?? "Source cleanup needs another pass.",
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
        : "Workspace move failed",
      description: logicalWorkspace.mobilityWorkspace?.lastError
        ?? logicalWorkspace.mobilityWorkspace?.statusDetail
        ?? "This workspace needs attention before it can move again.",
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
