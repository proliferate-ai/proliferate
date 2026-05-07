import type { WorkspaceMobilityConfirmSnapshot } from "@/lib/domain/workspaces/mobility/types";
import type { WorkspaceMobilityStatusModel } from "@/lib/domain/workspaces/mobility/mobility-state-machine";
import type { WorkspaceMobilityDirection } from "@/lib/domain/workspaces/mobility/types";
import {
  mobilityActionableCopy,
  mobilityBlockerCopy,
  mobilityBranchSyncLoadingCopy,
  mobilityLocationLabel,
} from "@/lib/domain/workspaces/mobility/presentation";
import type { WorkspaceMobilityLocationKind } from "@/lib/domain/workspaces/mobility/types";
import {
  pickPrimaryMobilityBlocker,
  type WorkspaceMobilityPrimaryBlocker,
} from "@/lib/domain/workspaces/mobility/mobility-blockers";
import {
  isDisplayMobilityBlockerCode,
  resolveMobilitySyncRecovery,
  type LocalGitSyncSnapshot,
} from "@/lib/domain/workspaces/mobility/mobility-sync-recovery";
import {
  summarizeBranchSyncRecoveryWarning,
  summarizeNonMigratingState,
} from "@/lib/domain/workspaces/mobility/mobility-warnings";

export type MobilityPromptVariant =
  | "loading"
  | "actionable"
  | "blocked";

export type MobilityPromptPrimaryActionKind =
  | "confirm_move"
  | "connect_github"
  | "manage_github_access"
  | "publish_branch"
  | "push_commits"
  | "retry_prepare"
  | null;

export interface MobilityPromptState {
  variant: MobilityPromptVariant;
  direction: WorkspaceMobilityDirection | null;
  headline: string;
  body: string;
  helper: string | null;
  actionLabel: string | null;
  warning: string | null;
  blocker: WorkspaceMobilityPrimaryBlocker | null;
  primaryActionKind: MobilityPromptPrimaryActionKind;
}

export function isMobilityPromptPrimaryActionPending(
  prompt: MobilityPromptState,
  pending: {
    isBranchSyncing: boolean;
  },
): boolean {
  switch (prompt.primaryActionKind) {
    case "publish_branch":
    case "push_commits":
      return pending.isBranchSyncing;
    default:
      return false;
  }
}

function buildBlockedPrompt(args: {
  direction: WorkspaceMobilityDirection | null;
  blocker: WorkspaceMobilityPrimaryBlocker;
  warning?: string | null;
  primaryActionKind?: MobilityPromptPrimaryActionKind;
}): MobilityPromptState {
  const primaryActionKind = args.primaryActionKind ?? null;

  return {
    variant: "blocked",
    direction: args.direction,
    headline: args.blocker.headline,
    body: args.blocker.body,
    helper: args.blocker.helper,
    actionLabel: primaryActionKind ? args.blocker.actionLabel : null,
    warning: args.warning ?? null,
    blocker: args.blocker,
    primaryActionKind,
  };
}

function isSignInPreparationError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("sign in")
    && !normalized.includes("vite_dev_disable_auth");
}

function buildPreparationFailurePrompt(args: {
  direction: WorkspaceMobilityDirection | null;
  errorMessage: string;
}): MobilityPromptState {
  const signInRequired = isSignInPreparationError(args.errorMessage);
  const blocker: WorkspaceMobilityPrimaryBlocker = {
    code: signInRequired ? "github_account_required" : "unknown",
    rawMessage: args.errorMessage,
    headline: args.direction === "cloud_to_local"
      ? "Can't bring this workspace back local yet"
      : "Can't move this workspace to cloud yet",
    body: args.errorMessage,
    helper: signInRequired
      ? "Sign in, then try the move again."
      : "Try again in a moment.",
    actionLabel: signInRequired ? "Sign in" : "Try again",
  };

  return buildBlockedPrompt({
    direction: args.direction,
    blocker,
    primaryActionKind: signInRequired ? "connect_github" : "retry_prepare",
  });
}

export function buildMobilityPromptState(args: {
  isPreparing: boolean;
  hasResolvedPrompt: boolean;
  preparationError: string | null;
  locationKind: WorkspaceMobilityLocationKind;
  repoBacked: boolean;
  canMoveToCloud: boolean;
  canBringBackLocal: boolean;
  hasLocalRepoRoot: boolean;
  selectionLocked: boolean;
  status: WorkspaceMobilityStatusModel;
  confirmSnapshot: WorkspaceMobilityConfirmSnapshot | null;
  gitSync: LocalGitSyncSnapshot | null;
  isGitSyncResolved: boolean;
}): MobilityPromptState {
  const actionableCopy = mobilityActionableCopy(args.locationKind);
  const direction = args.confirmSnapshot?.direction ?? actionableCopy.direction;
  const branchName = args.confirmSnapshot?.sourcePreflight.branchName ?? null;

  if (!args.repoBacked) {
    const blocker = {
      code: "repo_required" as const,
      rawMessage: "Workspace mobility is only available for repo-backed workspaces.",
      ...mobilityBlockerCopy({
        code: "repo_required",
        direction,
      }),
    };
    return buildBlockedPrompt({
      direction,
      blocker,
    });
  }

  if (args.locationKind === "cloud_workspace" && !args.hasLocalRepoRoot) {
    const blocker = {
      code: "local_repo_required" as const,
      rawMessage: "This repo isn't available locally yet.",
      ...mobilityBlockerCopy({
        code: "local_repo_required",
        direction,
      }),
    };
    return buildBlockedPrompt({
      direction,
      blocker,
    });
  }

  if (
    args.isPreparing
    || ((args.canMoveToCloud || args.canBringBackLocal) && !args.confirmSnapshot && !args.hasResolvedPrompt)
  ) {
    return {
      variant: "loading",
      direction,
      headline: `Checking ${mobilityLocationLabel(args.locationKind).toLowerCase()} move`,
      body: "Gathering the details for this workspace move.",
      helper: null,
      actionLabel: null,
      warning: null,
      blocker: null,
      primaryActionKind: null,
    };
  }

  if (args.preparationError) {
    return buildPreparationFailurePrompt({
      direction,
      errorMessage: args.preparationError,
    });
  }

  if (!args.confirmSnapshot) {
    const blocker = {
      code: "unknown" as const,
      rawMessage: "Workspace move details couldn't be loaded.",
      headline: args.canBringBackLocal
        ? "Can't bring this workspace back local yet"
        : "Can't move this workspace to cloud yet",
      body: "Workspace move details couldn't be loaded.",
      helper: "Try again in a moment.",
      actionLabel: "Try again",
    };
    return buildBlockedPrompt({
      direction,
      blocker,
      primaryActionKind: "retry_prepare",
    });
  }

  let primaryBlocker = pickPrimaryMobilityBlocker({
    sourcePreflight: args.confirmSnapshot?.sourcePreflight ?? null,
    cloudPreflight: args.confirmSnapshot?.cloudPreflight ?? null,
    direction,
    branchName,
  });

  const syncRecovery = resolveMobilitySyncRecovery({
    blocker: primaryBlocker,
    direction,
    branchName,
    gitSync: args.gitSync,
    isGitSyncResolved: args.isGitSyncResolved,
  });

  if (syncRecovery.kind === "loading") {
    const copy = mobilityBranchSyncLoadingCopy();
    return {
      variant: "loading",
      direction,
      headline: copy.headline,
      body: copy.body,
      helper: null,
      actionLabel: null,
      warning: null,
      blocker: null,
      primaryActionKind: null,
    };
  }

  primaryBlocker = syncRecovery.blocker;

  if (
    primaryBlocker
    || (args.confirmSnapshot && (!args.confirmSnapshot.sourcePreflight.canMove || !args.confirmSnapshot.cloudPreflight.canStart))
  ) {
    const blocker = primaryBlocker ?? {
      code: "unknown" as const,
      rawMessage: "This workspace can't move right now.",
      ...mobilityBlockerCopy({
        code: "unknown",
        direction,
      }),
    };
    const primaryActionKind: MobilityPromptPrimaryActionKind = blocker.code === "branch_not_published"
      ? "publish_branch"
      : blocker.code === "head_commit_not_published"
        ? "push_commits"
        : blocker.code === "github_account_required"
          ? "connect_github"
          : blocker.code === "cloud_repo_access"
            ? "manage_github_access"
            : null;
    const warning = summarizeBranchSyncRecoveryWarning({
      preflight: args.confirmSnapshot?.sourcePreflight ?? null,
      blockerCode: isDisplayMobilityBlockerCode(blocker.code) ? blocker.code : null,
      gitSync: args.gitSync,
    });

    return buildBlockedPrompt({
      direction,
      blocker,
      warning,
      primaryActionKind,
    });
  }

  return {
    variant: "actionable",
    direction: actionableCopy.direction,
    headline: actionableCopy.headline,
    body: actionableCopy.body,
    helper: null,
    actionLabel: actionableCopy.actionLabel,
    warning: summarizeNonMigratingState(args.confirmSnapshot?.sourcePreflight ?? null),
    blocker: null,
    primaryActionKind: "confirm_move",
  };
}
