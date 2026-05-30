import { describe, expect, it } from "vitest";
import { resolveMobilitySyncRecovery } from "@/lib/domain/workspaces/mobility/mobility-sync-recovery";

describe("resolveMobilitySyncRecovery", () => {
  const headMismatchBlocker = {
    code: "cloud_head_mismatch" as const,
    rawMessage: "The branch 'feature/workspace-mobility' on GitHub is not at the requested commit.",
    headline: "Can't move this workspace to cloud yet",
    body: "The branch 'feature/workspace-mobility' on GitHub is not at the requested commit.",
    helper: "Refresh local git status and try again.",
    actionLabel: "Got it",
  };

  it("stays loading until local git sync state is resolved", () => {
    const result = resolveMobilitySyncRecovery({
      blocker: headMismatchBlocker,
      direction: "local_to_cloud",
      branchName: "feature/workspace-mobility",
      gitSync: null,
      isGitSyncResolved: false,
    });

    expect(result.kind).toBe("loading");
  });

  it("waits for git status before allowing a blocker-free move", () => {
    const result = resolveMobilitySyncRecovery({
      blocker: null,
      direction: "cloud_to_local",
      branchName: "feature/workspace-mobility",
      gitSync: null,
      isGitSyncResolved: false,
    });

    expect(result.kind).toBe("loading");
  });

  it("synthesizes a dirty-workspace blocker from live git status", () => {
    const result = resolveMobilitySyncRecovery({
      blocker: null,
      direction: "cloud_to_local",
      branchName: "feature/workspace-mobility",
      gitSync: {
        upstreamBranch: "origin/feature/workspace-mobility",
        ahead: 0,
        behind: 0,
        clean: false,
      },
      isGitSyncResolved: true,
    });

    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") {
      throw new Error("expected resolved recovery result");
    }
    expect(result.blocker.code).toBe("workspace_dirty");
    expect(result.blocker.actionLabel).toBe("Prepare branch");
  });

  it("synthesizes a push blocker from ahead live git status", () => {
    const result = resolveMobilitySyncRecovery({
      blocker: null,
      direction: "local_to_cloud",
      branchName: "feature/workspace-mobility",
      gitSync: {
        upstreamBranch: "origin/feature/workspace-mobility",
        ahead: 1,
        behind: 0,
        clean: true,
      },
      isGitSyncResolved: true,
    });

    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") {
      throw new Error("expected resolved recovery result");
    }
    expect(result.blocker.code).toBe("head_commit_not_published");
    expect(result.blocker.actionLabel).toBe("Push and move");
  });

  it("maps ahead-only commits to head_commit_not_published", () => {
    const result = resolveMobilitySyncRecovery({
      blocker: headMismatchBlocker,
      direction: "local_to_cloud",
      branchName: "feature/workspace-mobility",
      gitSync: {
        upstreamBranch: "origin/feature/workspace-mobility",
        ahead: 2,
        behind: 0,
        clean: true,
      },
      isGitSyncResolved: true,
    });

    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") {
      throw new Error("expected resolved recovery result");
    }
    expect(result.blocker.code).toBe("head_commit_not_published");
    expect(result.blocker.actionLabel).toBe("Push and move");
  });

  it("lets dirty state win over branch publish recovery", () => {
    const result = resolveMobilitySyncRecovery({
      blocker: {
        ...headMismatchBlocker,
        code: "branch_not_published",
        rawMessage: "The branch 'feature/workspace-mobility' was not found on GitHub.",
      },
      direction: "local_to_cloud",
      branchName: "feature/workspace-mobility",
      gitSync: {
        upstreamBranch: null,
        ahead: 0,
        behind: 0,
        clean: false,
      },
      isGitSyncResolved: true,
    });

    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") {
      throw new Error("expected resolved recovery result");
    }
    expect(result.blocker.code).toBe("workspace_dirty");
    expect(result.blocker.actionLabel).toBe("Prepare branch");
  });

  it("lets dirty state win over head publish recovery", () => {
    const result = resolveMobilitySyncRecovery({
      blocker: headMismatchBlocker,
      direction: "local_to_cloud",
      branchName: "feature/workspace-mobility",
      gitSync: {
        upstreamBranch: "origin/feature/workspace-mobility",
        ahead: 2,
        behind: 0,
        clean: false,
      },
      isGitSyncResolved: true,
    });

    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") {
      throw new Error("expected resolved recovery result");
    }
    expect(result.blocker.code).toBe("workspace_dirty");
    expect(result.blocker.actionLabel).toBe("Prepare branch");
  });

  it("maps behind branches to branch_out_of_sync", () => {
    const result = resolveMobilitySyncRecovery({
      blocker: headMismatchBlocker,
      direction: "local_to_cloud",
      branchName: "feature/workspace-mobility",
      gitSync: {
        upstreamBranch: "origin/feature/workspace-mobility",
        ahead: 0,
        behind: 2,
        clean: true,
      },
      isGitSyncResolved: true,
    });

    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") {
      throw new Error("expected resolved recovery result");
    }
    expect(result.blocker.code).toBe("branch_out_of_sync");
    expect(result.blocker.actionLabel).toBe("Got it");
  });

  it("maps typed head-not-published blockers with behind state to manual sync", () => {
    const result = resolveMobilitySyncRecovery({
      blocker: {
        ...headMismatchBlocker,
        code: "head_commit_not_published",
      },
      direction: "cloud_to_local",
      branchName: "feature/workspace-mobility",
      gitSync: {
        upstreamBranch: "origin/feature/workspace-mobility",
        ahead: 0,
        behind: 1,
        clean: true,
      },
      isGitSyncResolved: true,
    });

    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") {
      throw new Error("expected resolved recovery result");
    }
    expect(result.blocker.code).toBe("branch_out_of_sync");
  });
});
