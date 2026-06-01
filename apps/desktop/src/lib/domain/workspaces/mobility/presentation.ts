import type {
  WorkspaceMobilityDirection,
  WorkspaceMobilityLocationKind,
} from "@/lib/domain/workspaces/mobility/types";

export function mobilityLocationLabel(
  kind: WorkspaceMobilityLocationKind,
): string {
  switch (kind) {
    case "local_worktree":
      return "Local worktree";
    case "cloud_workspace":
      return "Cloud workspace";
    case "local_workspace":
    default:
      return "Local workspace";
  }
}

export function mobilityActionableCopy(
  kind: WorkspaceMobilityLocationKind,
): {
  headline: string;
  body: string;
  actionLabel: string;
  direction: WorkspaceMobilityDirection;
} {
  switch (kind) {
    case "cloud_workspace":
      return {
        headline: "Bring back local",
        body: "Move this workspace from cloud back to your local machine.",
        actionLabel: "Bring back local",
        direction: "cloud_to_local",
      };
    case "local_worktree":
      return {
        headline: "Move to cloud",
        body: "Move this local worktree to a cloud runtime.",
        actionLabel: "Move to cloud",
        direction: "local_to_cloud",
      };
    case "local_workspace":
    default:
      return {
        headline: "Move to cloud",
        body: "Move this local workspace to a cloud runtime.",
        actionLabel: "Move to cloud",
        direction: "local_to_cloud",
      };
  }
}

export function mobilityReconnectCopy(
  direction: WorkspaceMobilityDirection | null,
): string {
  return direction === "cloud_to_local"
    ? "Reconnect any MCP tools you need in this local environment."
    : "Reconnect any MCP tools you need in cloud.";
}

export function mobilityBranchSyncLoadingCopy(): {
  headline: string;
  body: string;
} {
  return {
    headline: "Checking local branch sync",
    body: "Comparing your local branch with GitHub.",
  };
}

export function mobilityStatusCopy(
  phase: string,
  direction: WorkspaceMobilityDirection | null,
): {
  title: string;
  description: string | null;
} {
  switch (phase) {
    case "provisioning":
      return direction === "cloud_to_local"
        ? {
          title: "Preparing local workspace",
          description: "Preparing this branch on your machine.",
        }
        : {
          title: "Preparing cloud workspace",
          description: "Starting this branch in the cloud.",
        };
    case "transferring":
      return {
        title: "Syncing workspace",
        description: "Moving workspace state to the new runtime.",
      };
    case "finalizing":
      return {
        title: "Switching workspace",
        description: "Opening this workspace on its new runtime.",
      };
    case "cleanup_pending":
      return {
        title: "Finishing cleanup",
        description: "The workspace is ready. Finishing cleanup in the background.",
      };
    case "cleanup_failed":
      return {
        title: "Cleanup needs retry",
        description: "The workspace moved successfully, but cleanup needs to be retried.",
      };
    case "success":
      return direction === "cloud_to_local"
        ? {
          title: "Now local",
          description: "This workspace has moved back to your local machine.",
        }
        : {
          title: "Now in cloud",
          description: "This workspace has moved to the cloud.",
        };
    case "failed":
      return {
        title: "Move did not finish",
        description: "The workspace stayed where it was.",
      };
    default:
      return {
        title: "Preparing move",
        description: "Starting the handoff workflow.",
      };
  }
}

export function getMobilityOverlayTitle(
  direction: WorkspaceMobilityDirection | null,
  phase: string,
): string {
  if (
    phase === "provisioning"
    || phase === "transferring"
    || phase === "finalizing"
    || phase === "cleanup_pending"
  ) {
    return direction === "cloud_to_local" ? "Bringing back local" : "Moving to cloud";
  }

  return mobilityStatusCopy(phase, direction).title;
}
