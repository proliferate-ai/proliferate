import type { WorkspaceMobilityArchive } from "@anyharness/sdk";
import type { StartWorkspaceMoveRequest, WorkspaceMoveResponse, WorkspaceMovePhase } from "@proliferate/cloud-sdk";
import { describe, expect, it, vi } from "vitest";
import { runWorkspaceMoveWorkflow } from "./run-workspace-move-workflow";

const START_REQUEST: StartWorkspaceMoveRequest = {
  repoConfigId: "repo-1",
  branch: "feature/move",
  baseCommitSha: "abc123",
  source: { kind: "local", desktopInstallId: "install-1", anyharnessWorkspaceId: "ws-1" },
  destination: { kind: "cloud" },
  idempotencyKey: "idem-1",
};

const ARCHIVE: WorkspaceMobilityArchive = {
  baseCommitSha: "abc123",
  files: [],
  repoRootPath: "/repo",
  sourceWorkspacePath: "/repo/worktree",
};

describe("runWorkspaceMoveWorkflow", () => {
  it("runs the full happy path and destroys a managed-worktree source", async () => {
    const calls: string[] = [];
    const deps = depsMock(calls);

    const result = await runWorkspaceMoveWorkflow(
      { start: START_REQUEST, sourceWorkspaceKind: "worktree" },
      deps,
    );

    expect(result).toEqual({ outcome: "completed", moveId: "move-1" });
    expect(calls).toEqual([
      "startMove",
      "freezeSource",
      "exportSourceArchive",
      "installArchive",
      "cutover",
      "destroySource",
      "completeMove",
    ]);
    expect(deps.markSourceRemoteOwned).not.toHaveBeenCalled();
    expect(deps.unfreezeSource).not.toHaveBeenCalled();
    expect(deps.failMove).not.toHaveBeenCalled();
  });

  it("marks a plain local-directory source remote_owned instead of destroying it", async () => {
    const calls: string[] = [];
    const deps = depsMock(calls);

    await runWorkspaceMoveWorkflow(
      { start: START_REQUEST, sourceWorkspaceKind: "local" },
      deps,
    );

    expect(calls).toContain("markSourceRemoteOwned");
    expect(calls).not.toContain("destroySource");
    expect(deps.destroySource).not.toHaveBeenCalled();
  });

  it("reports phase transitions via onPhaseChange", async () => {
    const deps = depsMock();
    await runWorkspaceMoveWorkflow({ start: START_REQUEST, sourceWorkspaceKind: "worktree" }, deps);

    expect(deps.onPhaseChange).toHaveBeenNthCalledWith(1, "destination_ready");
    expect(deps.onPhaseChange).toHaveBeenNthCalledWith(2, "installed");
    expect(deps.onPhaseChange).toHaveBeenNthCalledWith(3, "cutover");
    expect(deps.onPhaseChange).toHaveBeenNthCalledWith(4, "completed");
  });

  it("resumes from destination_ready without re-calling startMove", async () => {
    const calls: string[] = [];
    const deps = depsMock(calls);

    const result = await runWorkspaceMoveWorkflow(
      {
        start: START_REQUEST,
        sourceWorkspaceKind: "worktree",
        resume: { moveId: "move-1", phase: "destination_ready" },
      },
      deps,
    );

    expect(result).toEqual({ outcome: "completed", moveId: "move-1" });
    expect(calls).toEqual([
      "freezeSource",
      "exportSourceArchive",
      "installArchive",
      "cutover",
      "destroySource",
      "completeMove",
    ]);
    expect(deps.startMove).not.toHaveBeenCalled();
  });

  it("resumes from installed, skipping freeze/export/install", async () => {
    const calls: string[] = [];
    const deps = depsMock(calls);

    await runWorkspaceMoveWorkflow(
      {
        start: START_REQUEST,
        sourceWorkspaceKind: "worktree",
        resume: { moveId: "move-1", phase: "installed" },
      },
      deps,
    );

    expect(calls).toEqual(["cutover", "destroySource", "completeMove"]);
    expect(deps.freezeSource).not.toHaveBeenCalled();
    expect(deps.exportSourceArchive).not.toHaveBeenCalled();
    expect(deps.installArchive).not.toHaveBeenCalled();
  });

  it("resumes from cutover, only running cleanup + complete", async () => {
    const calls: string[] = [];
    const deps = depsMock(calls);

    const result = await runWorkspaceMoveWorkflow(
      {
        start: START_REQUEST,
        sourceWorkspaceKind: "worktree",
        resume: { moveId: "move-1", phase: "cutover" },
      },
      deps,
    );

    expect(result).toEqual({ outcome: "completed", moveId: "move-1" });
    expect(calls).toEqual(["destroySource", "completeMove"]);
    expect(deps.cutover).not.toHaveBeenCalled();
  });

  it("short-circuits immediately when resuming an already-completed move", async () => {
    const calls: string[] = [];
    const deps = depsMock(calls);

    const result = await runWorkspaceMoveWorkflow(
      {
        start: START_REQUEST,
        sourceWorkspaceKind: "worktree",
        resume: { moveId: "move-1", phase: "completed" },
      },
      deps,
    );

    expect(result).toEqual({ outcome: "completed", moveId: "move-1" });
    expect(calls).toEqual([]);
  });

  it("refuses to resume a failed move", async () => {
    const deps = depsMock();
    await expect(runWorkspaceMoveWorkflow(
      {
        start: START_REQUEST,
        sourceWorkspaceKind: "worktree",
        resume: { moveId: "move-1", phase: "failed" },
      },
      deps,
    )).rejects.toThrow(/Cannot resume a failed move/);
  });

  it("re-issues startMove (idempotent) when resuming a stalled 'started' row", async () => {
    const calls: string[] = [];
    const deps = depsMock(calls);

    await runWorkspaceMoveWorkflow(
      {
        start: START_REQUEST,
        sourceWorkspaceKind: "worktree",
        resume: { moveId: "move-1", phase: "started" },
      },
      deps,
    );

    expect(deps.startMove).toHaveBeenCalledOnce();
    expect(calls[0]).toBe("startMove");
  });

  it("on pre-cutover failure, unfreezes the source and fails the move without cutting over", async () => {
    const calls: string[] = [];
    const deps = depsMock(calls);
    const error = Object.assign(new Error("export refused: dirty tree"), { code: "workspace_dirty" });
    deps.exportSourceArchive.mockRejectedValueOnce(error);

    const result = await runWorkspaceMoveWorkflow(
      { start: START_REQUEST, sourceWorkspaceKind: "worktree" },
      deps,
    );

    expect(result).toEqual({
      outcome: "failed",
      moveId: "move-1",
      failureCode: "workspace_dirty",
      failureDetail: "export refused: dirty tree",
    });
    expect(deps.unfreezeSource).toHaveBeenCalledWith("move-1");
    expect(deps.failMove).toHaveBeenCalledWith("move-1", "workspace_dirty", "export refused: dirty tree");
    expect(deps.cutover).not.toHaveBeenCalled();
    expect(deps.installArchive).not.toHaveBeenCalled();
  });

  it("unfreezes but does not call failMove when startMove itself fails (no moveId yet)", async () => {
    const deps = depsMock();
    deps.startMove.mockRejectedValueOnce(new Error("network error"));

    const result = await runWorkspaceMoveWorkflow(
      { start: START_REQUEST, sourceWorkspaceKind: "worktree" },
      deps,
    );

    expect(result).toEqual({
      outcome: "failed",
      moveId: null,
      failureCode: "move_workflow_error",
      failureDetail: "network error",
    });
    expect(deps.unfreezeSource).toHaveBeenCalledWith(null);
    expect(deps.failMove).not.toHaveBeenCalled();
  });

  it("does not mask the triggering error when unfreeze/failMove cleanup itself throws", async () => {
    const deps = depsMock();
    deps.exportSourceArchive.mockRejectedValueOnce(new Error("export failed"));
    deps.unfreezeSource.mockRejectedValueOnce(new Error("unfreeze failed too"));
    deps.failMove.mockRejectedValueOnce(new Error("fail-move failed too"));

    const result = await runWorkspaceMoveWorkflow(
      { start: START_REQUEST, sourceWorkspaceKind: "worktree" },
      deps,
    );

    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") {
      expect(result.failureDetail).toBe("export failed");
    }
  });

  it("on post-cutover failure, propagates the error and does not unfreeze or fail the move", async () => {
    const deps = depsMock();
    deps.destroySource.mockRejectedValueOnce(new Error("destroy-source unreachable"));

    await expect(runWorkspaceMoveWorkflow(
      { start: START_REQUEST, sourceWorkspaceKind: "worktree" },
      deps,
    )).rejects.toThrow("destroy-source unreachable");

    expect(deps.unfreezeSource).not.toHaveBeenCalled();
    expect(deps.failMove).not.toHaveBeenCalled();
    expect(deps.completeMove).not.toHaveBeenCalled();
  });

  it("post-cutover failure on resume from cutover also propagates without touching failMove", async () => {
    const deps = depsMock();
    deps.completeMove.mockRejectedValueOnce(new Error("complete unreachable"));

    await expect(runWorkspaceMoveWorkflow(
      {
        start: START_REQUEST,
        sourceWorkspaceKind: "worktree",
        resume: { moveId: "move-1", phase: "cutover" },
      },
      deps,
    )).rejects.toThrow("complete unreachable");

    expect(deps.unfreezeSource).not.toHaveBeenCalled();
    expect(deps.failMove).not.toHaveBeenCalled();
  });
});

function depsMock(calls: string[] = []) {
  const moveAt = (phase: WorkspaceMovePhase): WorkspaceMoveResponse => ({
    id: "move-1",
    repoConfigId: "repo-1",
    branch: "feature/move",
    sourceKind: "local",
    destinationKind: "cloud",
    sourceRef: {},
    destinationRef: {},
    baseCommitSha: "abc123",
    phase,
    canonicalSide: phase === "cutover" || phase === "completed" ? "destination" : "source",
    failureCode: null,
    failureDetail: null,
    idempotencyKey: "idem-1",
    createdAt: "2026-07-02T00:00:00Z",
    updatedAt: "2026-07-02T00:00:00Z",
    cutoverAt: null,
    completedAt: null,
  });

  return {
    startMove: vi.fn(async () => {
      calls.push("startMove");
      return moveAt("destination_ready");
    }),
    freezeSource: vi.fn(async () => {
      calls.push("freezeSource");
    }),
    exportSourceArchive: vi.fn(async () => {
      calls.push("exportSourceArchive");
      return ARCHIVE;
    }),
    installArchive: vi.fn(async () => {
      calls.push("installArchive");
      return moveAt("installed");
    }),
    cutover: vi.fn(async () => {
      calls.push("cutover");
      return moveAt("cutover");
    }),
    destroySource: vi.fn(async () => {
      calls.push("destroySource");
    }),
    markSourceRemoteOwned: vi.fn(async () => {
      calls.push("markSourceRemoteOwned");
    }),
    unfreezeSource: vi.fn(async () => {
      calls.push("unfreezeSource");
    }),
    completeMove: vi.fn(async () => {
      calls.push("completeMove");
      return moveAt("completed");
    }),
    failMove: vi.fn(async () => {
      calls.push("failMove");
    }),
    onPhaseChange: vi.fn(),
  };
}
