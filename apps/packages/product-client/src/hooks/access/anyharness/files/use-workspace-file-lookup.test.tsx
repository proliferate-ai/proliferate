// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceFileLookup } from "#product/hooks/access/anyharness/files/use-workspace-file-lookup";
import { createAppQueryClient } from "#product/lib/infra/query/query-client";

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("@anyharness/sdk-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anyharness/sdk-react")>();
  return {
    ...actual,
    getAnyHarnessClient: () => ({ files: { search: mocks.search, stat: mocks.stat } }),
    resolveWorkspaceConnectionFromContext: vi.fn(async (_context, workspaceId: string) => ({
      workspaceId,
      connection: {
        runtimeUrl: "http://runtime.test",
        anyharnessWorkspaceId: `runtime-${workspaceId}`,
      },
    })),
    useAnyHarnessCacheScopeKey: () => "account-1",
    useAnyHarnessWorkspaceContext: () => ({
      workspaceId: "workspace-1",
      resolveConnection: vi.fn(),
    }),
  };
});

describe("useWorkspaceFileLookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses SDK query keys and the 200-result search bound", async () => {
    mocks.search.mockResolvedValueOnce({ results: [] });
    mocks.stat.mockResolvedValueOnce({ path: "src/App.tsx", kind: "file", sizeBytes: 1 });
    const queryClient = createAppQueryClient({ captureException: vi.fn() });
    const { result } = renderHook(() => useWorkspaceFileLookup(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });

    await act(async () => {
      await result.current.searchFiles({ materializedWorkspaceId: "workspace-1", query: "App.tsx" });
      await result.current.statFile({ materializedWorkspaceId: "workspace-1", path: "src/App.tsx" });
    });

    expect(mocks.search).toHaveBeenCalledWith("runtime-workspace-1", "App.tsx", 200);
    expect(mocks.stat).toHaveBeenCalledWith("runtime-workspace-1", "src/App.tsx");
    expect(queryClient.getQueryCache().getAll().map((query) => query.queryKey)).toContainEqual([
      "anyharness",
      "account-1",
      "workspace",
      "workspace-1",
      "file-search",
      "App.tsx",
      200,
    ]);
  });

  it("overrides the production retry default for each failed transport stage", async () => {
    mocks.search.mockRejectedValue(new Error("search failed"));
    mocks.stat.mockRejectedValue(new Error("stat failed"));
    const queryClient = createAppQueryClient({ captureException: vi.fn() });
    const { result } = renderHook(() => useWorkspaceFileLookup(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });

    await expect(result.current.searchFiles({
      materializedWorkspaceId: "workspace-1",
      query: "missing.ts",
    })).rejects.toThrow("search failed");
    await expect(result.current.statFile({
      materializedWorkspaceId: "workspace-1",
      path: "missing.ts",
    })).rejects.toThrow("stat failed");

    expect(mocks.search).toHaveBeenCalledTimes(1);
    expect(mocks.stat).toHaveBeenCalledTimes(1);
  });
});
