import type {
  WorkspaceMobilityBlockerCode,
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

export function mobilityDetailCopyLabel(
  kind: WorkspaceMobilityLocationKind,
): "Path" | "Repository" {
  return kind === "cloud_workspace" ? "Repository" : "Path";
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

export function mobilityBlockerCopy(args: {
  code: WorkspaceMobilityBlockerCode;
  direction: WorkspaceMobilityDirection | null;
  branchName?: string | null;
  rawMessage?: string | null;
}): {
  headline: string;
  body: string;
  helper: string | null;
  actionLabel: string;
} {
  const moveLabel = args.direction === "cloud_to_local"
    ? "Can't bring this workspace back local yet"
    : "Can't move this workspace to cloud yet";

  switch (args.code) {
    case "repo_required":
      return {
        headline: moveLabel,
        body: "Workspace mobility is only available for repo-backed workspaces.",
        helper: null,
        actionLabel: "Got it",
      };
    case "local_repo_required":
      return {
        headline: moveLabel,
        body: "This repo isn't available locally yet.",
        helper: "Clone or reopen the local repo, then try again.",
        actionLabel: "Got it",
      };
    case "branch_not_published":
      return {
        headline: moveLabel,
        body: "This branch isn't on GitHub yet.",
        helper: args.branchName
          ? `Publish \`${args.branchName}\` before moving to cloud.`
          : "Publish this branch before moving to cloud.",
        actionLabel: "Publish branch",
      };
    case "head_commit_not_published":
      return {
        headline: moveLabel,
        body: "Your latest commit isn't on GitHub yet.",
        helper: args.branchName
          ? `Push \`${args.branchName}\` before moving to cloud.`
          : "Push this branch before moving to cloud.",
        actionLabel: "Push commits",
      };
    case "branch_out_of_sync":
      return {
        headline: moveLabel,
        body: "This branch is out of sync with GitHub.",
        helper: "Pull or rebase locally, then try again.",
        actionLabel: "Got it",
      };
    case "workspace_not_mutable":
      return {
        headline: moveLabel,
        body: "This workspace can't move right now.",
        helper: "Wait for the current operation to finish, then try again.",
        actionLabel: "Got it",
      };
    case "default_branch_unknown":
      return {
        headline: moveLabel,
        body: "The repo default branch isn't known yet.",
        helper: "Refresh the repo metadata, then try again.",
        actionLabel: "Got it",
      };
    case "setup_running":
      return {
        headline: moveLabel,
        body: "Workspace setup is still running.",
        helper: "Wait for setup to finish, then try again.",
        actionLabel: "Got it",
      };
    case "workspace_dirty":
      return {
        headline: moveLabel,
        body: "This workspace has uncommitted changes.",
        helper: "Commit or stash your changes, then try again.",
        actionLabel: "Got it",
      };
    case "workspace_status_unknown":
      return {
        headline: moveLabel,
        body: "Workspace status couldn't be confirmed.",
        helper: "Refresh the workspace and try again.",
        actionLabel: "Got it",
      };
    case "local_default_branch_in_use":
      return {
        headline: moveLabel,
        body: "This workspace is still on the repo default branch.",
        helper: "Create or switch to a branch before moving it.",
        actionLabel: "Got it",
      };
    case "session_running":
      return {
        headline: moveLabel,
        body: "One active session can't move yet.",
        helper: "Finish or stop that session, then try again.",
        actionLabel: "Got it",
      };
    case "session_awaiting_interaction":
      return {
        headline: moveLabel,
        body: "A session is waiting on an interaction.",
        helper: "Resolve that request, then try again.",
        actionLabel: "Got it",
      };
    case "pending_prompt":
      return {
        headline: moveLabel,
        body: "A queued prompt still needs to run here.",
        helper: "Run or clear the queued prompt, then try again.",
        actionLabel: "Got it",
      };
    case "archive_too_large":
      return {
        headline: moveLabel,
        body: "This workspace is too large to move right now.",
        helper: "Reduce the workspace size, then try again.",
        actionLabel: "Got it",
      };
    case "missing_branch_name":
      return {
        headline: moveLabel,
        body: "This workspace doesn't have a resolved branch yet.",
        helper: "Refresh the workspace branch state, then try again.",
        actionLabel: "Got it",
      };
    case "missing_base_commit_sha":
      return {
        headline: moveLabel,
        body: "This workspace doesn't have a resolved sync base yet.",
        helper: "Refresh the workspace, then try again.",
        actionLabel: "Got it",
      };
    case "workspace_handoff_in_progress":
    case "user_handoff_in_progress":
      return {
        headline: moveLabel,
        body: "A workspace move is already in progress.",
        helper: "Wait for the current move to finish.",
        actionLabel: "Got it",
      };
    case "branch_mismatch":
      return {
        headline: moveLabel,
        body: "Your local checkout is on a different branch.",
        helper: args.branchName
          ? `Switch your local checkout to \`${args.branchName}\` and try again.`
          : "Switch your local checkout to the requested branch and try again.",
        actionLabel: "Got it",
      };
    case "owner_mismatch":
      return {
        headline: moveLabel,
        body: "This workspace isn't on the expected runtime anymore.",
        helper: "Refresh the workspace list, then try again.",
        actionLabel: "Got it",
      };
    case "github_account_required":
      return {
        headline: moveLabel,
        body: "GitHub sign-in is required to validate this repo.",
        helper: "Connect GitHub, then try the move again.",
        actionLabel: "Connect GitHub",
      };
    case "cloud_lost":
      return {
        headline: "Cloud workspace unavailable",
        body: "The cloud workspace is no longer available.",
        helper: "Reconnect to a healthy workspace before trying again.",
        actionLabel: "Try again",
      };
    case "cloud_repo_access":
      return {
        headline: moveLabel,
        body: "GitHub access for this repo is not authorized.",
        helper: "You can be signed in while Proliferate is still missing access to this repository or organization.",
        actionLabel: "Manage GitHub access",
      };
    case "cleanup_failed":
      return {
        headline: "Workspace moved, but cleanup needs another pass",
        body: "The destination is ready, but the old source workspace still needs cleanup.",
        helper: "Retry cleanup to finish the move cleanly.",
        actionLabel: "Retry cleanup",
      };
    case "handoff_failed":
      return {
        headline: "Workspace move failed",
        body: "The workspace stayed on its current runtime.",
        helper: "Try the move again when you're ready.",
        actionLabel: "Try again",
      };
    case "unknown":
    default:
      return {
        headline: moveLabel,
        body: args.rawMessage ?? "This workspace can't move right now.",
        helper: "Resolve the issue and try again.",
        actionLabel: "Got it",
      };
  }
}
