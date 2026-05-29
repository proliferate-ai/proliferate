import { describe, expect, it } from "vitest";
import { buildMobilityPromptState } from "@/lib/domain/workspaces/mobility/mobility-prompt";
import type { WorkspaceMobilityStatusModel } from "@/lib/domain/workspaces/mobility/mobility-state-machine";
import type { LocalGitSyncSnapshot } from "@/lib/domain/workspaces/mobility/mobility-sync-recovery";
import type { WorkspaceMobilityConfirmSnapshot } from "@/lib/domain/workspaces/mobility/types";

function makeStatus(overrides: Partial<WorkspaceMobilityStatusModel> = {}): WorkspaceMobilityStatusModel {
  return {
    direction: null,
    phase: "idle",
    activeHandoff: null,
    title: null,
    description: null,
    isBlocking: false,
    isFailure: false,
    canRetryCleanup: false,
    ...overrides,
  };
}

function makeSnapshot(
  overrides: Partial<WorkspaceMobilityConfirmSnapshot> = {},
): WorkspaceMobilityConfirmSnapshot {
  return {
    logicalWorkspaceId: "logical-1",
    direction: "local_to_cloud",
    sourceWorkspaceId: "workspace-1",
    mobilityWorkspaceId: "mobility-1",
    sourcePreflight: {
      canMove: true,
      branchName: "feature/workspace-mobility",
      baseCommitSha: "abc123456789",
      blockers: [],
      warnings: [],
      sessions: [],
    } as never,
    cloudPreflight: {
      canStart: true,
      blockers: [],
      excludedPaths: [],
      workspace: {} as never,
    },
    ...overrides,
  };
}

const CLEAN_GIT_SYNC: LocalGitSyncSnapshot = {
  upstreamBranch: "origin/feature/workspace-mobility",
  ahead: 0,
  behind: 0,
  clean: true,
};

describe("buildMobilityPromptState", () => {
  it("blocks non repo-backed workspaces immediately", () => {
    const prompt = buildMobilityPromptState({
      isPreparing: false,
      hasResolvedPrompt: false,
      preparationError: null,
      locationKind: "local_workspace",
      repoBacked: false,
      canMoveToCloud: false,
      canBringBackLocal: false,
      hasLocalRepoRoot: false,
      selectionLocked: false,
      status: makeStatus(),
      confirmSnapshot: null,
      gitSync: null,
      isGitSyncResolved: true,
    });

    expect(prompt.variant).toBe("blocked");
    expect(prompt.body).toBe("Workspace mobility is only available for repo-backed workspaces.");
  });

  it("surfaces a concise non-migrating warning for actionable prompts", () => {
    const prompt = buildMobilityPromptState({
      isPreparing: false,
      hasResolvedPrompt: true,
      preparationError: null,
      locationKind: "local_worktree",
      repoBacked: true,
      canMoveToCloud: true,
      canBringBackLocal: false,
      hasLocalRepoRoot: true,
      selectionLocked: false,
      status: makeStatus(),
      confirmSnapshot: makeSnapshot({
        sourcePreflight: {
          canMove: true,
          branchName: "feature/workspace-mobility",
          baseCommitSha: "abc123456789",
          blockers: [],
          warnings: ["Terminal abc will not migrate"],
          sessions: [],
        } as never,
      }),
      gitSync: CLEAN_GIT_SYNC,
      isGitSyncResolved: true,
    });

    expect(prompt.variant).toBe("actionable");
    expect(prompt.warning).toBe("Active terminals will stay here.");
  });

  it("keeps cleanup failures out of the prompt recovery surface", () => {
    const prompt = buildMobilityPromptState({
      isPreparing: false,
      hasResolvedPrompt: true,
      preparationError: null,
      locationKind: "cloud_workspace",
      repoBacked: true,
      canMoveToCloud: false,
      canBringBackLocal: true,
      hasLocalRepoRoot: true,
      selectionLocked: false,
      status: makeStatus({
        direction: "local_to_cloud",
        phase: "cleanup_failed",
        description: "Source cleanup needs another pass.",
        canRetryCleanup: true,
      }),
      confirmSnapshot: null,
      gitSync: null,
      isGitSyncResolved: true,
    });

    expect(prompt.variant).toBe("blocked");
    expect(prompt.actionLabel).toBe("Try again");
    expect(prompt.body).toBe("Workspace move details couldn't be loaded.");
    expect(prompt.primaryActionKind).toBe("retry_prepare");
  });

  it("does not memorialize previous handoff failures in the prompt", () => {
    const prompt = buildMobilityPromptState({
      isPreparing: false,
      hasResolvedPrompt: true,
      preparationError: null,
      locationKind: "cloud_workspace",
      repoBacked: true,
      canMoveToCloud: false,
      canBringBackLocal: true,
      hasLocalRepoRoot: true,
      selectionLocked: false,
      status: makeStatus({
        direction: null,
        phase: "failed",
        description: "Cloud workspace heartbeat timed out.",
      }),
      confirmSnapshot: null,
      gitSync: null,
      isGitSyncResolved: true,
    });

    expect(prompt.variant).toBe("blocked");
    expect(prompt.blocker?.code).toBe("unknown");
    expect(prompt.body).toBe("Workspace move details couldn't be loaded.");
    expect(prompt.primaryActionKind).toBe("retry_prepare");
  });

  it("shows cloud sign-in preparation failures in the card with sign-in recovery", () => {
    const prompt = buildMobilityPromptState({
      isPreparing: false,
      hasResolvedPrompt: true,
      preparationError: "You must sign in to use cloud workspaces.",
      locationKind: "local_worktree",
      repoBacked: true,
      canMoveToCloud: true,
      canBringBackLocal: false,
      hasLocalRepoRoot: true,
      selectionLocked: false,
      status: makeStatus(),
      confirmSnapshot: null,
      gitSync: null,
      isGitSyncResolved: true,
    });

    expect(prompt.variant).toBe("blocked");
    expect(prompt.body).toBe("You must sign in to use cloud workspaces.");
    expect(prompt.helper).toBe("Sign in, then try the move again.");
    expect(prompt.actionLabel).toBe("Sign in");
    expect(prompt.primaryActionKind).toBe("connect_github");
  });

  it("shows loading instead of stale failure while retry preparation is running", () => {
    const prompt = buildMobilityPromptState({
      isPreparing: true,
      hasResolvedPrompt: false,
      preparationError: null,
      locationKind: "local_workspace",
      repoBacked: true,
      canMoveToCloud: true,
      canBringBackLocal: false,
      hasLocalRepoRoot: true,
      selectionLocked: false,
      status: makeStatus({
        direction: "local_to_cloud",
        phase: "failed",
        description: "Sync a supported cloud credential before starting a cloud workspace.",
      }),
      confirmSnapshot: null,
      gitSync: null,
      isGitSyncResolved: true,
    });

    expect(prompt.variant).toBe("loading");
    expect(prompt.primaryActionKind).toBeNull();
  });

  it("lets a fresh confirmation snapshot override a previous handoff failure", () => {
    const prompt = buildMobilityPromptState({
      isPreparing: false,
      hasResolvedPrompt: true,
      preparationError: null,
      locationKind: "local_workspace",
      repoBacked: true,
      canMoveToCloud: true,
      canBringBackLocal: false,
      hasLocalRepoRoot: true,
      selectionLocked: false,
      status: makeStatus({
        direction: "local_to_cloud",
        phase: "failed",
        description: "Sync a supported cloud credential before starting a cloud workspace.",
      }),
      confirmSnapshot: makeSnapshot(),
      gitSync: CLEAN_GIT_SYNC,
      isGitSyncResolved: true,
    });

    expect(prompt.variant).toBe("actionable");
    expect(prompt.primaryActionKind).toBe("confirm_move");
  });

  it("keeps the prompt loading while local git sync state is still resolving", () => {
    const prompt = buildMobilityPromptState({
      isPreparing: false,
      hasResolvedPrompt: true,
      preparationError: null,
      locationKind: "local_worktree",
      repoBacked: true,
      canMoveToCloud: true,
      canBringBackLocal: false,
      hasLocalRepoRoot: true,
      selectionLocked: false,
      status: makeStatus(),
      confirmSnapshot: makeSnapshot({
        cloudPreflight: {
          canStart: false,
          blockers: ["The branch 'feature/workspace-mobility' on GitHub is not at the requested commit."],
          excludedPaths: [],
          workspace: {} as never,
        },
      }),
      gitSync: null,
      isGitSyncResolved: false,
    });

    expect(prompt.variant).toBe("loading");
    expect(prompt.headline).toBe("Checking local branch sync");
  });

  it("shows a publish CTA when the branch is not on GitHub", () => {
    const prompt = buildMobilityPromptState({
      isPreparing: false,
      hasResolvedPrompt: true,
      preparationError: null,
      locationKind: "local_worktree",
      repoBacked: true,
      canMoveToCloud: true,
      canBringBackLocal: false,
      hasLocalRepoRoot: true,
      selectionLocked: false,
      status: makeStatus(),
      confirmSnapshot: makeSnapshot({
        cloudPreflight: {
          canStart: false,
          blockers: ["The branch 'feature/workspace-mobility' was not found on GitHub."],
          excludedPaths: [],
          workspace: {} as never,
        },
      }),
      gitSync: {
        upstreamBranch: null,
        ahead: 0,
        behind: 0,
        clean: false,
      },
      isGitSyncResolved: true,
    });

    expect(prompt.variant).toBe("blocked");
    expect(prompt.primaryActionKind).toBe("publish_branch");
    expect(prompt.actionLabel).toBe("Publish branch");
    expect(prompt.warning).toBe("Uncommitted changes will move with the workspace after this branch is synced.");
  });

  it("shows a GitHub connect CTA when no GitHub account is linked", () => {
    const prompt = buildMobilityPromptState({
      isPreparing: false,
      hasResolvedPrompt: true,
      preparationError: null,
      locationKind: "local_worktree",
      repoBacked: true,
      canMoveToCloud: true,
      canBringBackLocal: false,
      hasLocalRepoRoot: true,
      selectionLocked: false,
      status: makeStatus(),
      confirmSnapshot: makeSnapshot({
        cloudPreflight: {
          canStart: false,
          blockers: ["Connect a GitHub account before moving this workspace to cloud."],
          excludedPaths: [],
          workspace: {} as never,
        },
      }),
      gitSync: CLEAN_GIT_SYNC,
      isGitSyncResolved: true,
    });

    expect(prompt.variant).toBe("blocked");
    expect(prompt.primaryActionKind).toBe("connect_github");
    expect(prompt.actionLabel).toBe("Connect GitHub");
  });

  it("shows a GitHub access CTA when repo authorization is missing", () => {
    const prompt = buildMobilityPromptState({
      isPreparing: false,
      hasResolvedPrompt: true,
      preparationError: null,
      locationKind: "local_worktree",
      repoBacked: true,
      canMoveToCloud: true,
      canBringBackLocal: false,
      hasLocalRepoRoot: true,
      selectionLocked: false,
      status: makeStatus(),
      confirmSnapshot: makeSnapshot({
        cloudPreflight: {
          canStart: false,
          blockers: ["Reconnect GitHub and grant repository access before moving this workspace to cloud."],
          excludedPaths: [],
          workspace: {} as never,
        },
      }),
      gitSync: CLEAN_GIT_SYNC,
      isGitSyncResolved: true,
    });

    expect(prompt.variant).toBe("blocked");
    expect(prompt.primaryActionKind).toBe("manage_github_access");
    expect(prompt.actionLabel).toBe("Manage GitHub access");
    expect(prompt.body).toBe("GitHub access for this repo is not authorized.");
  });

  it("shows a push CTA for ahead-only local commits", () => {
    const prompt = buildMobilityPromptState({
      isPreparing: false,
      hasResolvedPrompt: true,
      preparationError: null,
      locationKind: "local_worktree",
      repoBacked: true,
      canMoveToCloud: true,
      canBringBackLocal: false,
      hasLocalRepoRoot: true,
      selectionLocked: false,
      status: makeStatus(),
      confirmSnapshot: makeSnapshot({
        cloudPreflight: {
          canStart: false,
          blockers: ["The branch 'feature/workspace-mobility' on GitHub is not at the requested commit."],
          excludedPaths: [],
          workspace: {} as never,
        },
      }),
      gitSync: {
        upstreamBranch: "origin/feature/workspace-mobility",
        ahead: 2,
        behind: 0,
        clean: false,
      },
      isGitSyncResolved: true,
    });

    expect(prompt.variant).toBe("blocked");
    expect(prompt.primaryActionKind).toBe("push_commits");
    expect(prompt.actionLabel).toBe("Push commits");
    expect(prompt.warning).toBe("Uncommitted changes will move with the workspace after this branch is synced.");
  });
});
