import { describe, expect, it } from "vitest";
import {
  findLocalMoveDestinationCandidateWorkspace,
  resolveLocalMoveDestinationPlan,
  resolveLocalMoveDestinationState,
  type LocalWorkspaceForBranchLookup,
} from "./move-destination";

describe("findLocalMoveDestinationCandidateWorkspace", () => {
  const workspaces: LocalWorkspaceForBranchLookup[] = [
    { workspaceId: "ws-1", repoRootId: "repo-1", currentBranch: "feature/move" },
    { workspaceId: "ws-2", repoRootId: "repo-1", currentBranch: "main" },
    { workspaceId: "ws-3", repoRootId: "repo-2", currentBranch: "feature/move" },
  ];

  it("finds the workspace matching both repoRootId and branch", () => {
    const found = findLocalMoveDestinationCandidateWorkspace(workspaces, "repo-1", "feature/move");
    expect(found?.workspaceId).toBe("ws-1");
  });

  it("does not match a workspace on the right repo but wrong branch", () => {
    expect(findLocalMoveDestinationCandidateWorkspace(workspaces, "repo-1", "other-branch")).toBeNull();
  });

  it("does not match a workspace on the right branch but wrong repo root", () => {
    const found = findLocalMoveDestinationCandidateWorkspace(workspaces, "repo-2", "feature/move");
    expect(found?.workspaceId).toBe("ws-3");
  });

  it("tolerates surrounding whitespace on the branch", () => {
    const found = findLocalMoveDestinationCandidateWorkspace(workspaces, "repo-1", "  feature/move  ");
    expect(found?.workspaceId).toBe("ws-1");
  });

  it("returns null without a repoRootId", () => {
    expect(findLocalMoveDestinationCandidateWorkspace(workspaces, null, "feature/move")).toBeNull();
  });

  it("returns null without a branch", () => {
    expect(findLocalMoveDestinationCandidateWorkspace(workspaces, "repo-1", null)).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(findLocalMoveDestinationCandidateWorkspace(workspaces, "repo-9", "feature/move")).toBeNull();
  });
});

describe("resolveLocalMoveDestinationPlan", () => {
  it("prepares fresh when there is no candidate", () => {
    expect(resolveLocalMoveDestinationPlan(null)).toEqual({ mode: "prepare_fresh" });
  });

  it("re-adopts a remote_owned candidate -- the round-trip case", () => {
    expect(
      resolveLocalMoveDestinationPlan({ workspaceId: "ws-1", runtimeStateMode: "remote_owned" }),
    ).toEqual({ mode: "re_adopt", workspaceId: "ws-1" });
  });

  it.each([
    ["normal", "an active workspace is a real collision, not a re-adopt target"],
    ["frozen_for_handoff", "mid-handoff for something else"],
    ["repair_blocked", "needs repair before it can be touched"],
    [null, "runtime-state hasn't loaded yet"],
  ] as const)("prepares fresh for a %s candidate (%s)", (mode, _description) => {
    expect(
      resolveLocalMoveDestinationPlan({ workspaceId: "ws-1", runtimeStateMode: mode }),
    ).toEqual({ mode: "prepare_fresh" });
  });
});

describe("resolveLocalMoveDestinationState", () => {
  it("is ready with no candidate when the repo is cloned locally -- prepares a fresh worktree", () => {
    expect(
      resolveLocalMoveDestinationState({
        candidate: null,
        candidatePreflightLoading: false,
        hasLocalRepoRoot: true,
      }),
    ).toEqual({ ready: true, blockerCode: "", blockerMessage: "" });
  });

  it("is ready to re-adopt a remote_owned candidate -- the round-trip case", () => {
    expect(
      resolveLocalMoveDestinationState({
        candidate: { workspaceId: "ws-1", runtimeStateMode: "remote_owned" },
        candidatePreflightLoading: false,
        hasLocalRepoRoot: true,
      }),
    ).toEqual({ ready: true, blockerCode: "", blockerMessage: "" });
  });

  it("blocks (local_branch_already_checked_out) on a live normal-mode collision", () => {
    const state = resolveLocalMoveDestinationState({
      candidate: { workspaceId: "ws-1", runtimeStateMode: "normal" },
      candidatePreflightLoading: false,
      hasLocalRepoRoot: true,
    });
    expect(state.ready).toBe(false);
    expect(state.blockerCode).toBe("local_branch_already_checked_out");
  });

  it.each([
    ["frozen_for_handoff", "mid-handoff for something else"],
    ["repair_blocked", "needs repair before it can be touched"],
  ] as const)("blocks (local_branch_already_checked_out) on a %s candidate (%s)", (mode, _description) => {
    const state = resolveLocalMoveDestinationState({
      candidate: { workspaceId: "ws-1", runtimeStateMode: mode },
      candidatePreflightLoading: false,
      hasLocalRepoRoot: true,
    });
    expect(state.ready).toBe(false);
    expect(state.blockerCode).toBe("local_branch_already_checked_out");
  });

  it("blocks (status_loading) while the candidate's preflight is still in flight", () => {
    const state = resolveLocalMoveDestinationState({
      candidate: { workspaceId: "ws-1", runtimeStateMode: null },
      candidatePreflightLoading: true,
      hasLocalRepoRoot: true,
    });
    expect(state.ready).toBe(false);
    expect(state.blockerCode).toBe("status_loading");
  });

  it("blocks (local_repo_not_found) with no candidate when the repo isn't cloned locally", () => {
    const state = resolveLocalMoveDestinationState({
      candidate: null,
      candidatePreflightLoading: false,
      hasLocalRepoRoot: false,
    });
    expect(state.ready).toBe(false);
    expect(state.blockerCode).toBe("local_repo_not_found");
  });
});
