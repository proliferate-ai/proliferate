import { describe, expect, it } from "vitest";
import type {
  GitPanelReviewFile,
  GitPanelSection,
} from "#product/lib/domain/workspaces/changes/git-panel-diff";
import {
  resolveGitPanelReviewEvidence,
  summarizeGitPanelSectionStats,
} from "#product/lib/domain/workspaces/changes/git-panel-review-model";

describe("git panel review evidence", () => {
  it("keeps current evidence authoritative over recorded fallback", () => {
    const file = reviewFile({
      currentAdditions: 2,
      currentDeletions: 1,
      recordedAdditions: 20,
      recordedDeletions: 10,
      recordedPatch: "@@ -1 +1 @@\n-recorded\n+fallback",
    });

    expect(resolveGitPanelReviewEvidence(file, {
      additions: 3,
      deletions: 4,
      patch: "@@ -1 +1 @@\n-live\n+current",
      binary: true,
      truncated: true,
    })).toEqual({
      source: "current",
      additions: 3,
      deletions: 4,
      patch: "@@ -1 +1 @@\n-live\n+current",
      binary: true,
      truncated: true,
    });
  });

  it("ignores stale live evidence when only a recorded patch remains", () => {
    const file = reviewFile({
      currentAdditions: null,
      recordedAdditions: 5,
      recordedDeletions: 2,
      recordedPatch: "@@ -1 +1 @@\n-before\n+recorded",
    });

    expect(resolveGitPanelReviewEvidence(file, {
      additions: 99,
      deletions: 88,
      patch: "@@ -1 +1 @@\n-stale\n+cached",
      binary: true,
      truncated: true,
    })).toEqual({
      source: "recorded",
      additions: 5,
      deletions: 2,
      patch: "@@ -1 +1 @@\n-before\n+recorded",
      binary: false,
      truncated: false,
    });
  });

  it("keeps recorded stats without inventing a patch", () => {
    const file = reviewFile({
      currentAdditions: null,
      recordedAdditions: 7,
      recordedDeletions: 6,
      recordedPatch: "  \n",
    });

    expect(resolveGitPanelReviewEvidence(file, {
      additions: 99,
      deletions: 88,
      patch: "stale patch",
      binary: true,
    })).toEqual({
      source: "none",
      additions: 7,
      deletions: 6,
      patch: null,
      binary: false,
      truncated: false,
    });
  });

  it("summarizes current stats first and recorded stats without double counting", () => {
    const sections: GitPanelSection[] = [{
      scope: "last_turn",
      label: "Last turn",
      files: [
        reviewFile({
          path: "current.ts",
          currentAdditions: 2,
          currentDeletions: 1,
          recordedAdditions: 20,
          recordedDeletions: 10,
        }),
        reviewFile({
          path: "recorded.ts",
          currentAdditions: null,
          recordedAdditions: 5,
          recordedDeletions: 3,
        }),
      ],
    }];

    expect(summarizeGitPanelSectionStats(sections)).toEqual({
      additions: 7,
      deletions: 4,
    });
  });
});

function reviewFile({
  path = "file.ts",
  currentAdditions,
  currentDeletions = 0,
  recordedAdditions = 0,
  recordedDeletions = 0,
  recordedPatch = null,
}: {
  path?: string;
  currentAdditions: number | null;
  currentDeletions?: number;
  recordedAdditions?: number;
  recordedDeletions?: number;
  recordedPatch?: string | null;
}): GitPanelReviewFile {
  const currentDiff = currentAdditions === null
    ? null
    : {
        key: `:${path}:modified`,
        path,
        oldPath: null,
        displayPath: path,
        status: "modified" as const,
        includedState: null,
        additions: currentAdditions,
        deletions: currentDeletions,
        binary: false,
      };
  return {
    key: `:${path}:edit`,
    path,
    oldPath: null,
    displayPath: path,
    currentDiff,
    touched: {
      key: `:${path}:edit`,
      path,
      oldPath: null,
      displayPath: path,
      operation: "edit",
      topLevel: true,
      recordedAdditions,
      recordedDeletions,
      recordedPatch,
    },
  };
}
