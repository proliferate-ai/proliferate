import type {
  RunWorktreeRetentionResponse,
  WorktreeRetentionRowOutcome,
  WorktreeRetentionRunRow,
} from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import { worktreeRetentionRunMessage } from "./worktree-settings-actions";

describe("worktreeRetentionRunMessage", () => {
  it("reports already-running cleanup", () => {
    expect(worktreeRetentionRunMessage(response({ alreadyRunning: true })))
      .toBe("Cleanup is already running.");
  });

  it("reports a run with no candidates", () => {
    expect(worktreeRetentionRunMessage(response()))
      .toBe("No checkouts are over the retention limit.");
  });

  it("reports retired checkouts and remaining eligible work", () => {
    expect(worktreeRetentionRunMessage(response({
      attemptedCount: 2,
      consideredCount: 2,
      moreEligibleRemaining: true,
      retiredCount: 2,
      rows: [
        row("retired", "checkout retired", "workspace-1"),
        row("retired", "checkout retired", "workspace-2"),
      ],
    }))).toBe("Retired 2 checkouts. Run cleanup again to continue.");
  });

  it("reports blocked candidates with the first row message", () => {
    expect(worktreeRetentionRunMessage(response({
      blockedCount: 1,
      consideredCount: 1,
      rows: [row("blocked", "workspace operation is in progress")],
    }))).toBe(
      "Cleanup found 1 candidate blocked by safety checks or active operations: workspace operation is in progress.",
    );
  });

  it("reports skipped rows before treating zero considered rows as no candidates", () => {
    expect(worktreeRetentionRunMessage(response({
      skippedCount: 1,
      rows: [row("skipped", "checkout is outside managed worktrees root")],
    }))).toBe(
      "Cleanup skipped 1 row that was not eligible for retention: checkout is outside managed worktrees root.",
    );
  });

  it("does not imply checkout deletion failed when no cleanup was attempted", () => {
    expect(worktreeRetentionRunMessage(response({
      consideredCount: 1,
      failedCount: 1,
      rows: [row("failed", "workspace eligibility check failed")],
    }))).toBe(
      "Cleanup could not evaluate 1 candidate: workspace eligibility check failed.",
    );
  });

  it("mentions attempted checkout cleanup for failures after attempts", () => {
    expect(worktreeRetentionRunMessage(response({
      attemptedCount: 1,
      consideredCount: 1,
      failedCount: 1,
      rows: [row("failed", "checkout cleanup failed")],
    }))).toBe(
      "Cleanup hit 1 failure after attempting checkout cleanup: checkout cleanup failed.",
    );
  });

  it("does not surface path-like row messages", () => {
    expect(worktreeRetentionRunMessage(response({
      consideredCount: 1,
      failedCount: 1,
      rows: [row("failed", "failed at /Users/example/private-checkout")],
    }))).toBe("Cleanup could not evaluate 1 candidate.");
  });

  it("summarizes mixed outcomes without hiding partial success", () => {
    expect(worktreeRetentionRunMessage(response({
      attemptedCount: 3,
      blockedCount: 1,
      consideredCount: 5,
      failedCount: 1,
      moreEligibleRemaining: true,
      retiredCount: 2,
      skippedCount: 1,
      rows: [
        row("retired", "checkout retired", "workspace-1"),
        row("retired", "checkout retired", "workspace-2"),
        row("blocked", "workspace operation is in progress", "workspace-3"),
        row("skipped", "checkout is outside managed worktrees root", "workspace-4"),
        row("failed", "workspace eligibility check failed", "workspace-5"),
      ],
    }))).toBe(
      "Cleanup hit 1 failure after attempting checkout cleanup: workspace eligibility check failed. 2 retired; 1 blocked; 1 skipped. Run cleanup again to continue.",
    );
  });
});

function response(
  overrides: Partial<RunWorktreeRetentionResponse> = {},
): RunWorktreeRetentionResponse {
  return {
    alreadyRunning: false,
    attemptedCount: 0,
    blockedCount: 0,
    consideredCount: 0,
    failedCount: 0,
    moreEligibleRemaining: false,
    policy: {
      maxMaterializedWorktreesPerRepo: 20,
      updatedAt: "2026-05-03T00:00:00Z",
    },
    retiredCount: 0,
    rows: [],
    skippedCount: 0,
    ...overrides,
  };
}

function row(
  outcome: WorktreeRetentionRowOutcome,
  message: string,
  workspaceId = "workspace-1",
): WorktreeRetentionRunRow {
  return {
    message,
    outcome,
    path: `/Users/example/worktrees/${workspaceId}`,
    repoRootId: "repo-root-1",
    workspaceId,
  };
}
