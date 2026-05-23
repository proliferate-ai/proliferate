// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAgentCatalog } from "./use-agent-catalog";

const mocks = vi.hoisted(() => ({
  useAgentReconcileStatusQuery: vi.fn(),
  useAgentsQuery: vi.fn(),
  useRuntimeHealthQuery: vi.fn(),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useAgentReconcileStatusQuery: mocks.useAgentReconcileStatusQuery,
  useAgentsQuery: mocks.useAgentsQuery,
  useRuntimeHealthQuery: mocks.useRuntimeHealthQuery,
}));

describe("useAgentCatalog", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("polls the agent list while the bundled agent seed is hydrating", () => {
    arrange({
      agentSeedStatus: "hydrating",
    });

    renderHook(() => useAgentCatalog());

    expect(mocks.useRuntimeHealthQuery).toHaveBeenCalledWith({
      pollWhileAgentSeedHydrating: true,
    });
    expect(mocks.useAgentsQuery).toHaveBeenCalledWith({
      refetchInterval: 1_000,
    });
  });

  it("leaves the agent list on normal cache cadence after seed hydration finishes", () => {
    arrange({
      agentSeedStatus: "ready",
    });

    renderHook(() => useAgentCatalog());

    expect(mocks.useAgentsQuery).toHaveBeenCalledWith({
      refetchInterval: false,
    });
  });
});

function arrange({ agentSeedStatus }: { agentSeedStatus: string }) {
  mocks.useRuntimeHealthQuery.mockReturnValue({
    data: {
      agentSeed: {
        status: agentSeedStatus,
      },
    },
  });
  mocks.useAgentsQuery.mockReturnValue({
    data: [],
    error: null,
    isError: false,
  });
  mocks.useAgentReconcileStatusQuery.mockReturnValue({
    data: null,
    dataUpdatedAt: 0,
  });
}
