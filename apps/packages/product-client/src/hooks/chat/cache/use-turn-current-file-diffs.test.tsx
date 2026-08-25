// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GitPanelReviewFile } from "#product/lib/domain/workspaces/changes/git-panel-diff";
import { useTurnCurrentFilePatch } from "#product/hooks/chat/cache/use-turn-current-file-diffs";

const staleDiffQuery = vi.hoisted(() => ({
  data: {
    additions: 99,
    deletions: 88,
    patch: "@@ -1 +1 @@\n-stale before\n+stale cached",
  },
  error: new Error("stale query error"),
  isError: true,
  isLoading: false,
}));

vi.mock("@anyharness/sdk-react", async (importOriginal) => ({
  ...await importOriginal<typeof import("@anyharness/sdk-react")>(),
  useGitDiffQuery: () => staleDiffQuery,
}));

describe("useTurnCurrentFilePatch", () => {
  it("clears stale live-query evidence after the current diff disappears", () => {
    const file = reviewFile();
    const { result, rerender } = renderHook(
      ({ currentFile }: { currentFile: GitPanelReviewFile }) =>
        useTurnCurrentFilePatch({
          file: currentFile,
          workspaceId: "workspace-1",
          baseRef: "origin/main",
          enabled: true,
        }),
      { initialProps: { currentFile: file } },
    );

    expect(result.current).toMatchObject({
      additions: 99,
      deletions: 88,
      patch: staleDiffQuery.data.patch,
      diffErrorMessage: "stale query error",
    });
    expect(result.current.patchPolicy).not.toBeNull();

    rerender({ currentFile: { ...file, currentDiff: null } });

    expect(result.current).toMatchObject({
      currentDiff: null,
      additions: 0,
      deletions: 0,
      patch: null,
      diffErrorMessage: null,
      patchPolicy: null,
    });
  });
});

function reviewFile(): GitPanelReviewFile {
  const path = "src/recorded.ts";
  return {
    key: `:${path}:modified`,
    path,
    oldPath: null,
    displayPath: path,
    currentDiff: {
      key: `:${path}:modified`,
      path,
      oldPath: null,
      displayPath: path,
      status: "modified",
      includedState: null,
      additions: 5,
      deletions: 2,
      binary: false,
    },
  };
}
