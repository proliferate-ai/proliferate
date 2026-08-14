// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSummary } from "@anyharness/sdk";
import { useFirstRunAuthAdoption } from "#product/hooks/agents/lifecycle/use-first-run-auth-adoption";
import { useAuthSetupOnboardingStore } from "#product/stores/agents/auth-setup-onboarding-store";
import {
  resetRendererDiagnosticsSinkForTest,
  setRendererDiagnosticsSink,
  type RendererDiagnosticInput,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";

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
let diagnostics: RendererDiagnosticInput[] = [];

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useAgentGatewayCapabilities: () => state.capabilities,
  useAuthSelections: () => state.selections,
  usePutAuthSelections: () => ({ mutate: putMutate, isPending: false }),
}));

vi.mock("#product/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({ cloudActive: state.cloudActive }),
}));

vi.mock("#product/hooks/agents/derived/use-agent-catalog", () => ({
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

/** The planner is dynamically imported (login-chunk split); let it settle. */
async function flushAdoption() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** The decision ran (possibly adopting nothing) once the store has recorded it. */
async function waitForDecision() {
  await waitFor(() => {
    expect(useAuthSetupOnboardingStore.getState().adoptedHarnessKinds).not.toBeNull();
  });
}

beforeEach(() => {
  diagnostics = [];
  setRendererDiagnosticsSink({ emit: (input) => diagnostics.push(input) });
});

afterEach(() => {
  resetRendererDiagnosticsSinkForTest();
  cleanup();
  vi.clearAllMocks();
  useAuthSetupOnboardingStore.getState().resetForTests();
  state.cloudActive = true;
  state.capabilities.data = { gatewayEnabled: true };
  state.selections.data = [];
  state.agents = [];
  state.agentsLoading = false;
  state.reconcileSnapshot = {};
  state.reconcileStatus = "completed";
});

describe("useFirstRunAuthAdoption", () => {
  it("writes nothing when native creds are detected (native is implicit)", async () => {
    state.agents = [
      agent({ kind: "claude" }),
      agent({ kind: "codex", credentialState: "login_required" }),
    ];

    renderHook(() => useFirstRunAuthAdoption());
    await waitForDecision();

    expect(putMutate).not.toHaveBeenCalled();
  });

  it("is a no-op when selections already exist", async () => {
    state.agents = [agent({ kind: "claude", credentialState: "login_required" })];
    state.selections.data = [
      { harnessKind: "claude", surface: "local", sourceKind: "gateway", enabled: true },
    ];

    renderHook(() => useFirstRunAuthAdoption());
    await waitForDecision();

    expect(putMutate).not.toHaveBeenCalled();
  });

  it("preselects the gateway when nothing is detected and the gateway is enabled", async () => {
    state.agents = [agent({ kind: "claude", credentialState: "login_required" })];

    renderHook(() => useFirstRunAuthAdoption());

    await waitFor(() => expect(putMutate).toHaveBeenCalledTimes(1));
    expect(putMutate).toHaveBeenCalledWith(
      { harnessKind: "claude", surface: "local", body: GATEWAY_BODY },
      expect.anything(),
    );
  });

  it("records a failed first-run adoption through the renderer sink", async () => {
    state.agents = [agent({ kind: "claude", credentialState: "login_required" })];
    renderHook(() => useFirstRunAuthAdoption());
    await waitFor(() => expect(putMutate).toHaveBeenCalledTimes(1));

    const options = putMutate.mock.calls[0]?.[1] as { onError(error: unknown): void };
    options.onError(new TypeError("adoption failed"));

    expect(diagnostics).toContainEqual(expect.objectContaining({
      name: "renderer.agent_auth.first_run_adoption_failed",
      errorClassification: "first_run_adoption_failed",
    }));
  });

  it("does nothing when nothing is detected and the gateway is disabled", async () => {
    state.agents = [agent({ kind: "claude", credentialState: "login_required" })];
    state.capabilities.data = { gatewayEnabled: false };

    renderHook(() => useFirstRunAuthAdoption());
    await waitForDecision();

    expect(putMutate).not.toHaveBeenCalled();
  });

  it("waits for selections to load and then runs only once", async () => {
    state.agents = [agent({ kind: "claude", credentialState: "login_required" })];
    state.selections.data = undefined;

    const { rerender } = renderHook(() => useFirstRunAuthAdoption());
    await flushAdoption();
    expect(putMutate).not.toHaveBeenCalled();

    state.selections.data = [];
    rerender();
    await waitFor(() => expect(putMutate).toHaveBeenCalledTimes(1));

    rerender();
    await flushAdoption();
    expect(putMutate).toHaveBeenCalledTimes(1);
  });

  it("waits for reconcile hydration to settle before deciding", async () => {
    // Mid-hydration: the reconcile job is still running, so the one-shot
    // decision must not fire off a stale snapshot.
    state.reconcileStatus = "running";
    state.agents = [agent({ kind: "claude", credentialState: "login_required" })];

    const { rerender } = renderHook(() => useFirstRunAuthAdoption());
    await flushAdoption();
    expect(putMutate).not.toHaveBeenCalled();

    state.reconcileStatus = "completed";
    state.agents = [agent({ kind: "claude", credentialState: "login_required" })];
    rerender();

    await waitFor(() => expect(putMutate).toHaveBeenCalledTimes(1));
    expect(putMutate).toHaveBeenCalledWith(
      { harnessKind: "claude", surface: "local", body: GATEWAY_BODY },
      expect.anything(),
    );
  });

  it("waits until a reconcile snapshot exists before deciding", async () => {
    state.reconcileSnapshot = null;
    state.agents = [agent({ kind: "claude", credentialState: "login_required" })];

    const { rerender } = renderHook(() => useFirstRunAuthAdoption());
    await flushAdoption();
    expect(putMutate).not.toHaveBeenCalled();

    state.reconcileSnapshot = {};
    rerender();
    await waitFor(() => expect(putMutate).toHaveBeenCalledTimes(1));
  });

  it("does nothing while cloud is inactive", async () => {
    state.cloudActive = false;
    state.agents = [agent({ kind: "claude", credentialState: "login_required" })];

    renderHook(() => useFirstRunAuthAdoption());
    await flushAdoption();

    expect(putMutate).not.toHaveBeenCalled();
  });

  // Ack-gated onboarding step (agent-auth.md, Proof C7): the "setting up"
  // step reads the adoption decision from the auth-setup store.
  it("records the adopted harness kinds for the onboarding step", async () => {
    state.agents = [
      agent({ kind: "claude", credentialState: "login_required" }),
      agent({ kind: "codex", credentialState: "login_required" }),
    ];

    renderHook(() => useFirstRunAuthAdoption());
    await waitForDecision();

    const store = useAuthSetupOnboardingStore.getState();
    expect(store.adoptedHarnessKinds).toEqual(["claude", "codex"]);
    expect(store.adoptionStartedAt).not.toBeNull();
  });

  it("records an empty adoption (native creds detected) so the step stays hidden", async () => {
    state.agents = [agent({ kind: "claude" })];

    renderHook(() => useFirstRunAuthAdoption());
    await waitForDecision();

    expect(putMutate).not.toHaveBeenCalled();
    expect(useAuthSetupOnboardingStore.getState().adoptedHarnessKinds).toEqual([]);
  });

  it("records nothing while the decision has not run (cloud inactive)", async () => {
    state.cloudActive = false;
    state.agents = [agent({ kind: "claude", credentialState: "login_required" })];

    renderHook(() => useFirstRunAuthAdoption());
    await flushAdoption();

    expect(useAuthSetupOnboardingStore.getState().adoptedHarnessKinds).toBeNull();
  });
});
