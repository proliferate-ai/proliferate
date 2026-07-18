import { describe, expect, it } from "vitest";
import { worktreeRestoreFailureCopy } from "#product/copy/workspaces/workspace-availability-copy";

describe("worktreeRestoreFailureCopy", () => {
  it.each([
    ["WORKTREE_RESTORE_REPOSITORY_MISSING", /source repository/i],
    ["WORKTREE_RESTORE_BRANCH_MISSING", /recorded branch/i],
    ["WORKTREE_RESTORE_PARENT_UNAVAILABLE", /parent folder/i],
    ["WORKTREE_RESTORE_PATH_OCCUPIED", /will not overwrite/i],
    ["WORKTREE_RESTORE_REGISTRATION_CONFLICT", /registration/i],
    ["WORKTREE_RESTORE_BRANCH_CHECKED_OUT", /another worktree/i],
    ["WORKTREE_RESTORE_GIT_AMBIGUOUS", /stopped safely/i],
    ["WORKTREE_RESTORE_INELIGIBLE", /recorded repository and branch/i],
    ["WORKSPACE_NOT_FOUND", /refresh the workspace list/i],
    ["WORKSPACE_RETIRED", /no longer active/i],
  ])("provides actionable copy for %s", (code, expected) => {
    expect(worktreeRestoreFailureCopy(code)).toMatch(expected);
  });

  it("uses server detail only for unknown typed failures", () => {
    expect(worktreeRestoreFailureCopy("UNKNOWN", "Try reconnecting the disk.")).toBe(
      "Try reconnecting the disk.",
    );
  });
});
