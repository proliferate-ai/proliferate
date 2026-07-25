// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAgentAutoReconcile } from "./use-agent-auto-reconcile";

const mocks = vi.hoisted(() => ({
  connectionState: "healthy",
  invalidateAgentListResources: vi.fn(),
  invalidateAgentSetupResources: vi.fn(),
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
    invalidateAgentSetupResources: mocks.invalidateAgentSetupResources,
  }),
}));

vi.mock("@/hooks/agents/derived/use-agent-catalog", () => ({
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
      expect(mocks.invalidateAgentSetupResources).toHaveBeenCalledTimes(1);
    });
    expect(mocks.invalidateAgentSetupResources)
      .toHaveBeenLastCalledWith("http://runtime.test");
    expect(mocks.invalidateAgentListResources).toHaveBeenCalledTimes(1);
  });

  it("keeps agents fresh as the automatic reconcile runs and completes", async () => {
    arrange();
    setRuntimeHealth("ready", 1);
    setAgentCatalog({
      isReconciling: true,
      reconcileDataUpdatedAt: 1,
      reconcileStatus: "running",
    });

    const { rerender } = renderHook(() => useAgentAutoReconcile());

    await waitFor(() => {
      expect(mocks.invalidateAgentListResources).toHaveBeenCalledTimes(1);
    });

    setAgentCatalog({
      isReconciling: false,
      reconcileDataUpdatedAt: 2,
      reconcileStatus: "completed",
    });
    rerender();

    await waitFor(() => {
      expect(mocks.invalidateAgentListResources).toHaveBeenCalledTimes(2);
    });
  });

  it("refreshes a stale idle snapshot when the first health response is already settled", async () => {
    arrange();
    setRuntimeHealth("ready", 1, "idle");

    renderHook(() => useAgentAutoReconcile());

    await waitFor(() => {
      expect(mocks.invalidateAgentSetupResources).toHaveBeenCalledOnce();
    });
    expect(mocks.invalidateAgentSetupResources)
      .toHaveBeenCalledWith("http://runtime.test");
  });

  it("treats a same-url sidecar restart as a new health observation", async () => {
    arrange();
    setRuntimeHealth("ready", 1);

    const { rerender } = renderHook(() => useAgentAutoReconcile());

    await waitFor(() => {
      expect(mocks.invalidateAgentSetupResources).toHaveBeenCalledOnce();
    });

    mocks.connectionState = "connecting";
    rerender();
    mocks.invalidateAgentSetupResources.mockClear();

    mocks.connectionState = "healthy";
    rerender();

    await waitFor(() => {
      expect(mocks.invalidateAgentSetupResources).toHaveBeenCalledOnce();
    });
  });

});

function arrange() {
  mocks.connectionState = "healthy";
  mocks.invalidateAgentListResources.mockResolvedValue(undefined);
  mocks.invalidateAgentSetupResources.mockResolvedValue(undefined);
  mocks.useHarnessConnectionStore.mockImplementation((
    selector: (state: {
      connectionState: string;
      runtimeUrl: string;
    }) => unknown,
  ) =>
    selector({
      connectionState: mocks.connectionState,
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
    reconcileStatus: string;
  }> = {},
) {
  mocks.useAgentCatalog.mockReturnValue({
    agentsNeedingSetup: [],
    hasAgents: true,
    isLoading: false,
    isReconciling: false,
    reconcileDataUpdatedAt: 0,
    reconcileStatus: "idle",
    ...overrides,
  });
}

function setRuntimeHealth(
  status: string,
  dataUpdatedAt: number,
  reconcileStatus: string = "idle",
) {
  mocks.useRuntimeHealthQuery.mockReturnValue({
    data: {
      agentSeed: {
        status,
      },
      agentReconcile: {
        status: reconcileStatus,
      },
    },
    dataUpdatedAt,
    isLoading: false,
  });
}
