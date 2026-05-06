// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { workspaceCollectionsKey } from "./query-keys";
import { useWorkspaces } from "./use-workspaces";

const mocks = vi.hoisted(() => {
  const workspacesList = vi.fn();
  const repoRootsList = vi.fn();
  const listCloudWorkspaces = vi.fn();
  const getAnyHarnessClient = vi.fn(() => ({
    workspaces: { list: workspacesList },
    repoRoots: { list: repoRootsList },
  }));

  return {
    getAnyHarnessClient,
    listCloudWorkspaces,
    repoRootsList,
    workspacesList,
  };
});

vi.mock("@anyharness/sdk-react", () => ({
  getAnyHarnessClient: mocks.getAnyHarnessClient,
}));

vi.mock("@/hooks/cloud/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({
    cloudActive: false,
  }),
}));

vi.mock("@/lib/integrations/cloud/workspaces", () => ({
  listCloudWorkspaces: mocks.listCloudWorkspaces,
}));

describe("useWorkspaces", () => {
  beforeEach(() => {
    useHarnessConnectionStore.setState({
      runtimeUrl: "http://runtime.test",
      connectionState: "healthy",
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    useHarnessConnectionStore.getState().resetConnectionState();
  });

  it("does not cache empty workspace collections when a request is aborted", async () => {
    const abortError = new DOMException("Aborted", "AbortError");
    mocks.workspacesList.mockRejectedValueOnce(abortError);
    mocks.repoRootsList.mockResolvedValueOnce([]);
    const { result, queryClient } = renderUseWorkspaces();

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBe(abortError);
    expect(result.current.data).toBeUndefined();
    expect(queryClient.getQueryData(
      workspaceCollectionsKey("http://runtime.test", false),
    )).toBeUndefined();
  });

  it("keeps empty fallbacks for non-abort workspace collection failures", async () => {
    mocks.workspacesList.mockRejectedValueOnce(new Error("runtime unavailable"));
    mocks.repoRootsList.mockResolvedValueOnce([]);
    const { result } = renderUseWorkspaces();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.localWorkspaces).toEqual([]);
    expect(result.current.data?.repoRoots).toEqual([]);
  });
});

function renderUseWorkspaces() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return {
    queryClient,
    ...renderHook(() => useWorkspaces(), { wrapper }),
  };
}
