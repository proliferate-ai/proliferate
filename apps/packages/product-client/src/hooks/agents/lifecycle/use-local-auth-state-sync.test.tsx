// @vitest-environment jsdom

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAuthState } from "@proliferate/cloud-sdk";
import { useLocalAuthStateSync } from "#product/hooks/agents/lifecycle/use-local-auth-state-sync";
import {
  resetRendererDiagnosticsSinkForTest,
  setRendererDiagnosticsSink,
  type RendererDiagnosticInput,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";

const mocks = vi.hoisted(() => ({
  ackAgentAuthState: vi.fn(),
  applyAgentAuthState: vi.fn(),
  clearAgentAuthState: vi.fn(),
  invalidateAgentLaunchReadinessResources: vi.fn(),
  useAgentAuthState: vi.fn(),
  useAgentGatewayEnrollment: vi.fn(),
}));
let diagnostics: RendererDiagnosticInput[] = [];

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useAgentAuthState: mocks.useAgentAuthState,
  useAgentGatewayEnrollment: mocks.useAgentGatewayEnrollment,
  useCloudClient: () => ({ baseUrl: "https://api.example.test" }),
  agentAuthStateRootKey: () => ["agent-auth", "state"] as const,
  agentAuthSelectionsRootKey: () => ["agent-auth", "selections"] as const,
}));

vi.mock("@proliferate/cloud-sdk", () => ({
  ackAgentAuthState: mocks.ackAgentAuthState,
}));

vi.mock("#product/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({
    controlPlaneReachable: true,
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

function renderSyncHook(queryClient: QueryClient) {
  return renderHook(() => useLocalAuthStateSync(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

describe("useLocalAuthStateSync", () => {
  beforeEach(() => {
    diagnostics = [];
    setRendererDiagnosticsSink({ emit: (input) => diagnostics.push(input) });
  });

  afterEach(() => {
    resetRendererDiagnosticsSinkForTest();
    cleanup();
    vi.clearAllMocks();
  });

  it("applies gateway, clears to native, then applies API-key state and refreshes models", async () => {
    // Proof C3 (desktop hook half): rapid switches serialize through one
    // queue — no intermediate document is observable after a later one has
    // been scheduled behind it, and every completed push acks in order.
    let state = gatewayState();
    const gatewayApplied = deferred<{ applied: boolean; sequence: number }>();
    const nativeCleared = deferred<void>();
    mocks.useAgentGatewayEnrollment.mockReturnValue({
      data: { syncStatus: "synced" },
      isError: false,
    });
    mocks.useAgentAuthState.mockImplementation(() => ({ data: state }));
    mocks.applyAgentAuthState
      .mockImplementationOnce(() => gatewayApplied.promise)
      .mockResolvedValueOnce({ applied: true, sequence: 6 });
    mocks.clearAgentAuthState.mockImplementationOnce(() => nativeCleared.promise);
    mocks.ackAgentAuthState.mockResolvedValue({ surface: "local" });
    mocks.invalidateAgentLaunchReadinessResources.mockResolvedValue(undefined);

    const { rerender } = renderSyncHook(makeQueryClient());

    await waitFor(() => expect(mocks.applyAgentAuthState).toHaveBeenCalledTimes(1));
    // The pushed document is the served state WITHOUT the `fingerprint`
    // rider (not part of the state.json contract), stamped with the origin.
    expect(mocks.applyAgentAuthState.mock.calls[0]?.[1]).toEqual({
      ...stripFingerprint(gatewayState()),
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
    // No ack before the runtime confirms anything (Proof C1).
    expect(mocks.ackAgentAuthState).not.toHaveBeenCalled();

    gatewayApplied.resolve({ applied: true, sequence: 5 });
    await waitFor(() => expect(mocks.clearAgentAuthState).toHaveBeenCalledTimes(1));
    expect(mocks.applyAgentAuthState).toHaveBeenCalledTimes(1);
    // The gateway push acked with the served document's identity.
    await waitFor(() => expect(mocks.ackAgentAuthState).toHaveBeenCalledTimes(1));
    expect(mocks.ackAgentAuthState).toHaveBeenNthCalledWith(
      1,
      "local",
      { sequence: 5, fingerprint: "fp-gateway-5" },
      expect.anything(),
    );

    nativeCleared.resolve();
    await waitFor(() => expect(mocks.applyAgentAuthState).toHaveBeenCalledTimes(2));
    expect(mocks.applyAgentAuthState.mock.calls[1]?.[1]).toEqual({
      ...stripFingerprint(apiKeyState()),
      issuing_server_origin: "https://api.example.test",
    });
    await waitFor(() => {
      expect(mocks.invalidateAgentLaunchReadinessResources).toHaveBeenCalledTimes(3);
    });
    expect(mocks.invalidateAgentLaunchReadinessResources)
      .toHaveBeenLastCalledWith("http://runtime.test");
    // Every confirmed delivery acked, in order: gateway, clear, api-key.
    await waitFor(() => expect(mocks.ackAgentAuthState).toHaveBeenCalledTimes(3));
    expect(mocks.ackAgentAuthState).toHaveBeenNthCalledWith(
      2,
      "local",
      { sequence: 0, fingerprint: "fp-native-0" },
      expect.anything(),
    );
    expect(mocks.ackAgentAuthState).toHaveBeenNthCalledWith(
      3,
      "local",
      { sequence: 6, fingerprint: "fp-api-6" },
      expect.anything(),
    );
  });

  it("records no ack when the runtime push fails (Proof C1: pending stays visible)", async () => {
    const state = gatewayState();
    mocks.useAgentGatewayEnrollment.mockReturnValue({
      data: { syncStatus: "synced" },
      isError: false,
    });
    mocks.useAgentAuthState.mockReturnValue({ data: state });
    mocks.applyAgentAuthState.mockRejectedValueOnce(new Error("runtime down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    renderSyncHook(makeQueryClient());

    await waitFor(() => expect(mocks.applyAgentAuthState).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(mocks.ackAgentAuthState).not.toHaveBeenCalled();
    expect(mocks.invalidateAgentLaunchReadinessResources).not.toHaveBeenCalled();
    expect(diagnostics).toContainEqual(expect.objectContaining({
      name: "renderer.agent_auth.state_push_failed",
      errorClassification: "state_push_failed",
    }));
    warn.mockRestore();
  });

  it("retries the ack alone on the next pass after a transient ack failure", async () => {
    // The push succeeded — the runtime HAS the state — but the one-shot ack
    // POST blipped. The next sync pass sees an unchanged document (nothing to
    // re-push) with pushed !== acked, and retries only the stamp; without the
    // retry the server would stay unacked and the panes on "Applying…"
    // forever.
    let state = gatewayState();
    mocks.useAgentGatewayEnrollment.mockReturnValue({
      data: { syncStatus: "synced" },
      isError: false,
    });
    mocks.useAgentAuthState.mockImplementation(() => ({ data: state }));
    mocks.applyAgentAuthState.mockResolvedValue({ applied: true, sequence: 5 });
    mocks.ackAgentAuthState
      .mockRejectedValueOnce(new Error("ack endpoint blipped"))
      .mockResolvedValue({ surface: "local" });
    mocks.invalidateAgentLaunchReadinessResources.mockResolvedValue(undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { rerender } = renderSyncHook(makeQueryClient());

    await waitFor(() => expect(mocks.ackAgentAuthState).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(diagnostics).toContainEqual(expect.objectContaining({
      name: "renderer.agent_auth.delivery_ack_failed",
      errorClassification: "delivery_ack_failed",
    }));

    // Next pass: the refetched document is unchanged (same content, new
    // object identity, e.g. a query refetch) — recover the lost stamp.
    state = gatewayState();
    rerender();

    await waitFor(() => expect(mocks.ackAgentAuthState).toHaveBeenCalledTimes(2));
    expect(mocks.applyAgentAuthState).toHaveBeenCalledTimes(1);
    expect(mocks.ackAgentAuthState).toHaveBeenLastCalledWith(
      "local",
      { sequence: 5, fingerprint: "fp-gateway-5" },
      expect.anything(),
    );

    // Once acked, further unchanged passes stamp nothing again.
    state = gatewayState();
    rerender();
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.ackAgentAuthState).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("records launch-resource refresh failure after a successful delivery", async () => {
    mocks.useAgentGatewayEnrollment.mockReturnValue({
      data: { syncStatus: "synced" },
      isError: false,
    });
    mocks.useAgentAuthState.mockReturnValue({ data: gatewayState() });
    mocks.applyAgentAuthState.mockResolvedValue({ applied: true, sequence: 5 });
    mocks.ackAgentAuthState.mockResolvedValue({ surface: "local" });
    mocks.invalidateAgentLaunchReadinessResources.mockRejectedValue(
      new Error("resource refresh failed"),
    );
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    renderSyncHook(makeQueryClient());

    await waitFor(() => {
      expect(diagnostics).toContainEqual(expect.objectContaining({
        name: "renderer.agent_auth.launch_resource_refresh_failed",
        errorClassification: "launch_resource_refresh_failed",
      }));
    });
  });

  it("invalidates the auth-state query when the enrollment reaches synced (Proof C5 hook half)", async () => {
    // A state pulled before enrollment sync lacks the key; the server bumps
    // the surface sequence on sync (C-1's server half) and this hook makes
    // the re-pull happen NOW by invalidating the state query on the observed
    // pending→synced transition — no unrelated mutation needed.
    let enrollment: { data?: { syncStatus: string }; isError: boolean } = {
      data: { syncStatus: "pending" },
      isError: false,
    };
    mocks.useAgentGatewayEnrollment.mockImplementation(() => enrollment);
    mocks.useAgentAuthState.mockReturnValue({ data: undefined });
    const queryClient = makeQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const { rerender } = renderSyncHook(queryClient);
    expect(invalidate).not.toHaveBeenCalled();

    enrollment = { data: { syncStatus: "synced" }, isError: false };
    rerender();

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["agent-auth", "state"] });
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["agent-auth", "selections"] });
  });

  it("does not invalidate when the enrollment was synced from the first observation", async () => {
    mocks.useAgentGatewayEnrollment.mockReturnValue({
      data: { syncStatus: "synced" },
      isError: false,
    });
    mocks.useAgentAuthState.mockReturnValue({ data: undefined });
    const queryClient = makeQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const { rerender } = renderSyncHook(queryClient);
    rerender();
    await Promise.resolve();

    expect(invalidate).not.toHaveBeenCalled();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function stripFingerprint(state: AgentAuthState): Omit<AgentAuthState, "fingerprint"> {
  const { fingerprint: _fingerprint, ...rest } = state;
  return rest;
}

function gatewayState(): AgentAuthState {
  return {
    version: 2,
    sequence: 5,
    user_id: "user-1",
    fingerprint: "fp-gateway-5",
    harnesses: [{
      harness_kind: "codex",
      sources: [{ kind: "gateway", base_url: "https://gateway.test", key: "virtual" }],
    }],
  };
}

function nativeState(): AgentAuthState {
  return {
    version: 2,
    sequence: 0,
    user_id: "user-1",
    fingerprint: "fp-native-0",
    harnesses: [],
  };
}

function apiKeyState(): AgentAuthState {
  return {
    version: 2,
    sequence: 6,
    user_id: "user-1",
    fingerprint: "fp-api-6",
    harnesses: [{
      harness_kind: "codex",
      sources: [{ kind: "api_key", env_var_name: "OPENAI_API_KEY", value: "provider-key" }],
    }],
  };
}
