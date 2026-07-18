// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAgentAutoReconcile } from "#product/hooks/agents/lifecycle/use-agent-auto-reconcile";

const mocks = vi.hoisted(() => ({
  invalidateAgentListResources: vi.fn(),
  useAgentCatalog: vi.fn(),
  useHarnessConnectionStore: vi.fn(),
  useRuntimeHealthQuery: vi.fn(),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useRuntimeHealthQuery: mocks.useRuntimeHealthQuery,
}));

vi.mock("#product/stores/sessions/harness-connection-store", () => ({
  useHarnessConnectionStore: mocks.useHarnessConnectionStore,
}));

vi.mock("#product/hooks/access/anyharness/agents/use-agent-resources-cache", () => ({
  useAgentResourcesCache: () => ({
    invalidateAgentListResources: mocks.invalidateAgentListResources,
  }),
}));

vi.mock("#product/hooks/agents/derived/use-agent-catalog", () => ({
  useAgentCatalog: mocks.useAgentCatalog,
}));

describe("useAgentAutoReconcile", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("refreshes agents during seed hydration and once after hydration completes", async () => {
    arrange();
    setRuntimeHealth("hydrating", 1);

    const { rerender } = renderHook(() => useAgentAutoReconcile());

    await waitFor(() => {
      expect(mocks.invalidateAgentListResources).toHaveBeenCalledTimes(1);
    });
    expect(mocks.invalidateAgentListResources)
      .toHaveBeenLastCalledWith("http://runtime.test");

    setRuntimeHealth("ready", 2);
    rerender();

    await waitFor(() => {
      expect(mocks.invalidateAgentListResources).toHaveBeenCalledTimes(2);
    });
    expect(mocks.invalidateAgentListResources)
      .toHaveBeenLastCalledWith("http://runtime.test");
  });

  it("retries failed terminal refreshes and records only successful jobs", async () => {
    arrange();
    mocks.invalidateAgentListResources
      .mockRejectedValueOnce(new Error("transient refresh failure"))
      .mockResolvedValue(undefined);
    setRuntimeHealth("ready", 1);
    setAgentCatalog({ reconcileDataUpdatedAt: 1 });
    const { rerender } = renderHook(() => useAgentAutoReconcile());

    setAgentCatalog({
      reconcileDataUpdatedAt: 2,
      reconcileSnapshot: { jobId: "job-a" },
      reconcileStatus: "completed",
    });
    rerender();
    await waitFor(() => {
      expect(mocks.invalidateAgentListResources).toHaveBeenCalledTimes(1);
    });
    expect(mocks.invalidateAgentListResources).toHaveBeenLastCalledWith(
      "http://runtime.test",
      { throwOnError: true },
    );

    setAgentCatalog({
      reconcileDataUpdatedAt: 3,
      reconcileSnapshot: { jobId: "job-a" },
      reconcileStatus: "completed",
    });
    rerender();
    await waitFor(() => {
      expect(mocks.invalidateAgentListResources).toHaveBeenCalledTimes(2);
    });

    setAgentCatalog({
      reconcileDataUpdatedAt: 4,
      reconcileSnapshot: { jobId: "job-a" },
      reconcileStatus: "completed",
    });
    rerender();
    expect(mocks.invalidateAgentListResources).toHaveBeenCalledTimes(2);

    setAgentCatalog({
      reconcileDataUpdatedAt: 5,
      reconcileSnapshot: { jobId: "job-b" },
      reconcileStatus: "failed",
    });
    rerender();
    await waitFor(() => {
      expect(mocks.invalidateAgentListResources).toHaveBeenCalledTimes(3);
    });
  });

});

function arrange() {
  mocks.invalidateAgentListResources.mockResolvedValue(undefined);
  mocks.useHarnessConnectionStore.mockImplementation((
    selector: (state: {
      connectionState: string;
      runtimeUrl: string;
    }) => unknown,
  ) =>
    selector({
      connectionState: "healthy",
      runtimeUrl: "http://runtime.test",
    })
  );
  setAgentCatalog();
}

function setAgentCatalog(
  overrides: Partial<{
    agentsNeedingSetup: Array<{ readiness: string }>;
    hasAgents: boolean;
    isLoading: boolean;
    isReconciling: boolean;
    reconcileDataUpdatedAt: number;
    reconcileSnapshot: { jobId?: string | null } | null;
    reconcileStatus: string;
  }> = {},
) {
  mocks.useAgentCatalog.mockReturnValue({
    agentsNeedingSetup: [],
    hasAgents: true,
    isLoading: false,
    isReconciling: false,
    reconcileDataUpdatedAt: 0,
    reconcileSnapshot: null,
    reconcileStatus: "idle",
    ...overrides,
  });
}

function setRuntimeHealth(status: string, dataUpdatedAt: number) {
  mocks.useRuntimeHealthQuery.mockReturnValue({
    data: {
      agentSeed: {
        status,
      },
    },
    dataUpdatedAt,
    isLoading: false,
  });
}
