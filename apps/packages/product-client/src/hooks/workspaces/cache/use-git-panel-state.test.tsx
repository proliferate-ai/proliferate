// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGitPanelState } from "#product/hooks/workspaces/cache/use-git-panel-state";

const sdk = vi.hoisted(() => ({
  advanceForceEpoch: vi.fn(() => 1),
  status: queryState({
    files: [{
      path: "src/app.ts",
      oldPath: null,
      status: "modified",
      includedState: "excluded",
      additions: 1,
      deletions: 1,
      binary: false,
    }],
    suggestedBaseBranch: "origin/main",
  }),
  branches: queryState([]),
  branchFiles: queryState({
    baseRef: "origin/main",
    resolvedBaseOid: "base",
    mergeBaseOid: "merge",
    headOid: "head",
    files: [],
  }),
  baseWorktreeFiles: queryState({
    baseRef: "origin/main",
    resolvedBaseOid: "base",
    mergeBaseOid: "merge",
    headOid: "head",
    files: [],
  }),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useGitCacheForceEpoch: () => 0,
  useAdvanceGitCacheForceEpoch: () => sdk.advanceForceEpoch,
  useGitStatusQuery: () => sdk.status,
  useGitBranchesQuery: () => sdk.branches,
  useGitBranchDiffFilesQuery: () => sdk.branchFiles,
  useGitBaseWorktreeDiffFilesQuery: () => sdk.baseWorktreeFiles,
}));

vi.mock("#product/hooks/workspaces/derived/use-hot-paint-gate", () => ({
  useIsHotPaintGatePendingForWorkspace: () => false,
}));

vi.mock("#product/hooks/workspaces/derived/use-workspace-runtime-block", () => ({
  useWorkspaceRuntimeBlock: () => ({ getWorkspaceRuntimeBlockReason: () => null }),
}));

vi.mock("#product/hooks/workspaces/cache/use-workspaces", () => ({
  useWorkspaces: () => ({ data: undefined }),
}));

vi.mock("#product/stores/preferences/repo-preferences-store", () => ({
  useRepoPreferencesStore: (
    selector: (state: { repoConfigs: Record<string, never> }) => unknown,
  ) => selector({ repoConfigs: {} }),
}));

vi.mock("#product/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (
    selector: (state: {
      selectedWorkspaceId: string;
      selectedLogicalWorkspaceId: null;
      activeSessionId: null;
    }) => unknown,
  ) => selector({
    selectedWorkspaceId: "workspace-1",
    selectedLogicalWorkspaceId: null,
    activeSessionId: null,
  }),
}));

vi.mock("#product/stores/sessions/session-transcript-store", () => ({
  useSessionTranscriptStore: (
    selector: (state: { entriesById: Record<string, never> }) => unknown,
  ) => selector({ entriesById: {} }),
}));

afterEach(cleanup);

describe("useGitPanelState refresh coherence", () => {
  beforeEach(() => {
    sdk.advanceForceEpoch.mockClear();
    sdk.status.data = workingTreeMetadata("modified");
    for (const query of [sdk.status, sdk.branches, sdk.branchFiles, sdk.baseWorktreeFiles]) {
      query.error = null;
      query.isError = false;
      query.refetch.mockReset().mockResolvedValue({ isError: false });
    }
  });

  it("returns and renders a branch-list refresh failure without advancing the epoch", async () => {
    const refreshError = new Error("Could not refresh branches");
    sdk.branches.error = refreshError;
    sdk.branches.isError = true;
    sdk.branches.refetch.mockResolvedValue({ isError: true });
    const queryClient = new QueryClient();
    const { result } = renderHook(() => useGitPanelState("branch"), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.errorMessage).toBe(refreshError.message);
    let refreshed: boolean | undefined;
    await act(async () => {
      refreshed = await result.current.refetch();
    });
    expect(refreshed).toBe(false);
    expect(sdk.status.refetch).toHaveBeenCalledTimes(1);
    expect(sdk.branches.refetch).toHaveBeenCalledTimes(1);
    expect(sdk.branchFiles.refetch).toHaveBeenCalledTimes(1);
    expect(sdk.advanceForceEpoch).not.toHaveBeenCalled();
  });

  it("keeps unchanged polls stable and assigns a third generation to M1 after M1-M2-M1", () => {
    const queryClient = new QueryClient();
    const wrapper = createWrapper(queryClient);
    sdk.status.data = workingTreeMetadata("modified");
    const view = renderHook(() => useGitPanelState("working_tree_composite"), { wrapper });
    const firstM1 = view.result.current.cacheGeneration;

    sdk.status.data = {
      ...sdk.status.data,
      files: sdk.status.data.files.map((file) => ({ ...file })),
    };
    view.rerender();
    expect(view.result.current.cacheGeneration).toBe(firstM1);

    sdk.status.data = workingTreeMetadata("added");
    view.rerender();
    const observedM2 = view.result.current.cacheGeneration;
    expect(observedM2).not.toBe(firstM1);

    sdk.status.data = workingTreeMetadata("modified");
    view.rerender();
    const finalM1 = view.result.current.cacheGeneration;
    expect(finalM1).not.toBe(firstM1);
    expect(finalM1).not.toBe(observedM2);

    view.unmount();
    const remount = renderHook(() => useGitPanelState("working_tree_composite"), { wrapper });
    expect(remount.result.current.cacheGeneration).toBe(finalM1);
  });
});

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function workingTreeMetadata(status: string) {
  return {
    files: [{
      path: "src/app.ts",
      oldPath: null,
      status,
      includedState: "excluded",
      additions: 1,
      deletions: 1,
      binary: false,
    }],
    suggestedBaseBranch: "origin/main",
  };
}

function queryState<T>(data: T) {
  return {
    data,
    error: null as Error | null,
    isError: false,
    isFetching: false,
    isLoading: false,
    isStale: false,
    refetch: vi.fn(async () => ({ isError: false })),
  };
}
