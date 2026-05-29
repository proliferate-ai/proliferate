// @vitest-environment jsdom

import { anyHarnessWorkspaceQueryKeyRoots } from "@anyharness/sdk-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cloudWorkspaceConnectionKey } from "@/hooks/access/cloud/query-keys";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/cache/query-keys";
import { useWorkspaceMobilityCache } from "./use-workspace-mobility-cache";

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function renderMobilityCache(queryClient: QueryClient, runtimeUrl: string) {
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  }

  return renderHook(() => useWorkspaceMobilityCache(runtimeUrl), { wrapper: Wrapper });
}

afterEach(() => {
  cleanup();
});

describe("useWorkspaceMobilityCache", () => {
  it("clears cloud connection and AnyHarness workspace caches for owner flips", async () => {
    const queryClient = makeQueryClient();
    const runtimeUrl = "http://runtime.test";
    const logicalWorkspaceId = "remote:github:owner:repo:main";
    const previousWorkspaceId = "workspace-local";
    const previousCloudWorkspaceId = "cloud-previous";
    const nextCloudWorkspaceId = "cloud-next";

    queryClient.setQueryData(
      cloudWorkspaceConnectionKey(previousCloudWorkspaceId),
      { runtimeUrl: "previous" },
    );
    queryClient.setQueryData(
      cloudWorkspaceConnectionKey(nextCloudWorkspaceId),
      { runtimeUrl: "next" },
    );
    for (const workspaceId of [logicalWorkspaceId, previousWorkspaceId]) {
      for (const root of anyHarnessWorkspaceQueryKeyRoots(runtimeUrl, workspaceId)) {
        queryClient.setQueryData([...root, "child"], { workspaceId });
      }
    }

    const { result } = renderMobilityCache(queryClient, runtimeUrl);

    await act(async () => {
      await result.current.clearWorkspaceOwnerFlipCache({
        logicalWorkspaceId,
        previousWorkspaceId,
        previousCloudWorkspaceId,
        nextCloudWorkspaceId,
      });
    });

    expect(queryClient.getQueryData(cloudWorkspaceConnectionKey(previousCloudWorkspaceId)))
      .toBeUndefined();
    expect(queryClient.getQueryData(cloudWorkspaceConnectionKey(nextCloudWorkspaceId)))
      .toBeUndefined();
    for (const workspaceId of [logicalWorkspaceId, previousWorkspaceId]) {
      for (const root of anyHarnessWorkspaceQueryKeyRoots(runtimeUrl, workspaceId)) {
        expect(queryClient.getQueryData([...root, "child"])).toBeUndefined();
      }
    }
  });

  it("invalidates the workspace collections cache for the runtime", async () => {
    const queryClient = makeQueryClient();
    const runtimeUrl = "http://runtime.test";
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderMobilityCache(queryClient, runtimeUrl);

    await act(async () => {
      await result.current.invalidateWorkspaceCollections();
    });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: workspaceCollectionsScopeKey(runtimeUrl),
    });
  });
});
