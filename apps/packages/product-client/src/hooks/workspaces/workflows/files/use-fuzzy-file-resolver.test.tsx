// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fuzzyOutcome,
  useFuzzyFileResolver,
} from "#product/hooks/workspaces/workflows/files/use-fuzzy-file-resolver";

const mocks = vi.hoisted(() => ({ searchFiles: vi.fn() }));

vi.mock("#product/hooks/access/anyharness/files/use-workspace-file-lookup", () => ({
  useWorkspaceFileLookup: () => ({ searchFiles: mocks.searchFiles, statFile: vi.fn() }),
}));

describe("fuzzyOutcome", () => {
  it("includes exact matches and retains runtime casing", () => {
    expect(fuzzyOutcome("src/app.ts", ["src/App.ts"])).toEqual({
      status: "match",
      workspacePath: "src/App.ts",
    });
  });

  it("distinguishes zero and ambiguous suffix matches", () => {
    expect(fuzzyOutcome("src/app.ts", [])).toEqual({ status: "no-match" });
    expect(fuzzyOutcome("src/app.ts", ["a/src/App.ts", "b/src/app.ts"]))
      .toEqual({ status: "ambiguous" });
  });
});

describe("useFuzzyFileResolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs one basename search through the access hook", async () => {
    mocks.searchFiles.mockResolvedValueOnce({ results: [{ path: "apps/web/src/App.tsx" }] });
    const { result } = renderHook(() => useFuzzyFileResolver());

    await expect(result.current({
      workspacePath: "src/app.tsx",
      materializedWorkspaceId: "workspace-1",
    })).resolves.toEqual({ status: "match", workspacePath: "apps/web/src/App.tsx" });
    expect(mocks.searchFiles).toHaveBeenCalledTimes(1);
    expect(mocks.searchFiles).toHaveBeenCalledWith({
      materializedWorkspaceId: "workspace-1",
      query: "app.tsx",
    });
  });

  it("returns an explicit search error without retrying", async () => {
    mocks.searchFiles.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useFuzzyFileResolver());
    await expect(result.current({
      workspacePath: "src/App.tsx",
      materializedWorkspaceId: "workspace-1",
    })).resolves.toEqual({ status: "search-error" });
    expect(mocks.searchFiles).toHaveBeenCalledTimes(1);
  });
});
