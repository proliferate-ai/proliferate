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
    data: { selections: [] as Array<Record<string, unknown>> } as
      | { selections: Array<Record<string, unknown>> }
      | undefined,
  },
  agents: [] as AgentSummary[],
  agentsLoading: false,
  reconcileSnapshot: {} as Record<string, unknown> | null,
  reconcileStatus: "completed" as string,
}));
const upsertMutate = vi.hoisted(() => vi.fn());

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useAgentGatewayCapabilities: () => state.capabilities,
  useRouteSelections: () => state.selections,
  useUpsertRouteSelection: () => ({ mutate: upsertMutate, isPending: false }),
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.cloudActive = true;
  state.capabilities.data = { gatewayEnabled: true };
  state.selections.data = { selections: [] };
  state.agents = [];
  state.agentsLoading = false;
  state.reconcileSnapshot = {};
  state.reconcileStatus = "completed";
});

describe("useFirstRunAuthAdoption", () => {
  it("adopts detected native auth when no selections exist", () => {
    state.agents = [
      agent({ kind: "claude" }),
      agent({ kind: "codex", credentialState: "login_required" }),
    ];

    renderHook(() => useFirstRunAuthAdoption());

    expect(upsertMutate).toHaveBeenCalledTimes(1);
    expect(upsertMutate).toHaveBeenCalledWith(
      {
        harnessKind: "claude",
        surface: "local",
        body: { route: "native" },
      },
      expect.anything(),
    );
  });

  it("is a no-op when selections already exist", () => {
    state.agents = [agent({ kind: "claude" })];
    state.selections.data = {
      selections: [{ harnessKind: "claude", surface: "local", route: "gateway" }],
    };

    renderHook(() => useFirstRunAuthAdoption());

    expect(upsertMutate).not.toHaveBeenCalled();
  });

  it("preselects the gateway when nothing is detected and the gateway is enabled", () => {
    state.agents = [agent({ kind: "claude", credentialState: "login_required" })];

    renderHook(() => useFirstRunAuthAdoption());

    expect(upsertMutate).toHaveBeenCalledTimes(1);
    expect(upsertMutate).toHaveBeenCalledWith(
      {
        harnessKind: "claude",
        surface: "local",
        body: { route: "gateway" },
      },
      expect.anything(),
    );
  });

  it("does nothing when nothing is detected and the gateway is disabled", () => {
    state.agents = [agent({ kind: "claude", credentialState: "login_required" })];
    state.capabilities.data = { gatewayEnabled: false };

    renderHook(() => useFirstRunAuthAdoption());

    expect(upsertMutate).not.toHaveBeenCalled();
  });

  it("waits for selections to load and then runs only once", () => {
    state.agents = [agent({ kind: "claude" })];
    state.selections.data = undefined;

    const { rerender } = renderHook(() => useFirstRunAuthAdoption());
    expect(upsertMutate).not.toHaveBeenCalled();

    state.selections.data = { selections: [] };
    rerender();
    expect(upsertMutate).toHaveBeenCalledTimes(1);

    rerender();
    expect(upsertMutate).toHaveBeenCalledTimes(1);
  });

  it("waits for reconcile hydration to settle before deciding, then adopts freshly-hydrated native creds", () => {
    // Mid-hydration: the reconcile job is still running and Codex has not yet
    // had its native credentials detected (reads login_required for now).
    state.reconcileStatus = "running";
    state.agents = [
      agent({ kind: "claude", credentialState: "login_required" }),
      agent({ kind: "codex", credentialState: "login_required" }),
    ];

    const { rerender } = renderHook(() => useFirstRunAuthAdoption());
    // A mid-hydration snapshot must NOT drive the one-shot decision.
    expect(upsertMutate).not.toHaveBeenCalled();

    // Reconcile settles and Codex's native creds are now detected.
    state.reconcileStatus = "completed";
    state.agents = [
      agent({ kind: "claude", credentialState: "login_required" }),
      agent({ kind: "codex", credentialState: "ready" }),
    ];
    rerender();

    expect(upsertMutate).toHaveBeenCalledTimes(1);
    expect(upsertMutate).toHaveBeenCalledWith(
      {
        harnessKind: "codex",
        surface: "local",
        body: { route: "native" },
      },
      expect.anything(),
    );
  });

  it("waits until a reconcile snapshot exists before deciding", () => {
    state.reconcileSnapshot = null;
    state.agents = [agent({ kind: "claude" })];

    const { rerender } = renderHook(() => useFirstRunAuthAdoption());
    expect(upsertMutate).not.toHaveBeenCalled();

    state.reconcileSnapshot = {};
    rerender();
    expect(upsertMutate).toHaveBeenCalledTimes(1);
  });

  it("does nothing while cloud is inactive", () => {
    state.cloudActive = false;
    state.agents = [agent({ kind: "claude" })];

    renderHook(() => useFirstRunAuthAdoption());

    expect(upsertMutate).not.toHaveBeenCalled();
  });
});
