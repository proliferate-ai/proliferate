import { describe, expect, it } from "vitest";
import type { GitStatusSnapshot } from "@anyharness/sdk";
import { buildComposerWorkspaceActivityModel } from "./composer-workspace-activity";

function gitStatus(overrides: Partial<GitStatusSnapshot> = {}): GitStatusSnapshot {
  return {
    workspaceId: "workspace-1",
    workspacePath: "/tmp/workspace-1",
    repoRootPath: "/tmp/repo",
    currentBranch: "feature/activity",
    headOid: "abc",
    detached: false,
    upstreamBranch: "origin/feature/activity",
    suggestedBaseBranch: "main",
    ahead: 0,
    behind: 0,
    operation: "none",
    conflicted: false,
    clean: true,
    summary: {
      changedFiles: 0,
      additions: 0,
      deletions: 0,
      includedFiles: 0,
      conflictedFiles: 0,
    },
    actions: {
      canCommit: false,
      canPush: false,
      pushLabel: "Publish branch",
      canCreatePullRequest: false,
      canCreateDraftPullRequest: false,
      canCreateBranchWorkspace: false,
    },
    files: [],
    ...overrides,
  };
}

describe("buildComposerWorkspaceActivityModel", () => {
  it("uses the clean branch fallback for a quiet Git workspace", () => {
    const model = buildComposerWorkspaceActivityModel({
      gitStatus: gitStatus(),
      pullRequest: null,
    });

    expect(model?.facts).toEqual([
      { key: "branch", label: "feature/activity", tone: "default" },
      { key: "clean", label: "No changes", tone: "default" },
    ]);
  });

  it("prioritizes conflicts and failing checks", () => {
    const model = buildComposerWorkspaceActivityModel({
      gitStatus: gitStatus({
        conflicted: true,
        clean: false,
        summary: {
          changedFiles: 4,
          additions: 20,
          deletions: 3,
          includedFiles: 1,
          conflictedFiles: 2,
        },
      }),
      pullRequest: {
        number: 381,
        state: "open",
        checks: "failing",
        reviewDecision: "none",
      },
    });

    expect(model?.facts.slice(0, 3).map((fact) => fact.label)).toEqual([
      "2 conflicts",
      "PR #381 checks failing",
      "4 changes",
    ]);
  });

  it("counts partial files in staged and unstaged detail", () => {
    const model = buildComposerWorkspaceActivityModel({
      gitStatus: gitStatus({
        clean: false,
        summary: {
          changedFiles: 2,
          additions: 4,
          deletions: 1,
          includedFiles: 1,
          conflictedFiles: 0,
        },
        files: [
          {
            path: "one.ts",
            status: "modified",
            additions: 2,
            deletions: 0,
            binary: false,
            includedState: "included",
          },
          {
            path: "two.ts",
            status: "modified",
            additions: 2,
            deletions: 1,
            binary: false,
            includedState: "partial",
          },
        ],
      }),
      pullRequest: null,
    });

    expect(model?.git?.stagingLabel).toBe("2 staged · 1 unstaged");
  });

  it("surfaces branch sync state in the collapsed summary", () => {
    const model = buildComposerWorkspaceActivityModel({
      gitStatus: gitStatus({ ahead: 2, behind: 1 }),
      pullRequest: null,
    });

    expect(model?.facts).toEqual([
      { key: "sync", label: "2 ahead · 1 behind", tone: "default" },
    ]);
  });

  it("keeps terminal pull request state truthful even when checks passed", () => {
    const model = buildComposerWorkspaceActivityModel({
      gitStatus: gitStatus(),
      pullRequest: {
        number: 381,
        state: "merged",
        checks: "passing",
        reviewDecision: "approved",
      },
    });

    expect(model?.facts[0]?.label).toBe("PR #381 merged");
  });
});
