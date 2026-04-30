import type { WorkspaceMobilityConfirmSnapshot } from "@/stores/workspaces/workspace-mobility-ui-store";
import {
  isWorkspaceMobilityTransitionPhase,
  type WorkspaceMobilityStatusModel,
} from "@/lib/domain/workspaces/mobility-state-machine";
import type { WorkspaceMobilityDirection } from "@/stores/workspaces/workspace-mobility-ui-store";
import {
  mobilityActionableCopy,
  mobilityBlockerCopy,
  mobilityBranchSyncLoadingCopy,
  mobilityLocationLabel,
  type WorkspaceMobilityBlockerCode,
  type WorkspaceMobilityLocationKind,
} from "@/config/mobility-copy";
import {
  pickPrimaryMobilityBlocker,
  type WorkspaceMobilityPrimaryBlocker,
} from "@/lib/domain/workspaces/mobility-blockers";
import {
  isDisplayMobilityBlockerCode,
  resolveMobilitySyncRecovery,
  type LocalGitSyncSnapshot,
} from "@/lib/domain/workspaces/mobility-sync-recovery";
import {
  summarizeBranchSyncRecoveryWarning,
  summarizeNonMigratingState,
} from "@/lib/domain/workspaces/mobility-warnings";

export type MobilityPromptVariant =
  | "loading"
  | "actionable"
  | "blocked"
  | "in_flight"
  | "terminal_failure";

export type MobilityPromptPrimaryActionKind =
  | "confirm_move"
  | "connect_github"
  | "manage_github_access"
  | "publish_branch"
  | "push_commits"
  | "retry_prepare"
  | "retry_cleanup"
  | null;

export interface MobilityPromptState {
  variant: MobilityPromptVariant;
  direction: WorkspaceMobilityDirection | null;
  headline: string;
  body: string;
  helper: string | null;
  actionLabel: string | null;
  secondaryActionLabel: string | null;
  warning: string | null;
  blocker: WorkspaceMobilityPrimaryBlocker | null;
  primaryActionKind: MobilityPromptPrimaryActionKind;
}

export function isMobilityPromptPrimaryActionPending(
  prompt: MobilityPromptState,
  pending: {
    isMobilityPending: boolean;
    isBranchSyncing: boolean;
  },
): boolean {
  switch (prompt.primaryActionKind) {
    case "publish_branch":
    case "push_commits":
      return pending.isBranchSyncing;
    case "retry_cleanup":
      return pending.isMobilityPending;
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
    secondaryActionLabel: null,
    warning: args.warning ?? null,
    blocker: args.blocker,
    primaryActionKind,
  };
}

function buildTerminalFailurePrompt(args: {
  direction: WorkspaceMobilityDirection | null;
  blockerCode: WorkspaceMobilityBlockerCode;
  rawMessage: string | null;
  primaryActionKind: Exclude<MobilityPromptPrimaryActionKind, "confirm_move" | "publish_branch" | "push_commits" | null>;
}): MobilityPromptState {
  const blocker = {
    code: args.blockerCode,
    rawMessage: args.rawMessage ?? "",
    ...mobilityBlockerCopy({
      code: args.blockerCode,
      direction: args.direction,
      rawMessage: args.rawMessage,
    }),
  };

  return {
    variant: "terminal_failure",
    direction: args.direction,
    headline: blocker.headline,
    body: args.rawMessage?.trim() || blocker.body,
    helper: blocker.helper,
    actionLabel: blocker.actionLabel,
    secondaryActionLabel: null,
    warning: null,
    blocker,
    primaryActionKind: args.primaryActionKind,
  };
}

export function buildMobilityPromptState(args: {
  isPreparing: boolean;
  hasResolvedPrompt: boolean;
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

  if (
    args.selectionLocked
    && isWorkspaceMobilityTransitionPhase(args.status.phase)
  ) {
    return {
      variant: "in_flight",
      direction: args.status.direction,
      headline: args.status.direction === "cloud_to_local"
        ? "Bringing workspace back local"
        : "Moving workspace to cloud",
      body: args.status.description ?? "The move is still in progress.",
      helper: null,
      actionLabel: null,
      secondaryActionLabel: null,
      warning: null,
      blocker: null,
      primaryActionKind: null,
    };
  }

  if (args.status.phase === "cleanup_failed") {
    return buildTerminalFailurePrompt({
      direction: args.status.direction,
      blockerCode: "cleanup_failed",
      rawMessage: args.status.description,
      primaryActionKind: "retry_cleanup",
    });
  }

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

  if (args.status.phase === "failed" && !args.isPreparing && !args.confirmSnapshot) {
    return buildTerminalFailurePrompt({
      direction: args.status.direction,
      blockerCode: args.status.direction === null ? "cloud_lost" : "handoff_failed",
      rawMessage: args.status.description,
      primaryActionKind: "retry_prepare",
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
      secondaryActionLabel: null,
      warning: null,
      blocker: null,
      primaryActionKind: null,
    };
  }

  if ((args.canMoveToCloud || args.canBringBackLocal) && !args.confirmSnapshot) {
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
      secondaryActionLabel: null,
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
    secondaryActionLabel: null,
    warning: summarizeNonMigratingState(args.confirmSnapshot?.sourcePreflight ?? null),
    blocker: null,
    primaryActionKind: "confirm_move",
  };
}
