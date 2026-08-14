// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnyHarnessRuntime } from "../context/AnyHarnessRuntime.js";
import { AnyHarnessWorkspace } from "../context/AnyHarnessWorkspace.js";
import { useSessionSubagentsQuery } from "./subagents.js";

const mocks = vi.hoisted(() => ({
  getSubagents: vi.fn(),
}));

vi.mock("../lib/client-cache.js", () => ({
  getAnyHarnessClient: () => ({
    sessions: {
      getSubagents: mocks.getSubagents,
    },
  }),
}));

describe("sdk-react session subagents query options", () => {
  afterEach(() => {
    cleanup();
    mocks.getSubagents.mockReset();
  });

  it("keeps the query client's refetch defaults when refetch options are omitted", async () => {
    mocks.getSubagents.mockResolvedValue({ sessionId: "session-1", subagents: [] });
    const queryClient = createQueryClient();

    const { result } = renderHook(() => useSessionSubagentsQuery("session-1"), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const observerOptions = queryClient.getQueryCache().getAll()[0]?.observers[0]?.options;
    // Passing `refetchOnWindowFocus: undefined` through to useQuery would
    // override this global default — omitted options must leave it intact.
    expect(observerOptions?.refetchOnWindowFocus).toBe(false);
    expect(observerOptions?.refetchInterval).toBeUndefined();
  });

  it("honors refetch options when the caller provides them", async () => {
    mocks.getSubagents.mockResolvedValue({ sessionId: "session-1", subagents: [] });
    const queryClient = createQueryClient();

    const { result } = renderHook(
      () => useSessionSubagentsQuery("session-1", {
        refetchInterval: 15_000,
        refetchOnWindowFocus: true,
      }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const observerOptions = queryClient.getQueryCache().getAll()[0]?.observers[0]?.options;
    expect(observerOptions?.refetchOnWindowFocus).toBe(true);
    expect(observerOptions?.refetchInterval).toBe(15_000);
  });
});

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AnyHarnessRuntime runtimeUrl="http://runtime-subagents.test">
          <AnyHarnessWorkspace
            workspaceId="workspace-1"
            resolveConnection={async () => ({
              runtimeUrl: "http://runtime-subagents.test",
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
