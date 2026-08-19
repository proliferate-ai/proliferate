// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnyHarnessRuntime } from "../context/AnyHarnessRuntime.js";
import { AnyHarnessWorkspace } from "../context/AnyHarnessWorkspace.js";
import {
  invalidateGitDiffCache,
  readGitCacheForceEpoch,
} from "../lib/git-cache-generation.js";
import {
  useGitCacheForceEpoch,
  useStagePatchMutation,
  useUnstagePatchMutation,
  useGitBaseWorktreeDiffFilesQuery,
  useGitBranchDiffFilesQuery,
  useGitDiffQuery,
  useRevertGitPatchesMutation,
} from "./git.js";

const mocks = vi.hoisted(() => ({
  getDiff: vi.fn(),
  listBranchDiffFiles: vi.fn(),
  listBaseWorktreeDiffFiles: vi.fn(),
  revertPatches: vi.fn(),
  stagePatch: vi.fn(),
  unstagePatch: vi.fn(),
}));

vi.mock("../lib/client-cache.js", () => ({
  getAnyHarnessClient: () => ({
    git: {
      getDiff: mocks.getDiff,
      listBranchDiffFiles: mocks.listBranchDiffFiles,
      listBaseWorktreeDiffFiles: mocks.listBaseWorktreeDiffFiles,
      revertPatches: mocks.revertPatches,
      stagePatch: mocks.stagePatch,
      unstagePatch: mocks.unstagePatch,
    },
  }),
}));

describe("sdk-react git timing hooks", () => {
  afterEach(() => {
    cleanup();
    mocks.getDiff.mockReset();
    mocks.listBranchDiffFiles.mockReset();
    mocks.listBaseWorktreeDiffFiles.mockReset();
    mocks.revertPatches.mockReset();
    mocks.stagePatch.mockReset();
    mocks.unstagePatch.mockReset();
    vi.restoreAllMocks();
  });

  it("passes diff request options without adding timing metadata to query keys", async () => {
    mocks.getDiff.mockResolvedValue({
      path: "secret-file.ts",
      scope: "branch",
      binary: false,
      truncated: false,
      additions: 1,
      deletions: 0,
      patch: "@@ patch @@",
    });
    const onCacheDecision = vi.fn();
    const queryClient = createQueryClient();

    const { result } = renderHook(() => useGitDiffQuery({
      path: "secret-file.ts",
      scope: "branch",
      baseRef: "origin/private",
      requestOptions: {
        measurementOperationId: "mop_diff",
        headers: { "x-trace": "trace-1" },
      },
      onCacheDecision,
    }), { wrapper: createWrapper(queryClient, "http://runtime-diff.test") });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mocks.getDiff).toHaveBeenCalledWith(
      "anyharness-workspace-1",
      "secret-file.ts",
      expect.objectContaining({
        request: expect.objectContaining({
          measurementOperationId: "mop_diff",
          headers: { "x-trace": "trace-1" },
          signal: expect.any(AbortSignal),
        }),
      }),
    );
    const queryKeys = queryClient.getQueryCache().getAll().map((query) => query.queryKey);
    expect(JSON.stringify(queryKeys)).not.toContain("mop_diff");
    expect(JSON.stringify(queryKeys)).not.toContain("x-trace");
    expect(onCacheDecision).toHaveBeenCalledWith({
      category: "git.diff",
      decision: "miss",
      source: "react_query",
    });
  });

  it("passes branch diff file request options and reports cache decisions", async () => {
    mocks.listBranchDiffFiles.mockResolvedValue({
      baseRef: "origin/private",
      resolvedBaseOid: "base",
      mergeBaseOid: "merge",
      headOid: "head",
      files: [],
    });
    const onCacheDecision = vi.fn();
    const queryClient = createQueryClient();

    const { result } = renderHook(() => useGitBranchDiffFilesQuery({
      baseRef: "origin/private",
      cacheGeneration: "refresh-2",
      requestOptions: {
        measurementOperationId: "mop_branch",
        headers: { "x-trace": "trace-2" },
      },
      onCacheDecision,
    }), { wrapper: createWrapper(queryClient, "http://runtime-branch.test") });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mocks.listBranchDiffFiles).toHaveBeenCalledWith(
      "anyharness-workspace-1",
      expect.objectContaining({
        request: expect.objectContaining({
          measurementOperationId: "mop_branch",
          headers: { "x-trace": "trace-2" },
          signal: expect.any(AbortSignal),
        }),
      }),
    );
    const queryKeys = queryClient.getQueryCache().getAll().map((query) => query.queryKey);
    expect(JSON.stringify(queryKeys)).not.toContain("mop_branch");
    expect(JSON.stringify(queryKeys)).not.toContain("x-trace");
    expect(queryKeys.some((key) => key.at(-1) === "refresh-2")).toBe(true);
    expect(mocks.listBranchDiffFiles.mock.calls[0]?.[1]).not.toHaveProperty("cacheGeneration");
    expect(onCacheDecision).toHaveBeenCalledWith({
      category: "git.branch_diff_files",
      decision: "miss",
      source: "react_query",
    });
  });

  it("passes base worktree diff file request options and reports cache decisions", async () => {
    mocks.listBaseWorktreeDiffFiles.mockResolvedValue({
      baseRef: "origin/private",
      resolvedBaseOid: "base",
      mergeBaseOid: "merge",
      headOid: "head",
      files: [],
    });
    const onCacheDecision = vi.fn();
    const queryClient = createQueryClient();

    const { result } = renderHook(() => useGitBaseWorktreeDiffFilesQuery({
      baseRef: "origin/private",
      cacheGeneration: "turn-2",
      requestOptions: {
        measurementOperationId: "mop_base_worktree",
        headers: { "x-trace": "trace-3" },
      },
      onCacheDecision,
    }), { wrapper: createWrapper(queryClient, "http://runtime-base-worktree.test") });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mocks.listBaseWorktreeDiffFiles).toHaveBeenCalledWith(
      "anyharness-workspace-1",
      expect.objectContaining({
        request: expect.objectContaining({
          measurementOperationId: "mop_base_worktree",
          headers: { "x-trace": "trace-3" },
          signal: expect.any(AbortSignal),
        }),
      }),
    );
    const queryKeys = queryClient.getQueryCache().getAll().map((query) => query.queryKey);
    expect(JSON.stringify(queryKeys)).not.toContain("mop_base_worktree");
    expect(JSON.stringify(queryKeys)).not.toContain("x-trace");
    expect(queryKeys.some((key) => key.at(-1) === "turn-2")).toBe(true);
    expect(mocks.listBaseWorktreeDiffFiles.mock.calls[0]?.[1])
      .not.toHaveProperty("cacheGeneration");
    expect(onCacheDecision).toHaveBeenCalledWith({
      category: "git.base_worktree_diff_files",
      decision: "miss",
      source: "react_query",
    });
  });

  it("reports skipped cache decisions for disabled diff queries", async () => {
    const onCacheDecision = vi.fn();
    const queryClient = createQueryClient();

    renderHook(() => useGitDiffQuery({
      path: "secret-file.ts",
      enabled: false,
      onCacheDecision,
    }), { wrapper: createWrapper(queryClient, "http://runtime-disabled.test") });

    await waitFor(() => expect(onCacheDecision).toHaveBeenCalledWith({
      category: "git.diff",
      decision: "skipped",
      source: "react_query",
    }));
    expect(mocks.getDiff).not.toHaveBeenCalled();
  });

  it("drops prior-generation diff data until the new generation resolves", async () => {
    const first = gitDiff("generation-1");
    const second = deferred<ReturnType<typeof gitDiff>>();
    mocks.getDiff.mockResolvedValueOnce(first).mockReturnValueOnce(second.promise);
    const queryClient = createQueryClient();

    const { result, rerender } = renderHook(
      ({ cacheGeneration }) => useGitDiffQuery({
        path: "src/app.ts",
        cacheGeneration,
      }),
      {
        initialProps: { cacheGeneration: "generation-1" },
        wrapper: createWrapper(queryClient, "http://runtime-generation.test"),
      },
    );
    await waitFor(() => expect(result.current.data?.patch).toContain("generation-1"));

    rerender({ cacheGeneration: "generation-2" });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isFetching).toBe(true);
    await waitFor(() => expect(mocks.getDiff).toHaveBeenCalledTimes(2));

    act(() => second.resolve(gitDiff("generation-2")));
    await waitFor(() => expect(result.current.data?.patch).toContain("generation-2"));
    rerender({ cacheGeneration: "generation-2" });
    expect(mocks.getDiff).toHaveBeenCalledTimes(2);
  });

  it("keeps a deferred generation empty until it is enabled, then fetches once", async () => {
    mocks.getDiff
      .mockResolvedValueOnce(gitDiff("generation-1"))
      .mockResolvedValueOnce(gitDiff("generation-2"));
    const queryClient = createQueryClient();
    const { result, rerender } = renderHook(
      ({ cacheGeneration, enabled }) => useGitDiffQuery({
        path: "src/deferred.ts",
        cacheGeneration,
        enabled,
      }),
      {
        initialProps: { cacheGeneration: "generation-1", enabled: true },
        wrapper: createWrapper(queryClient, "http://runtime-deferred.test"),
      },
    );
    await waitFor(() => expect(result.current.data?.patch).toContain("generation-1"));

    rerender({ cacheGeneration: "generation-2", enabled: false });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isFetching).toBe(false);
    expect(mocks.getDiff).toHaveBeenCalledTimes(1);

    rerender({ cacheGeneration: "generation-2", enabled: true });
    await waitFor(() => expect(result.current.data?.patch).toContain("generation-2"));
    expect(mocks.getDiff).toHaveBeenCalledTimes(2);
  });

  it("refetches every active generationless diff family without refetching generated keys", async () => {
    mocks.getDiff.mockImplementation(async (_workspaceId: string, path: string) => (
      gitDiff(path === "src/center.ts" ? "center one" : "changes one")
    ));
    mocks.listBranchDiffFiles.mockResolvedValue(gitFileList("branch one"));
    mocks.listBaseWorktreeDiffFiles.mockResolvedValue(gitFileList("base worktree one"));
    const runtimeUrl = "http://runtime-unversioned.test";
    const queryClient = createQueryClient();
    const { result } = renderHook(() => ({
      center: useGitDiffQuery({ path: "src/center.ts" }),
      changes: useGitDiffQuery({
        path: "src/changes.ts",
        cacheGeneration: "generation-1",
      }),
      branch: useGitBranchDiffFilesQuery({ baseRef: "origin/main" }),
      generatedBranch: useGitBranchDiffFilesQuery({
        baseRef: "origin/main",
        cacheGeneration: "generation-1",
      }),
      baseWorktree: useGitBaseWorktreeDiffFilesQuery({ baseRef: "origin/main" }),
      generatedBaseWorktree: useGitBaseWorktreeDiffFilesQuery({
        baseRef: "origin/main",
        cacheGeneration: "generation-1",
      }),
    }), { wrapper: createWrapper(queryClient, runtimeUrl) });
    await waitFor(() => {
      expect(result.current.center.data?.patch).toContain("center one");
      expect(result.current.changes.data?.patch).toContain("changes one");
      expect(result.current.branch.data?.headOid).toBe("branch one");
      expect(result.current.generatedBranch.data?.headOid).toBe("branch one");
      expect(result.current.baseWorktree.data?.headOid).toBe("base worktree one");
      expect(result.current.generatedBaseWorktree.data?.headOid).toBe("base worktree one");
    });
    for (const [, options] of mocks.listBranchDiffFiles.mock.calls) {
      expect(options).not.toHaveProperty("cacheGeneration");
    }
    for (const [, options] of mocks.listBaseWorktreeDiffFiles.mock.calls) {
      expect(options).not.toHaveProperty("cacheGeneration");
    }

    mocks.getDiff.mockClear();
    mocks.getDiff.mockImplementation(async (_workspaceId: string, path: string) => (
      gitDiff(path === "src/center.ts" ? "center two" : "changes two")
    ));
    mocks.listBranchDiffFiles.mockClear();
    mocks.listBranchDiffFiles.mockResolvedValue(gitFileList("branch two"));
    mocks.listBaseWorktreeDiffFiles.mockClear();
    mocks.listBaseWorktreeDiffFiles.mockResolvedValue(gitFileList("base worktree two"));
    await act(() => invalidateGitDiffCache(queryClient, runtimeUrl, "workspace-1"));

    await waitFor(() => {
      expect(result.current.center.data?.patch).toContain("center two");
      expect(result.current.branch.data?.headOid).toBe("branch two");
      expect(result.current.baseWorktree.data?.headOid).toBe("base worktree two");
    });
    expect(result.current.changes.data?.patch).toContain("changes one");
    expect(result.current.changes.isStale).toBe(true);
    expect(result.current.generatedBranch.data?.headOid).toBe("branch one");
    expect(result.current.generatedBranch.isStale).toBe(true);
    expect(result.current.generatedBaseWorktree.data?.headOid).toBe("base worktree one");
    expect(result.current.generatedBaseWorktree.isStale).toBe(true);
    expect(mocks.getDiff).toHaveBeenCalledTimes(1);
    expect(mocks.getDiff.mock.calls[0]?.[1]).toBe("src/center.ts");
    expect(mocks.listBranchDiffFiles).toHaveBeenCalledTimes(1);
    expect(mocks.listBaseWorktreeDiffFiles).toHaveBeenCalledTimes(1);
    expect(mocks.listBranchDiffFiles.mock.calls[0]?.[1]).not.toHaveProperty("cacheGeneration");
    expect(mocks.listBaseWorktreeDiffFiles.mock.calls[0]?.[1])
      .not.toHaveProperty("cacheGeneration");
  });

  it("keeps caller-provided request signals when merging query signals", async () => {
    mocks.getDiff.mockResolvedValue({
      path: "signal-file.ts",
      scope: "working_tree",
      binary: false,
      truncated: false,
      additions: 0,
      deletions: 0,
      patch: "",
    });
    const callerController = new AbortController();
    const queryClient = createQueryClient();

    const { result } = renderHook(() => useGitDiffQuery({
      path: "signal-file.ts",
      requestOptions: {
        signal: callerController.signal,
      },
    }), { wrapper: createWrapper(queryClient, "http://runtime-signal.test") });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mocks.getDiff).toHaveBeenCalledWith(
      "anyharness-workspace-1",
      "signal-file.ts",
      expect.objectContaining({
        request: expect.objectContaining({
          signal: callerController.signal,
        }),
      }),
    );
  });

  it("calls revert patch mutations and invalidates git queries", async () => {
    mocks.revertPatches.mockResolvedValue({
      revertedPaths: ["README.md"],
      headOidBefore: "head",
      headOidAfter: "head",
    });
    const queryClient = createQueryClient();

    const { result } = renderHook(() => useRevertGitPatchesMutation(), {
      wrapper: createWrapper(queryClient, "http://runtime-revert.test"),
    });

    await result.current.mutateAsync({
      sourceLabel: "last turn",
      entries: [{
        path: "README.md",
        oldPath: null,
        operation: "edit",
        patch: "@@ -1 +1 @@\n-old\n+new",
        patchTruncated: false,
      }],
    });

    expect(mocks.revertPatches).toHaveBeenCalledWith(
      "anyharness-workspace-1",
      {
        sourceLabel: "last turn",
        entries: [{
          path: "README.md",
          oldPath: null,
          operation: "edit",
          patch: "@@ -1 +1 @@\n-old\n+new",
          patchTruncated: false,
        }],
      },
    );
  });

  it("advances the force epoch after successful stage, unstage, and revert invalidations", async () => {
    mocks.stagePatch.mockResolvedValue(undefined);
    mocks.unstagePatch.mockResolvedValue(undefined);
    mocks.revertPatches.mockResolvedValue({
      revertedPaths: ["README.md"],
      headOidBefore: "head-1",
      headOidAfter: "head-2",
    });
    const queryClient = createQueryClient();
    const { result } = renderHook(() => ({
      stage: useStagePatchMutation(),
      unstage: useUnstagePatchMutation(),
      revert: useRevertGitPatchesMutation(),
    }), { wrapper: createWrapper(queryClient, "http://runtime-mutations.test") });

    await act(() => result.current.stage.mutateAsync("stage patch"));
    expect(readGitCacheForceEpoch(queryClient, "http://runtime-mutations.test", "workspace-1"))
      .toBe(1);
    await act(() => result.current.unstage.mutateAsync("unstage patch"));
    expect(readGitCacheForceEpoch(queryClient, "http://runtime-mutations.test", "workspace-1"))
      .toBe(2);
    await act(() => result.current.revert.mutateAsync({ entries: [{
      path: "README.md",
      operation: "edit",
      patch: "@@ patch @@",
    }] }));
    expect(readGitCacheForceEpoch(queryClient, "http://runtime-mutations.test", "workspace-1"))
      .toBe(3);
  });

  it("moves a staged same-numstat diff to the new epoch without reactivating old data", async () => {
    const second = deferred<ReturnType<typeof gitDiff>>();
    mocks.getDiff
      .mockResolvedValueOnce(gitDiff("generation one"))
      .mockReturnValueOnce(second.promise);
    mocks.stagePatch.mockResolvedValue(undefined);
    const queryClient = createQueryClient();
    const { result } = renderHook(() => {
      const forceEpoch = useGitCacheForceEpoch();
      return {
        diff: useGitDiffQuery({
          path: "src/staged.ts",
          cacheGeneration: `epoch-${forceEpoch}`,
        }),
        stage: useStagePatchMutation(),
      };
    }, { wrapper: createWrapper(queryClient, "http://runtime-stage-generation.test") });
    await waitFor(() => expect(result.current.diff.data?.patch).toContain("generation one"));

    await act(() => result.current.stage.mutateAsync("stage patch"));
    await waitFor(() => expect(mocks.getDiff).toHaveBeenCalledTimes(2));
    expect(result.current.diff.data).toBeUndefined();
    expect(result.current.diff.isFetching).toBe(true);

    act(() => second.resolve(gitDiff("generation two")));
    await waitFor(() => expect(result.current.diff.data?.patch).toContain("generation two"));
    expect(mocks.getDiff).toHaveBeenCalledTimes(2);
  });
});

function gitDiff(label: string) {
  return {
    path: "src/app.ts",
    scope: "working_tree" as const,
    binary: false,
    truncated: false,
    additions: 1,
    deletions: 1,
    patch: `@@ -1 +1 @@\n-before\n+${label}`,
  };
}

function gitFileList(label: string) {
  return {
    baseRef: "origin/main",
    resolvedBaseOid: "base",
    mergeBaseOid: "merge",
    headOid: label,
    files: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function createWrapper(queryClient: QueryClient, runtimeUrl: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AnyHarnessRuntime runtimeUrl={runtimeUrl}>
          <AnyHarnessWorkspace
            workspaceId="workspace-1"
            resolveConnection={async () => ({
              runtimeUrl,
              anyharnessWorkspaceId: "anyharness-workspace-1",
            })}
          >
            {children}
          </AnyHarnessWorkspace>
        </AnyHarnessRuntime>
      </QueryClientProvider>
    );
  };
}
