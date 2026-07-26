// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAgentLoginTerminalWorkflow } from "#product/hooks/agents/workflows/use-agent-login-terminal-workflow";

const mocks = vi.hoisted(() => ({
  closeLoginTerminalMutate: vi.fn(),
  cloudSandboxGatewayRuntimeUrl: vi.fn(),
  getSandboxGatewayAccessToken: vi.fn(),
  invalidateAgentLaunchReadinessResources: vi.fn(),
  startLoginTerminalMutate: vi.fn(),
  useAnyHarnessRuntimeContext: vi.fn(),
  harnessConnectionState: vi.fn(() => "healthy"),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useAnyHarnessRuntimeContext: mocks.useAnyHarnessRuntimeContext,
  useStartAgentLoginTerminalMutation: () => ({
    mutateAsync: mocks.startLoginTerminalMutate,
  }),
  useCloseAgentLoginTerminalMutation: () => ({
    mutateAsync: mocks.closeLoginTerminalMutate,
  }),
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    cloud: {
      client: { buildUrl: (path: string) => `https://api.test${path}` },
      getSandboxGatewayAccessToken: mocks.getSandboxGatewayAccessToken,
    },
  }),
}));

vi.mock("#product/hooks/access/anyharness/agents/use-agent-resources-cache", () => ({
  useAgentResourcesCache: () => ({
    invalidateAgentLaunchReadinessResources: mocks.invalidateAgentLaunchReadinessResources,
  }),
}));

vi.mock("#product/stores/sessions/harness-connection-store", () => ({
  useHarnessConnectionStore: (selector: (state: {
    connectionState: string;
    runtimeUrl: string;
  }) => unknown) => selector({
    connectionState: mocks.harnessConnectionState(),
    runtimeUrl: "http://127.0.0.1:8457",
  }),
}));

function agent(kind = "claude") {
  return { kind, displayName: kind, readiness: "login_required", supportsLogin: true } as never;
}

describe("useAgentLoginTerminalWorkflow", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.harnessConnectionState.mockReturnValue("healthy");
  });

  it("local surface: resolves baseUrl/authToken from the AnyHarness runtime context, no token mint", async () => {
    mocks.useAnyHarnessRuntimeContext.mockReturnValue({
      runtimeUrl: "http://127.0.0.1:8457",
      authToken: "local-runtime-token",
    });
    mocks.startLoginTerminalMutate.mockResolvedValue({
      agentLoginTerminal: { id: "term-1", status: "running" },
      message: null,
    });

    const { result } = renderHook(() => useAgentLoginTerminalWorkflow("local"));

    expect(result.current.runtimeConnection).toEqual({
      baseUrl: "http://127.0.0.1:8457",
      authToken: "local-runtime-token",
      webSocketAuthTransport: undefined,
    });

    await act(async () => {
      await result.current.openAuthTerminal(agent());
    });

    expect(mocks.getSandboxGatewayAccessToken).not.toHaveBeenCalled();
    expect(mocks.startLoginTerminalMutate).toHaveBeenCalledWith("claude");
    expect(result.current.sessionsByKind.claude?.terminal?.id).toBe("term-1");
  });

  it("cloud surface: resolves baseUrl via cloudSandboxGatewayRuntimeUrl and mints a fresh token per open", async () => {
    mocks.useAnyHarnessRuntimeContext.mockReturnValue({
      runtimeUrl: "https://api.test/v1/gateway/cloud-sandbox/anyharness",
      authToken: undefined,
    });
    mocks.getSandboxGatewayAccessToken
      .mockResolvedValueOnce("cloud-token-1")
      .mockResolvedValueOnce("cloud-token-2");
    mocks.startLoginTerminalMutate.mockResolvedValue({
      agentLoginTerminal: { id: "term-cloud", status: "running" },
      message: null,
    });

    const { result } = renderHook(() => useAgentLoginTerminalWorkflow("cloud"));

    // Surface-aware: the cloud sandbox gateway URL, not the local store's
    // runtimeUrl — and the WS subprotocol transport (B3), never the query
    // string, since this carries the 7-day product JWT.
    expect(result.current.runtimeConnection.baseUrl).toBe(
      "https://api.test/v1/gateway/cloud-sandbox/anyharness",
    );
    expect(result.current.runtimeConnection.webSocketAuthTransport).toBe("protocol");
    expect(result.current.runtimeConnection.authToken).toBeUndefined();

    await act(async () => {
      await result.current.openAuthTerminal(agent());
    });

    expect(mocks.getSandboxGatewayAccessToken).toHaveBeenCalledTimes(1);
    expect(result.current.runtimeConnection.authToken).toBe("cloud-token-1");

    // A restart re-mints rather than reusing the first-open token.
    await act(async () => {
      await result.current.openAuthTerminal(agent(), { restart: true });
    });
    expect(mocks.getSandboxGatewayAccessToken).toHaveBeenCalledTimes(2);
    expect(result.current.runtimeConnection.authToken).toBe("cloud-token-2");
  });

  it("cloud surface: runtimeReady is false (and open is rejected) when no cloud client resolves a base URL", async () => {
    mocks.useAnyHarnessRuntimeContext.mockReturnValue({ runtimeUrl: null, authToken: undefined });

    const { result } = renderHook(() => useAgentLoginTerminalWorkflow("cloud"));
    expect(result.current.runtimeConnection.baseUrl).toBe("");

    await act(async () => {
      await result.current.openAuthTerminal(agent());
    });

    expect(mocks.startLoginTerminalMutate).not.toHaveBeenCalled();
    expect(result.current.sessionsByKind.claude?.errorMessage).toBe(
      "AnyHarness runtime is not available.",
    );
  });

  it("local surface: runtimeReady is false when the harness connection store is not healthy", async () => {
    mocks.harnessConnectionState.mockReturnValue("connecting");
    mocks.useAnyHarnessRuntimeContext.mockReturnValue({ runtimeUrl: null, authToken: undefined });

    const { result } = renderHook(() => useAgentLoginTerminalWorkflow("local"));

    await act(async () => {
      await result.current.openAuthTerminal(agent());
    });

    expect(mocks.startLoginTerminalMutate).not.toHaveBeenCalled();
    expect(result.current.sessionsByKind.claude?.errorMessage).toBe(
      "AnyHarness runtime is not available.",
    );
  });

  it("does not poll readiness on the cloud surface even with an active session (M6)", async () => {
    vi.useFakeTimers();
    mocks.useAnyHarnessRuntimeContext.mockReturnValue({
      runtimeUrl: "https://api.test/v1/gateway/cloud-sandbox/anyharness",
      authToken: undefined,
    });
    mocks.getSandboxGatewayAccessToken.mockResolvedValue("cloud-token");
    mocks.startLoginTerminalMutate.mockResolvedValue({
      agentLoginTerminal: { id: "term-cloud", status: "running" },
      message: null,
    });
    mocks.invalidateAgentLaunchReadinessResources.mockResolvedValue(undefined);

    const { result } = renderHook(() => useAgentLoginTerminalWorkflow("cloud"));
    await act(async () => {
      await result.current.openAuthTerminal(agent());
    });
    mocks.invalidateAgentLaunchReadinessResources.mockClear();

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(mocks.invalidateAgentLaunchReadinessResources).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("polls readiness on the local surface while a session is active", async () => {
    vi.useFakeTimers();
    mocks.useAnyHarnessRuntimeContext.mockReturnValue({
      runtimeUrl: "http://127.0.0.1:8457",
      authToken: "local-runtime-token",
    });
    mocks.startLoginTerminalMutate.mockResolvedValue({
      agentLoginTerminal: { id: "term-1", status: "running" },
      message: null,
    });
    mocks.invalidateAgentLaunchReadinessResources.mockResolvedValue(undefined);

    const { result } = renderHook(() => useAgentLoginTerminalWorkflow("local"));
    await act(async () => {
      await result.current.openAuthTerminal(agent());
    });
    mocks.invalidateAgentLaunchReadinessResources.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    expect(mocks.invalidateAgentLaunchReadinessResources).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
