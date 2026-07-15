// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAgentResourcesCache } from "#product/hooks/access/anyharness/agents/use-agent-resources-cache";

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock("@anyharness/sdk-react", () => ({
  anyHarnessAgentsKey: (runtimeUrl: string, scope: string) =>
    ["anyharness", scope, "runtime", runtimeUrl, "agents"],
  anyHarnessAgentReconcileStatusKey: (runtimeUrl: string, scope: string) =>
    ["anyharness", scope, "runtime", runtimeUrl, "agents", "reconcile-status"],
  anyHarnessAgentLaunchOptionsPrefixKey: (runtimeUrl: string, scope: string) =>
    ["anyharness", scope, "runtime", runtimeUrl, "agents", "launch-options"],
  anyHarnessAgentGatewayModelsPrefixKey: (runtimeUrl: string, scope: string) =>
    ["anyharness", scope, "runtime", runtimeUrl, "agents", "gateway-models"],
  useAnyHarnessCacheScopeKey: () => "account-1",
}));

describe("useAgentResourcesCache", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("invalidates launch options and gateway models after an auth-route change", async () => {
    mocks.invalidateQueries.mockResolvedValue(undefined);
    const { result } = renderHook(() => useAgentResourcesCache());

    await act(async () => {
      await result.current.invalidateAgentLaunchReadinessResources("http://runtime.test");
    });

    const keys = mocks.invalidateQueries.mock.calls.map(([input]) => input.queryKey);
    expect(keys).toContainEqual([
      "anyharness",
      "account-1",
      "runtime",
      "http://runtime.test",
      "agents",
      "launch-options",
    ]);
    expect(keys).toContainEqual([
      "anyharness",
      "account-1",
      "runtime",
      "http://runtime.test",
      "agents",
      "gateway-models",
    ]);
  });
});
