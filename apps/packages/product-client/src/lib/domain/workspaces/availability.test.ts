import { describe, expect, it } from "vitest";
import { canRestoreMissingWorktree } from "#product/lib/domain/workspaces/availability";

const worktree = {
  availability: "workspace_directory_missing" as const,
  kind: "worktree" as const,
  originalBranch: "feature/restore",
  currentBranch: "feature/restore",
  repoRootId: "repo-1",
};
const repoRoot = { id: "repo-1", path: "/repos/project" };

describe("canRestoreMissingWorktree", () => {
  it("allows only a missing worktree with a recorded branch and matching repository", () => {
    expect(canRestoreMissingWorktree(worktree, repoRoot)).toBe(true);
    expect(canRestoreMissingWorktree({ ...worktree, kind: "local" }, repoRoot)).toBe(false);
    expect(canRestoreMissingWorktree({ ...worktree, currentBranch: null }, repoRoot)).toBe(false);
    expect(canRestoreMissingWorktree({ ...worktree, currentBranch: "   " }, repoRoot)).toBe(false);
    expect(canRestoreMissingWorktree({ ...worktree, currentBranch: "HEAD" }, repoRoot)).toBe(false);
    expect(canRestoreMissingWorktree(worktree, null)).toBe(false);
    expect(canRestoreMissingWorktree(worktree, { ...repoRoot, id: "repo-2" })).toBe(false);
    expect(canRestoreMissingWorktree(worktree, { ...repoRoot, path: "   " })).toBe(false);
    expect(canRestoreMissingWorktree({ ...worktree, availability: "available" }, repoRoot))
      .toBe(false);
  });
});
