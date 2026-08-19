// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnyHarnessRuntime } from "../context/AnyHarnessRuntime.js";
import { AnyHarnessWorkspace } from "../context/AnyHarnessWorkspace.js";
import { readGitCacheForceEpoch } from "../lib/git-cache-generation.js";
import { useWriteWorkspaceFileMutation } from "./files.js";
import { useGitCacheForceEpoch, useGitDiffQuery } from "./git.js";

const CACHE_SCOPE_KEY = "files:test";
const mocks = vi.hoisted(() => ({ getDiff: vi.fn(), write: vi.fn() }));

vi.mock("../lib/client-cache.js", () => ({
  getAnyHarnessClient: () => ({
    files: { write: mocks.write },
    git: { getDiff: mocks.getDiff },
  }),
}));

afterEach(() => {
  cleanup();
  mocks.getDiff.mockReset();
  mocks.write.mockReset();
  vi.restoreAllMocks();
});

describe("sdk-react file mutation Git coherence", () => {
  it("advances the force epoch only after successful invalidations settle", async () => {
    mocks.write.mockResolvedValue({ path: "src/app.ts" });
    const queryClient = createQueryClient();
    const invalidation = deferred<void>();
    vi.spyOn(queryClient, "invalidateQueries").mockReturnValue(invalidation.promise);
    const { result } = renderHook(() => useWriteWorkspaceFileMutation(), {
      wrapper: createWrapper(queryClient),
    });

    let mutation!: Promise<unknown>;
    act(() => {
      mutation = result.current.mutateAsync({ path: "src/app.ts", content: "next" });
    });
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    expect(readGitCacheForceEpoch(queryClient, CACHE_SCOPE_KEY, "workspace-1")).toBe(0);

    invalidation.resolve();
    await act(() => mutation);
    expect(readGitCacheForceEpoch(queryClient, CACHE_SCOPE_KEY, "workspace-1")).toBe(1);
  });

  it("moves a same-numstat diff to the file-write epoch without restoring old data", async () => {
    const second = deferred<ReturnType<typeof gitDiff>>();
    mocks.getDiff
      .mockResolvedValueOnce(gitDiff("generation one"))
      .mockReturnValueOnce(second.promise);
    mocks.write.mockResolvedValue({ path: "src/app.ts" });
    const queryClient = createQueryClient();
    const { result } = renderHook(() => {
      const forceEpoch = useGitCacheForceEpoch();
      return {
        diff: useGitDiffQuery({
          path: "src/app.ts",
          cacheGeneration: `epoch-${forceEpoch}`,
        }),
        write: useWriteWorkspaceFileMutation(),
      };
    }, { wrapper: createWrapper(queryClient) });
    await waitFor(() => expect(result.current.diff.data?.patch).toContain("generation one"));

    await act(() => result.current.write.mutateAsync({
      path: "src/app.ts",
      content: "next",
    }));
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

function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AnyHarnessRuntime runtimeUrl="http://runtime-files.test" cacheScopeKey={CACHE_SCOPE_KEY}>
          <AnyHarnessWorkspace
            workspaceId="workspace-1"
            resolveConnection={async () => ({
              runtimeUrl: "http://runtime-files.test",
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
