import type {
  WorkspaceMobilityBlockerCode,
  WorkspaceMobilityDirection,
} from "@/lib/domain/workspaces/mobility/types";

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
        headline: "Publish branch before moving",
        body: "This branch isn't on GitHub yet.",
        helper: args.branchName
          ? `Push \`${args.branchName}\` so the destination can check out the exact commit.`
          : "Push this branch so the destination can check out the exact commit.",
        actionLabel: "Push and move",
      };
    case "head_commit_not_published":
      return {
        headline: "Publish branch before moving",
        body: "This branch has commits that only exist on this runtime.",
        helper: args.branchName
          ? `Push \`${args.branchName}\` so the destination can check out the exact commit.`
          : "Push this branch so the destination can check out the exact commit.",
        actionLabel: "Push and move",
      };
    case "branch_out_of_sync":
      return {
        headline: "Sync branch before moving",
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
        headline: "Prepare branch for move",
        body: "This workspace has uncommitted changes.",
        helper: "Commit and push these changes so the destination can check out the exact code.",
        actionLabel: "Prepare branch",
      };
    case "workspace_detached":
      return {
        headline: moveLabel,
        body: "This workspace is checked out at a detached commit.",
        helper: "Switch to a branch, then try again.",
        actionLabel: "Open Git tools",
      };
    case "workspace_conflicted":
      return {
        headline: moveLabel,
        body: "This workspace has Git conflicts.",
        helper: "Resolve the conflicts, then try again.",
        actionLabel: "Open Git tools",
      };
    case "git_operation_in_progress":
      return {
        headline: moveLabel,
        body: "A Git operation is still in progress.",
        helper: "Finish the operation, then try again.",
        actionLabel: "Open Git tools",
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
    case "review_active":
      return {
        headline: moveLabel,
        body: "A review is still active in this workspace.",
        helper: "Finish or stop the review, then try again.",
        actionLabel: "Got it",
      };
    case "unsupported_session":
      return {
        headline: moveLabel,
        body: "One session can't move yet.",
        helper: "Finish or archive that session, then try again.",
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
    case "invalid_base_commit_sha":
      return {
        headline: moveLabel,
        body: "This workspace doesn't have a usable sync base yet.",
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
      if (args.direction === "local_to_cloud") {
        return {
          headline: "Workspace is already in cloud",
          body: "This branch is already owned by the cloud workspace.",
          helper: "Open the cloud workspace or refresh the workspace list.",
          actionLabel: "Got it",
        };
      }
      if (args.direction === "cloud_to_local") {
        return {
          headline: "Workspace is already local",
          body: "This branch is already owned by a local worktree.",
          helper: "Open the local worktree or refresh the workspace list.",
          actionLabel: "Got it",
        };
      }
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
