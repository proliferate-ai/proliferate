// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnyHarnessRuntime } from "../context/AnyHarnessRuntime.js";
import { anyHarnessAgentsKey } from "../lib/query-keys.js";
import { useAgentsQuery } from "./agents.js";

const mocks = vi.hoisted(() => ({
  listAgents: vi.fn(),
}));

vi.mock("../lib/client-cache.js", () => ({
  getAnyHarnessClient: () => ({
    agents: {
      list: mocks.listAgents,
    },
  }),
}));

describe("sdk-react agent hooks", () => {
  afterEach(() => {
    cleanup();
    mocks.listAgents.mockReset();
  });

  it("passes query signals and refetch interval without adding them to agent query keys", async () => {
    mocks.listAgents.mockResolvedValue([]);
    const runtimeUrl = "http://runtime-agents.test";
    const queryClient = createQueryClient();

    const { result } = renderHook(() => useAgentsQuery({
      refetchInterval: 1_000,
    }), {
      wrapper: createWrapper(queryClient, runtimeUrl),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mocks.listAgents).toHaveBeenCalledWith(expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
    const query = queryClient.getQueryCache().find({
      queryKey: anyHarnessAgentsKey(runtimeUrl),
    });
    expect(query?.options.refetchInterval).toBe(1_000);
    expect(JSON.stringify(queryClient.getQueryCache().getAll().map((q) => q.queryKey)))
      .not
      .toContain("1000");
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
          {children}
        </AnyHarnessRuntime>
      </QueryClientProvider>
    );
  };
}
