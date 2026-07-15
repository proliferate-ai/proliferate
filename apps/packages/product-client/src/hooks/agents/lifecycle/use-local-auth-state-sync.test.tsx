// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentAuthState } from "@proliferate/cloud-sdk";
import { useLocalAuthStateSync } from "#product/hooks/agents/lifecycle/use-local-auth-state-sync";

const mocks = vi.hoisted(() => ({
  applyAgentAuthState: vi.fn(),
  clearAgentAuthState: vi.fn(),
  invalidateAgentLaunchReadinessResources: vi.fn(),
  useAgentAuthState: vi.fn(),
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useAgentAuthState: mocks.useAgentAuthState,
}));

vi.mock("#product/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({
    cloudEnabled: true,
    authStatus: "authenticated",
  }),
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({ deployment: { apiBaseUrl: "https://api.example.test/v1" } }),
}));

vi.mock("#product/lib/access/anyharness/agent-auth", () => ({
  applyAgentAuthState: mocks.applyAgentAuthState,
  clearAgentAuthState: mocks.clearAgentAuthState,
}));

vi.mock("#product/lib/infra/proliferate-api", () => ({
  getProliferateApiOrigin: () => "https://api.example.test",
}));

vi.mock("#product/stores/sessions/harness-connection-store", () => ({
  useHarnessConnectionStore: (selector: (state: {
    connectionState: string;
    runtimeUrl: string;
  }) => unknown) => selector({
    connectionState: "healthy",
    runtimeUrl: "http://runtime.test",
  }),
}));

vi.mock("#product/hooks/access/anyharness/agents/use-agent-resources-cache", () => ({
  useAgentResourcesCache: () => ({
    invalidateAgentLaunchReadinessResources:
      mocks.invalidateAgentLaunchReadinessResources,
  }),
}));

describe("useLocalAuthStateSync", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("applies gateway, clears to native, then applies API-key state and refreshes models", async () => {
    let state = gatewayState();
    const gatewayApplied = deferred<{ applied: boolean; revision: number }>();
    const nativeCleared = deferred<void>();
    mocks.useAgentAuthState.mockImplementation(() => ({ data: state }));
    mocks.applyAgentAuthState
      .mockImplementationOnce(() => gatewayApplied.promise)
      .mockResolvedValueOnce({ applied: true, revision: 6 });
    mocks.clearAgentAuthState.mockImplementationOnce(() => nativeCleared.promise);
    mocks.invalidateAgentLaunchReadinessResources.mockResolvedValue(undefined);

    const { rerender } = renderHook(() => useLocalAuthStateSync());

    await waitFor(() => expect(mocks.applyAgentAuthState).toHaveBeenCalledTimes(1));
    expect(mocks.applyAgentAuthState.mock.calls[0]?.[1]).toEqual({
      ...gatewayState(),
      issuing_server_origin: "https://api.example.test",
    });

    state = nativeState();
    rerender();
    await Promise.resolve();
    expect(mocks.clearAgentAuthState).not.toHaveBeenCalled();

    state = apiKeyState();
    rerender();
    await Promise.resolve();
    expect(mocks.clearAgentAuthState).not.toHaveBeenCalled();
    expect(mocks.applyAgentAuthState).toHaveBeenCalledTimes(1);

    gatewayApplied.resolve({ applied: true, revision: 5 });
    await waitFor(() => expect(mocks.clearAgentAuthState).toHaveBeenCalledTimes(1));
    expect(mocks.applyAgentAuthState).toHaveBeenCalledTimes(1);

    nativeCleared.resolve();
    await waitFor(() => expect(mocks.applyAgentAuthState).toHaveBeenCalledTimes(2));
    expect(mocks.applyAgentAuthState.mock.calls[1]?.[1]).toEqual({
      ...apiKeyState(),
      issuing_server_origin: "https://api.example.test",
    });
    await waitFor(() => {
      expect(mocks.invalidateAgentLaunchReadinessResources).toHaveBeenCalledTimes(3);
    });
    expect(mocks.invalidateAgentLaunchReadinessResources)
      .toHaveBeenLastCalledWith("http://runtime.test");
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function gatewayState(): AgentAuthState {
  return {
    version: 2,
    revision: 5,
    user_id: "user-1",
    harnesses: [{
      harness_kind: "codex",
      sources: [{ kind: "gateway", base_url: "https://gateway.test", key: "virtual" }],
    }],
  };
}

function nativeState(): AgentAuthState {
  return {
    version: 2,
    revision: 0,
    user_id: "user-1",
    harnesses: [],
  };
}

function apiKeyState(): AgentAuthState {
  return {
    version: 2,
    revision: 6,
    user_id: "user-1",
    harnesses: [{
      harness_kind: "codex",
      sources: [{ kind: "api_key", env_var_name: "OPENAI_API_KEY", value: "provider-key" }],
    }],
  };
}
