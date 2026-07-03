// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSummary } from "@anyharness/sdk";
import { useFirstRunAuthAdoption } from "./use-first-run-auth-adoption";

const state = vi.hoisted(() => ({
  cloudActive: true,
  capabilities: {
    data: { gatewayEnabled: true } as { gatewayEnabled: boolean } | undefined,
  },
  selections: {
    data: [] as Array<Record<string, unknown>> | undefined,
  },
  agents: [] as AgentSummary[],
  agentsLoading: false,
  reconcileSnapshot: {} as Record<string, unknown> | null,
  reconcileStatus: "completed" as string,
}));
const putMutate = vi.hoisted(() => vi.fn());

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useAgentGatewayCapabilities: () => state.capabilities,
  useAuthSelections: () => state.selections,
  usePutAuthSelections: () => ({ mutate: putMutate, isPending: false }),
}));

vi.mock("@/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({ cloudActive: state.cloudActive }),
}));

vi.mock("@/hooks/agents/derived/use-agent-catalog", () => ({
  useAgentCatalog: () => ({
    agents: state.agents,
    isLoading: state.agentsLoading,
    reconcileSnapshot: state.reconcileSnapshot,
    reconcileStatus: state.reconcileStatus,
  }),
}));

function agent(overrides: Partial<AgentSummary> = {}): AgentSummary {
  return {
    kind: "claude",
    displayName: "Claude Code",
    credentialState: "ready",
    installState: "installed",
    readiness: "ready",
    supportsLogin: true,
    ...overrides,
  } as AgentSummary;
}

const GATEWAY_BODY = { sources: [{ sourceKind: "gateway", enabled: true }] };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.cloudActive = true;
  state.capabilities.data = { gatewayEnabled: true };
  state.selections.data = [];
  state.agents = [];
  state.agentsLoading = false;
  state.reconcileSnapshot = {};
  state.reconcileStatus = "completed";
});

describe("useFirstRunAuthAdoption", () => {
  it("writes nothing when native creds are detected (native is implicit)", () => {
    state.agents = [
      agent({ kind: "claude" }),
      agent({ kind: "codex", credentialState: "login_required" }),
    ];

    renderHook(() => useFirstRunAuthAdoption());

    expect(putMutate).not.toHaveBeenCalled();
  });

  it("is a no-op when selections already exist", () => {
    state.agents = [agent({ kind: "claude", credentialState: "login_required" })];
    state.selections.data = [
      { harnessKind: "claude", surface: "local", sourceKind: "gateway", enabled: true },
    ];

    renderHook(() => useFirstRunAuthAdoption());

    expect(putMutate).not.toHaveBeenCalled();
  });

  it("preselects the gateway when nothing is detected and the gateway is enabled", () => {
    state.agents = [agent({ kind: "claude", credentialState: "login_required" })];

    renderHook(() => useFirstRunAuthAdoption());

    expect(putMutate).toHaveBeenCalledTimes(1);
    expect(putMutate).toHaveBeenCalledWith(
      { harnessKind: "claude", surface: "local", body: GATEWAY_BODY },
      expect.anything(),
    );
  });

  it("does nothing when nothing is detected and the gateway is disabled", () => {
    state.agents = [agent({ kind: "claude", credentialState: "login_required" })];
    state.capabilities.data = { gatewayEnabled: false };

    renderHook(() => useFirstRunAuthAdoption());

    expect(putMutate).not.toHaveBeenCalled();
  });

  it("waits for selections to load and then runs only once", () => {
    state.agents = [agent({ kind: "claude", credentialState: "login_required" })];
    state.selections.data = undefined;

    const { rerender } = renderHook(() => useFirstRunAuthAdoption());
    expect(putMutate).not.toHaveBeenCalled();

    state.selections.data = [];
    rerender();
    expect(putMutate).toHaveBeenCalledTimes(1);

    rerender();
    expect(putMutate).toHaveBeenCalledTimes(1);
  });

  it("waits for reconcile hydration to settle before deciding", () => {
    // Mid-hydration: the reconcile job is still running, so the one-shot
    // decision must not fire off a stale snapshot.
    state.reconcileStatus = "running";
    state.agents = [agent({ kind: "claude", credentialState: "login_required" })];

    const { rerender } = renderHook(() => useFirstRunAuthAdoption());
    expect(putMutate).not.toHaveBeenCalled();

    state.reconcileStatus = "completed";
    state.agents = [agent({ kind: "claude", credentialState: "login_required" })];
    rerender();

    expect(putMutate).toHaveBeenCalledTimes(1);
    expect(putMutate).toHaveBeenCalledWith(
      { harnessKind: "claude", surface: "local", body: GATEWAY_BODY },
      expect.anything(),
    );
  });

  it("waits until a reconcile snapshot exists before deciding", () => {
    state.reconcileSnapshot = null;
    state.agents = [agent({ kind: "claude", credentialState: "login_required" })];

    const { rerender } = renderHook(() => useFirstRunAuthAdoption());
    expect(putMutate).not.toHaveBeenCalled();

    state.reconcileSnapshot = {};
    rerender();
    expect(putMutate).toHaveBeenCalledTimes(1);
  });

  it("does nothing while cloud is inactive", () => {
    state.cloudActive = false;
    state.agents = [agent({ kind: "claude", credentialState: "login_required" })];

    renderHook(() => useFirstRunAuthAdoption());

    expect(putMutate).not.toHaveBeenCalled();
  });
});
