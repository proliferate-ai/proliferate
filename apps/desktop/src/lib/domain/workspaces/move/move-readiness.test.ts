import type { GitStatusSnapshot, WorkspaceMobilityPreflightResponse } from "@anyharness/sdk";
import type { WorkspaceMoveResponse } from "@proliferate/cloud-sdk";
import { describe, expect, it } from "vitest";
import { resolveMoveReadiness, type MoveDestinationState } from "./move-readiness";

describe("resolveMoveReadiness", () => {
  it("resolves safe for a clean, published, up-to-date branch", () => {
    const readiness = resolveMoveReadiness({
      gitStatus: gitStatus(),
      sourcePreflight: preflight(),
      destinationState: null,
      activeMove: null,
    });
    expect(readiness.kind).toBe("safe");
  });

  it("resolves push_required when the branch is ahead of upstream", () => {
    const readiness = resolveMoveReadiness({
      gitStatus: gitStatus({ ahead: 2 }),
      sourcePreflight: preflight(),
      destinationState: null,
      activeMove: null,
    });
    expect(readiness.kind).toBe("push_required");
  });

  it("resolves push_required when the branch has no upstream", () => {
    const readiness = resolveMoveReadiness({
      gitStatus: gitStatus({ upstreamBranch: null }),
      sourcePreflight: preflight(),
      destinationState: null,
      activeMove: null,
    });
    expect(readiness.kind).toBe("push_required");
  });

  it("resolves prepare_required with includeUnstagedDefault=true for a dirty tree", () => {
    const readiness = resolveMoveReadiness({
      gitStatus: gitStatus({ clean: false }),
      sourcePreflight: preflight({ canMove: false, blockers: [
        { code: "workspace_dirty", message: "Workspace must be committed and clean before moving" },
      ] }),
      destinationState: null,
      activeMove: null,
    });
    expect(readiness.kind).toBe("prepare_required");
    if (readiness.kind === "prepare_required") {
      expect(readiness.includeUnstagedDefault).toBe(true);
    }
  });

  it("does not treat a dirty-only preflight (workspace_dirty) as a strict blocker", () => {
    // workspace_dirty always makes canMove=false on the engine (dirty must always be
    // resolved before the archive can be exported), but it must downgrade to
    // prepare_required rather than block outright -- that's the whole point of git prep.
    const readiness = resolveMoveReadiness({
      gitStatus: gitStatus({ clean: false }),
      sourcePreflight: preflight({
        canMove: false,
        blockers: [{ code: "workspace_dirty", message: "dirty" }],
      }),
      destinationState: null,
      activeMove: null,
    });
    expect(readiness.kind).toBe("prepare_required");
  });

  it.each([
    ["session_running", "A session is running"],
    ["session_awaiting_interaction", "A session needs your input"],
    ["pending_prompt", "A session needs your input"],
  ] as const)("blocks on strict preflight blocker %s", (code, headline) => {
    const readiness = resolveMoveReadiness({
      gitStatus: gitStatus(),
      sourcePreflight: preflight({
        canMove: false,
        blockers: [{ code, message: "blocked" }],
      }),
      destinationState: null,
      activeMove: null,
    });
    expect(readiness.kind).toBe("blocked");
    if (readiness.kind === "blocked") {
      expect(readiness.blockerCode).toBe(code);
      expect(readiness.copy.headline).toBe(headline);
    }
  });

  it("blocks on a detached HEAD", () => {
    const readiness = resolveMoveReadiness({
      gitStatus: gitStatus({ detached: true }),
      sourcePreflight: preflight(),
      destinationState: null,
      activeMove: null,
    });
    expect(readiness.kind).toBe("blocked");
    if (readiness.kind === "blocked") {
      expect(readiness.blockerCode).toBe("workspace_detached");
    }
  });

  it("blocks on merge conflicts", () => {
    const readiness = resolveMoveReadiness({
      gitStatus: gitStatus({ conflicted: true }),
      sourcePreflight: preflight(),
      destinationState: null,
      activeMove: null,
    });
    expect(readiness.kind).toBe("blocked");
    if (readiness.kind === "blocked") {
      expect(readiness.blockerCode).toBe("workspace_conflicted");
    }
  });

  it("blocks on an in-progress git operation", () => {
    const readiness = resolveMoveReadiness({
      gitStatus: gitStatus({ operation: "rebase" }),
      sourcePreflight: preflight(),
      destinationState: null,
      activeMove: null,
    });
    expect(readiness.kind).toBe("blocked");
    if (readiness.kind === "blocked") {
      expect(readiness.blockerCode).toBe("git_operation_in_progress");
    }
  });

  it("blocks when behind upstream", () => {
    const readiness = resolveMoveReadiness({
      gitStatus: gitStatus({ behind: 1 }),
      sourcePreflight: preflight(),
      destinationState: null,
      activeMove: null,
    });
    expect(readiness.kind).toBe("blocked");
    if (readiness.kind === "blocked") {
      expect(readiness.blockerCode).toBe("behind_upstream");
    }
  });

  it("blocks when an active non-terminal move already exists", () => {
    for (const phase of ["started", "destination_ready", "installed", "cutover"] as const) {
      const readiness = resolveMoveReadiness({
        gitStatus: gitStatus(),
        sourcePreflight: preflight(),
        destinationState: null,
        activeMove: move({ phase }),
      });
      expect(readiness.kind).toBe("blocked");
      if (readiness.kind === "blocked") {
        expect(readiness.blockerCode).toBe("active_move");
      }
    }
  });

  it("ignores a terminal (completed/failed) prior move", () => {
    for (const phase of ["completed", "failed"] as const) {
      const readiness = resolveMoveReadiness({
        gitStatus: gitStatus(),
        sourcePreflight: preflight(),
        destinationState: null,
        activeMove: move({ phase }),
      });
      expect(readiness.kind).not.toBe("blocked");
    }
  });

  it("active move takes precedence over other blockers", () => {
    const readiness = resolveMoveReadiness({
      gitStatus: gitStatus({ detached: true }),
      sourcePreflight: preflight(),
      destinationState: null,
      activeMove: move({ phase: "installed" }),
    });
    expect(readiness.kind).toBe("blocked");
    if (readiness.kind === "blocked") {
      expect(readiness.blockerCode).toBe("active_move");
    }
  });

  it("blocks (status_loading) while git status hasn't loaded yet", () => {
    const readiness = resolveMoveReadiness({
      gitStatus: null,
      sourcePreflight: preflight(),
      destinationState: null,
      activeMove: null,
    });
    expect(readiness.kind).toBe("blocked");
    if (readiness.kind === "blocked") {
      expect(readiness.blockerCode).toBe("status_loading");
    }
  });

  it("blocks (status_loading) while source preflight hasn't loaded yet", () => {
    const readiness = resolveMoveReadiness({
      gitStatus: gitStatus(),
      sourcePreflight: null,
      destinationState: null,
      activeMove: null,
    });
    expect(readiness.kind).toBe("blocked");
    if (readiness.kind === "blocked") {
      expect(readiness.blockerCode).toBe("status_loading");
    }
  });

  it("blocks when the destination isn't ready", () => {
    const destinationState: MoveDestinationState = {
      ready: false,
      blockerCode: "destination_head_mismatch",
      blockerMessage: "The destination cannot check out the exact commit yet.",
    };
    const readiness = resolveMoveReadiness({
      gitStatus: gitStatus(),
      sourcePreflight: preflight(),
      destinationState,
      activeMove: null,
    });
    expect(readiness.kind).toBe("blocked");
    if (readiness.kind === "blocked") {
      expect(readiness.blockerCode).toBe("destination_head_mismatch");
      expect(readiness.copy.body).toBe(destinationState.blockerMessage);
    }
  });

  it("does not block when the destination reports ready", () => {
    const readiness = resolveMoveReadiness({
      gitStatus: gitStatus(),
      sourcePreflight: preflight(),
      destinationState: { ready: true, blockerCode: "", blockerMessage: "" },
      activeMove: null,
    });
    expect(readiness.kind).toBe("safe");
  });

  it("defaults the safe-state primary action to 'Move to cloud' when direction is omitted", () => {
    const readiness = resolveMoveReadiness({
      gitStatus: gitStatus(),
      sourcePreflight: preflight(),
      destinationState: null,
      activeMove: null,
    });
    expect(readiness.kind).toBe("safe");
    if (readiness.kind === "safe") {
      expect(readiness.copy.primaryActionLabel).toBe("Move to cloud");
    }
  });

  it("names the mirror direction in the safe-state primary action", () => {
    const readiness = resolveMoveReadiness({
      gitStatus: gitStatus(),
      sourcePreflight: preflight(),
      destinationState: null,
      activeMove: null,
      direction: "cloud_to_local",
    });
    expect(readiness.kind).toBe("safe");
    if (readiness.kind === "safe") {
      expect(readiness.copy.primaryActionLabel).toBe("Move to this Mac");
    }
  });
});

function gitStatus(overrides: Partial<GitStatusSnapshot> = {}): GitStatusSnapshot {
  return {
    actions: {
      canCommit: true,
      canCreateBranchWorkspace: true,
      canCreateDraftPullRequest: true,
      canCreatePullRequest: true,
      canPush: true,
      pushLabel: "Push",
      reasonIfBlocked: null,
    },
    ahead: 0,
    behind: 0,
    clean: true,
    conflicted: false,
    currentBranch: "feature/move",
    detached: false,
    files: [],
    headOid: "abc123",
    operation: "none",
    repoRootPath: "/repo",
    suggestedBaseBranch: null,
    summary: { additions: 0, changedFiles: 0, conflictedFiles: 0, deletions: 0, includedFiles: 0 },
    upstreamBranch: "origin/feature/move",
    workspaceId: "workspace-1",
    workspacePath: "/repo/worktree",
    ...overrides,
  };
}

function preflight(
  overrides: Partial<WorkspaceMobilityPreflightResponse> = {},
): WorkspaceMobilityPreflightResponse {
  return {
    canMove: true,
    blockers: [],
    warnings: [],
    branchName: "feature/move",
    baseCommitSha: "abc123",
    archiveEstimatedBytes: 1024,
    runtimeState: {
      mode: "normal",
      handoffOpId: null,
      updatedAt: "2026-07-02T00:00:00Z",
      workspaceId: "workspace-1",
    },
    sessions: [],
    workspaceId: "workspace-1",
    ...overrides,
  };
}

function move(overrides: Partial<WorkspaceMoveResponse> = {}): WorkspaceMoveResponse {
  return {
    id: "move-1",
    repoConfigId: "repo-1",
    branch: "feature/move",
    sourceKind: "local",
    destinationKind: "cloud",
    sourceRef: {},
    destinationRef: {},
    baseCommitSha: "abc123",
    phase: "started",
    canonicalSide: "source",
    failureCode: null,
    failureDetail: null,
    idempotencyKey: "idem-1",
    createdAt: "2026-07-02T00:00:00Z",
    updatedAt: "2026-07-02T00:00:00Z",
    cutoverAt: null,
    completedAt: null,
    ...overrides,
  };
}
