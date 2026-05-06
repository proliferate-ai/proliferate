// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnyHarnessRuntime } from "../context/AnyHarnessRuntime.js";
import { AnyHarnessWorkspace } from "../context/AnyHarnessWorkspace.js";
import {
  useGitBranchDiffFilesQuery,
  useGitDiffQuery,
} from "./git.js";

const mocks = vi.hoisted(() => ({
  getDiff: vi.fn(),
  listBranchDiffFiles: vi.fn(),
}));

vi.mock("../lib/client-cache.js", () => ({
  getAnyHarnessClient: () => ({
    git: {
      getDiff: mocks.getDiff,
      listBranchDiffFiles: mocks.listBranchDiffFiles,
    },
  }),
}));

describe("sdk-react git timing hooks", () => {
  afterEach(() => {
    cleanup();
    mocks.getDiff.mockReset();
    mocks.listBranchDiffFiles.mockReset();
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
    expect(onCacheDecision).toHaveBeenCalledWith({
      category: "git.branch_diff_files",
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
});

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
