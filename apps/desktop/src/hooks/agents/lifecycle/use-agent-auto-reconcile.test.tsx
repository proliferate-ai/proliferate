// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAgentAutoReconcile } from "./use-agent-auto-reconcile";

const mocks = vi.hoisted(() => ({
  invalidateAgentListResources: vi.fn(),
  reconcileAgents: vi.fn(),
  useAgentCatalog: vi.fn(),
  useHarnessConnectionStore: vi.fn(),
  useRuntimeHealthQuery: vi.fn(),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useRuntimeHealthQuery: mocks.useRuntimeHealthQuery,
}));

vi.mock("@/stores/sessions/harness-connection-store", () => ({
  useHarnessConnectionStore: mocks.useHarnessConnectionStore,
}));

vi.mock("@/hooks/access/anyharness/agents/use-agent-resources-cache", () => ({
  useAgentResourcesCache: () => ({
    invalidateAgentListResources: mocks.invalidateAgentListResources,
  }),
}));

vi.mock("@/hooks/agents/derived/use-agent-catalog", () => ({
  useAgentCatalog: mocks.useAgentCatalog,
}));

vi.mock("@/hooks/agents/workflows/use-agent-installation-actions", () => ({
  useAgentInstallationActions: () => ({
    reconcileAgents: mocks.reconcileAgents,
  }),
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
});

function arrange() {
  mocks.invalidateAgentListResources.mockResolvedValue(undefined);
  mocks.reconcileAgents.mockResolvedValue(undefined);
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
  mocks.useAgentCatalog.mockReturnValue({
    agentsNeedingSetup: [],
    hasAgents: true,
    isLoading: false,
    isReconciling: false,
    reconcileDataUpdatedAt: 0,
    reconcileStatus: "idle",
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
