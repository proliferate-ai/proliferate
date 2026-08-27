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
  // Cloud COMPUTE is off for this whole suite on purpose: that is the shipped
  // production posture, and adoption is a control-plane concern that must run
  // regardless. Re-couple the hook to `cloudActive` and every test here fails.
  cloudActive: false,
  authStatus: "authenticated" as "authenticated" | "anonymous" | "loading",
  controlPlaneReachable: true,
  isDesktop: true,
  connectionState: "healthy" as "connecting" | "healthy" | "failed",
  capabilities: {
    data: { gatewayEnabled: true } as { gatewayEnabled: boolean } | undefined,
    isError: false,
    error: null as unknown,
  },
  selections: {
    data: [] as Array<Record<string, unknown>> | undefined,
    isError: false,
    error: null as unknown,
  },
  reconcileSnapshot: {} as Record<string, unknown> | null,
  reconcileStatus: "completed" as string,
  reconcileIsError: false,
  reconcileError: null as unknown,
  freshAgents: [] as AgentSummary[],
}));

const mocks = vi.hoisted(() => ({
  capabilitiesEnabled: vi.fn(),
  selectionsEnabled: vi.fn(),
  refetchAgents: vi.fn(),
  planner: vi.fn(),
  putMutate: vi.fn(),
}));

let diagnostics: RendererDiagnosticInput[] = [];

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useAgentGatewayCapabilities: (enabled: boolean) => {
    mocks.capabilitiesEnabled(enabled);
    return state.capabilities;
  },
  useAuthSelections: (_surface: unknown, enabled: boolean) => {
    mocks.selectionsEnabled(enabled);
    return state.selections;
  },
  usePutAuthSelections: () => ({ mutate: mocks.putMutate, isPending: false }),
}));

vi.mock("#product/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({
    cloudActive: state.cloudActive,
    authStatus: state.authStatus,
    controlPlaneReachable: state.controlPlaneReachable,
  }),
}));

vi.mock("#product/host/ProductHostProvider", () => ({
  useProductHost: () => ({ desktop: state.isDesktop ? {} : null }),
}));

vi.mock("#product/stores/sessions/harness-connection-store", () => ({
  useHarnessConnectionStore: (
    selector: (value: { connectionState: typeof state.connectionState }) => unknown,
  ) => selector({ connectionState: state.connectionState }),
}));

vi.mock("#product/hooks/agents/derived/use-agent-catalog", () => ({
  useAgentCatalog: () => ({
    refetch: mocks.refetchAgents,
    reconcileSnapshot: state.reconcileSnapshot,
    reconcileStatus: state.reconcileStatus,
    reconcileIsError: state.reconcileIsError,
    reconcileError: state.reconcileError,
  }),
}));

vi.mock("#product/lib/domain/agents/auth-onboarding", () => ({
  planFirstRunAuthAdoption: mocks.planner,
}));

function agent(overrides: Partial<AgentSummary> = {}): AgentSummary {
  return {
    kind: "claude",
    displayName: "Claude Code",
    credentialState: "login_required",
    installState: "installed",
    readiness: "credentials_required",
    supportsLogin: true,
    ...overrides,
  } as AgentSummary;
}

function diagnosticValues(input: RendererDiagnosticInput) {
  return Object.fromEntries(
    Object.entries(input.fields ?? {}).map(([key, field]) => [key, field.value]),
  );
}

async function flushAdoption() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitForDecision() {
  await waitFor(() => {
    expect(useAuthSetupOnboardingStore.getState().adoptedHarnessKinds).not.toBeNull();
  });
}

beforeEach(() => {
  diagnostics = [];
  setRendererDiagnosticsSink({ emit: (input) => diagnostics.push(input) });
  vi.spyOn(Date, "now").mockReturnValue(1_723_456_789);
  mocks.refetchAgents.mockReset();
  mocks.planner.mockReset();
  mocks.putMutate.mockReset();

  state.cloudActive = false;
  state.authStatus = "authenticated";
  state.controlPlaneReachable = true;
  state.isDesktop = true;
  state.connectionState = "healthy";
  state.capabilities.data = { gatewayEnabled: true };
  state.capabilities.isError = false;
  state.capabilities.error = null;
  state.selections.data = [];
  state.selections.isError = false;
  state.selections.error = null;
  state.reconcileSnapshot = {};
  state.reconcileStatus = "completed";
  state.reconcileIsError = false;
  state.reconcileError = null;
  state.freshAgents = [agent()];

  mocks.refetchAgents.mockImplementation(async () => ({
    data: state.freshAgents,
    isError: false,
    error: null,
  }));
  mocks.planner.mockImplementation((input: {
    agents: AgentSummary[];
    selectionCount: number;
    gatewayEnabled: boolean;
  }) => (
    input.selectionCount === 0 && input.gatewayEnabled
      ? input.agents.map((item) => ({ harnessKind: item.kind, surface: "local" }))
      : []
  ));
});

afterEach(() => {
  resetRendererDiagnosticsSinkForTest();
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  useAuthSetupOnboardingStore.getState().resetForTests();
});

describe("useFirstRunAuthAdoption", () => {
  it("settles active Web as a silent no-op with both Cloud queries disabled", async () => {
    state.isDesktop = false;
    state.connectionState = "failed";

    const { rerender } = renderHook(() => useFirstRunAuthAdoption());
    await waitForDecision();

    expect(mocks.capabilitiesEnabled).toHaveBeenLastCalledWith(false);
    expect(mocks.selectionsEnabled).toHaveBeenLastCalledWith(false);
    expect(useAuthSetupOnboardingStore.getState().adoptedHarnessKinds)
      .toEqual([]);
    expect(mocks.refetchAgents).not.toHaveBeenCalled();
    expect(mocks.planner).not.toHaveBeenCalled();
    expect(mocks.putMutate).not.toHaveBeenCalled();
    expect(diagnostics).toEqual([]);

    // The one shot stays one shot. Referential identity is the assertion the
    // deleted `adoptionStartedAt` timestamp used to make: a second
    // `recordAdoption` would install a NEW array, equal but not the same.
    const recorded = useAuthSetupOnboardingStore.getState().adoptedHarnessKinds;
    rerender();
    await flushAdoption();
    expect(useAuthSetupOnboardingStore.getState().adoptedHarnessKinds)
      .toBe(recorded);
  });

  it("keeps a signed-out user pending and adopts after sign-in", async () => {
    state.authStatus = "anonymous";
    const { rerender } = renderHook(() => useFirstRunAuthAdoption());
    await flushAdoption();

    expect(mocks.capabilitiesEnabled).toHaveBeenLastCalledWith(false);
    expect(mocks.selectionsEnabled).toHaveBeenLastCalledWith(false);
    expect(useAuthSetupOnboardingStore.getState().adoptedHarnessKinds).toBeNull();
    expect(mocks.refetchAgents).not.toHaveBeenCalled();

    state.authStatus = "authenticated";
    rerender();
    await waitFor(() => expect(mocks.putMutate).toHaveBeenCalledTimes(1));

    expect(mocks.capabilitiesEnabled).toHaveBeenLastCalledWith(true);
    expect(mocks.selectionsEnabled).toHaveBeenLastCalledWith(true);
  });

  it("keeps an unreachable control plane pending and adopts once it returns", async () => {
    state.controlPlaneReachable = false;
    const { rerender } = renderHook(() => useFirstRunAuthAdoption());
    await flushAdoption();

    expect(mocks.capabilitiesEnabled).toHaveBeenLastCalledWith(false);
    expect(mocks.selectionsEnabled).toHaveBeenLastCalledWith(false);
    expect(useAuthSetupOnboardingStore.getState().adoptedHarnessKinds).toBeNull();

    state.controlPlaneReachable = true;
    rerender();
    await waitFor(() => expect(mocks.putMutate).toHaveBeenCalledTimes(1));
  });

  it("adopts the gateway with cloud compute disabled (launch posture)", async () => {
    // Explicit statement of what the suite-wide `cloudActive: false` proves: a
    // signed-in user on a reachable control plane gets gateway adoption even
    // though cloud compute (E2B sandboxes) is off.
    renderHook(() => useFirstRunAuthAdoption());
    await waitFor(() => expect(mocks.putMutate).toHaveBeenCalledTimes(1));

    expect(mocks.capabilitiesEnabled).toHaveBeenLastCalledWith(true);
    expect(mocks.selectionsEnabled).toHaveBeenLastCalledWith(true);
    expect(useAuthSetupOnboardingStore.getState().adoptedHarnessKinds)
      .toEqual(["claude"]);
  });

  it("waits while the Desktop runtime is connecting", async () => {
    state.connectionState = "connecting";
    const { rerender } = renderHook(() => useFirstRunAuthAdoption());
    await flushAdoption();

    expect(useAuthSetupOnboardingStore.getState().adoptedHarnessKinds).toBeNull();
    expect(mocks.refetchAgents).not.toHaveBeenCalled();

    state.connectionState = "healthy";
    rerender();
    await waitFor(() => expect(mocks.refetchAgents).toHaveBeenCalledTimes(1));
  });

  it("settles a failed Desktop runtime once and does not retry after recovery", async () => {
    state.connectionState = "failed";
    const { rerender } = renderHook(() => useFirstRunAuthAdoption());
    await waitForDecision();

    expect(useAuthSetupOnboardingStore.getState().adoptedHarnessKinds).toEqual([]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnosticValues(diagnostics[0]!)).toEqual({
      failure_stage: "runtime_connection",
    });

    state.connectionState = "healthy";
    rerender();
    await flushAdoption();
    expect(mocks.refetchAgents).not.toHaveBeenCalled();
    expect(diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "pending selections do not mask a capabilities failure",
      () => {
        state.selections.data = undefined;
        state.capabilities.data = undefined;
        state.capabilities.isError = true;
        state.capabilities.error = new TypeError("capabilities payload");
      },
      "capabilities_query",
    ],
    [
      "pending Cloud inputs do not mask a reconcile query failure",
      () => {
        state.selections.data = undefined;
        state.capabilities.data = undefined;
        state.reconcileIsError = true;
        state.reconcileError = new TypeError("reconcile payload");
      },
      "reconcile_query",
    ],
    [
      "pending capabilities do not mask a failed reconcile job",
      () => {
        state.capabilities.data = undefined;
        state.reconcileStatus = "failed";
      },
      "reconcile_job",
    ],
  ] as const)("settles crossed state: %s", async (_name, configure, expectedStage) => {
    configure();
    renderHook(() => useFirstRunAuthAdoption());
    await waitForDecision();

    expect(useAuthSetupOnboardingStore.getState().adoptedHarnessKinds).toEqual([]);
    expect(diagnosticValues(diagnostics[0]!).failure_stage).toBe(expectedStage);
    expect(mocks.refetchAgents).not.toHaveBeenCalled();
  });

  it.each([
    [
      "capabilities failure",
      () => {
        state.capabilities.data = undefined;
        state.capabilities.isError = true;
        state.capabilities.error = new TypeError("capabilities payload");
      },
      "capabilities_query",
    ],
    [
      "reconcile failure",
      () => {
        state.reconcileIsError = true;
        state.reconcileError = new TypeError("reconcile payload");
      },
      "reconcile_query",
    ],
    [
      "failed reconcile job",
      () => {
        state.reconcileStatus = "failed";
      },
      "reconcile_job",
    ],
  ] as const)(
    "keeps a connecting runtime pending despite %s, then settles once healthy",
    async (_name, configure, expectedStage) => {
      state.connectionState = "connecting";
      configure();
      const { rerender } = renderHook(() => useFirstRunAuthAdoption());
      await flushAdoption();

      expect(useAuthSetupOnboardingStore.getState().adoptedHarnessKinds).toBeNull();
      expect(diagnostics).toEqual([]);
      expect(mocks.refetchAgents).not.toHaveBeenCalled();

      state.connectionState = "healthy";
      rerender();
      await waitForDecision();

      expect(useAuthSetupOnboardingStore.getState().adoptedHarnessKinds).toEqual([]);
      expect(diagnosticValues(diagnostics[0]!).failure_stage).toBe(expectedStage);
      expect(diagnostics).toHaveLength(1);
      expect(mocks.refetchAgents).not.toHaveBeenCalled();

      rerender();
      await flushAdoption();
      expect(diagnostics).toHaveLength(1);
    },
  );

  it("uses deterministic terminal precedence when several failures coexist", async () => {
    state.connectionState = "failed";
    state.selections.data = undefined;
    state.selections.isError = true;
    state.selections.error = new TypeError("selections payload");
    state.capabilities.data = undefined;
    state.capabilities.isError = true;
    state.capabilities.error = new TypeError("capabilities payload");
    state.reconcileIsError = true;
    state.reconcileError = new TypeError("reconcile payload");
    state.reconcileStatus = "failed";

    renderHook(() => useFirstRunAuthAdoption());
    await waitForDecision();

    expect(diagnosticValues(diagnostics[0]!)).toEqual({
      failure_stage: "runtime_connection",
    });
    expect(diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "selections before capabilities and reconcile",
      () => {
        state.selections.data = undefined;
        state.selections.isError = true;
        state.selections.error = new TypeError("selections payload");
        state.capabilities.data = undefined;
        state.capabilities.isError = true;
        state.capabilities.error = new TypeError("capabilities payload");
        state.reconcileIsError = true;
        state.reconcileError = new TypeError("reconcile payload");
      },
      "selections_query",
    ],
    [
      "capabilities before reconcile when selections are usable",
      () => {
        state.selections.isError = true;
        state.selections.error = new TypeError("background selections payload");
        state.capabilities.data = undefined;
        state.capabilities.isError = true;
        state.capabilities.error = new TypeError("capabilities payload");
        state.reconcileIsError = true;
        state.reconcileError = new TypeError("reconcile payload");
      },
      "capabilities_query",
    ],
  ] as const)("orders terminal stages: %s", async (_name, configure, expectedStage) => {
    configure();
    renderHook(() => useFirstRunAuthAdoption());
    await waitForDecision();

    expect(diagnosticValues(diagnostics[0]!).failure_stage).toBe(expectedStage);
    expect(diagnostics).toHaveLength(1);
  });

  it("does not retry after a crossed pending-plus-terminal state recovers", async () => {
    state.selections.data = undefined;
    state.reconcileStatus = "failed";
    const { rerender } = renderHook(() => useFirstRunAuthAdoption());
    await waitForDecision();

    expect(diagnosticValues(diagnostics[0]!).failure_stage).toBe("reconcile_job");

    state.selections.data = [];
    state.reconcileStatus = "completed";
    rerender();
    await flushAdoption();

    expect(mocks.refetchAgents).not.toHaveBeenCalled();
    expect(mocks.putMutate).not.toHaveBeenCalled();
    expect(diagnostics).toHaveLength(1);
  });

  it.each([
    ["selections", "selections_query"],
    ["capabilities", "capabilities_query"],
  ] as const)(
    "waits for pending %s and settles a terminal no-data error",
    async (queryName, expectedStage) => {
      const query = state[queryName];
      query.data = undefined;
      const { rerender } = renderHook(() => useFirstRunAuthAdoption());
      await flushAdoption();

      expect(useAuthSetupOnboardingStore.getState().adoptedHarnessKinds).toBeNull();
      expect(mocks.refetchAgents).not.toHaveBeenCalled();

      const error = new TypeError("private provider response");
      query.isError = true;
      query.error = error;
      rerender();
      await waitForDecision();

      expect(useAuthSetupOnboardingStore.getState().adoptedHarnessKinds).toEqual([]);
      expect(diagnosticValues(diagnostics[0]!)).toEqual({
        failure_stage: expectedStage,
        error_name: "TypeError",
      });
      expect(JSON.stringify(diagnostics[0])).not.toContain("private provider response");
    },
  );

  it("uses cached selections and capabilities despite background errors", async () => {
    state.selections.isError = true;
    state.selections.error = new Error("stale selections refresh failed");
    state.capabilities.isError = true;
    state.capabilities.error = new Error("stale capabilities refresh failed");

    renderHook(() => useFirstRunAuthAdoption());
    await waitFor(() => expect(mocks.refetchAgents).toHaveBeenCalledTimes(1));

    expect(mocks.putMutate).toHaveBeenCalledTimes(1);
    expect(diagnostics).toEqual([]);
  });

  it("keeps a missing reconcile snapshot pending", async () => {
    state.reconcileSnapshot = null;
    renderHook(() => useFirstRunAuthAdoption());
    await flushAdoption();

    expect(useAuthSetupOnboardingStore.getState().adoptedHarnessKinds).toBeNull();
    expect(mocks.refetchAgents).not.toHaveBeenCalled();
  });

  it.each(["idle", "queued", "running"])(
    "keeps reconcile %s pending",
    async (status) => {
      state.reconcileStatus = status;
      renderHook(() => useFirstRunAuthAdoption());
      await flushAdoption();

      expect(useAuthSetupOnboardingStore.getState().adoptedHarnessKinds).toBeNull();
      expect(mocks.refetchAgents).not.toHaveBeenCalled();
    },
  );

  it.each([
    Object.assign(new Error("missing endpoint"), { name: "AnyHarnessError", status: 404 }),
    Object.assign(new Error("transport response"), { name: "NetworkError" }),
  ])("settles reconcile query errors without exposing their payload", async (error) => {
    state.reconcileIsError = true;
    state.reconcileError = error;
    renderHook(() => useFirstRunAuthAdoption());
    await waitForDecision();

    expect(useAuthSetupOnboardingStore.getState().adoptedHarnessKinds).toEqual([]);
    expect(diagnosticValues(diagnostics[0]!)).toEqual({
      failure_stage: "reconcile_query",
      error_name: error.name,
    });
    expect(JSON.stringify(diagnostics[0])).not.toContain(error.message);
    expect(mocks.refetchAgents).not.toHaveBeenCalled();
  });

  it("settles a failed reconcile job without copying job results", async () => {
    state.reconcileStatus = "failed";
    state.reconcileSnapshot = {
      message: "private runtime path /Users/example/repo",
      results: [{ detail: "provider payload" }],
    };
    renderHook(() => useFirstRunAuthAdoption());
    await waitForDecision();

    expect(diagnosticValues(diagnostics[0]!)).toEqual({
      failure_stage: "reconcile_job",
    });
    expect(JSON.stringify(diagnostics[0])).not.toContain("private runtime path");
    expect(JSON.stringify(diagnostics[0])).not.toContain("provider payload");
  });

  it("uses completed reconcile to refetch once and pass settled Cloud inputs", async () => {
    state.selections.data = [{ harnessKind: "codex" }];
    state.capabilities.data = { gatewayEnabled: false };
    state.freshAgents = [agent({ kind: "codex" })];

    const { rerender } = renderHook(() => useFirstRunAuthAdoption());
    await waitForDecision();

    expect(mocks.refetchAgents).toHaveBeenCalledTimes(1);
    expect(mocks.refetchAgents).toHaveBeenCalledWith({ cancelRefetch: false });
    expect(mocks.planner).toHaveBeenCalledWith({
      agents: state.freshAgents,
      selectionCount: 1,
      gatewayEnabled: false,
    });
    expect(useAuthSetupOnboardingStore.getState().adoptedHarnessKinds).toEqual([]);
    expect(mocks.putMutate).not.toHaveBeenCalled();

    rerender();
    await flushAdoption();
    expect(mocks.refetchAgents).toHaveBeenCalledTimes(1);
  });

  it("records adopted kinds and preserves planner write order", async () => {
    state.freshAgents = [agent({ kind: "claude" }), agent({ kind: "codex" })];

    renderHook(() => useFirstRunAuthAdoption());
    await waitFor(() => expect(mocks.putMutate).toHaveBeenCalledTimes(2));

    expect(useAuthSetupOnboardingStore.getState().adoptedHarnessKinds)
      .toEqual(["claude", "codex"]);
    expect(mocks.putMutate.mock.calls.map(([input]) => input.harnessKind))
      .toEqual(["claude", "codex"]);
  });

  it("keeps selection-write diagnostics bounded to stage, safe name, and harness", async () => {
    renderHook(() => useFirstRunAuthAdoption());
    await waitFor(() => expect(mocks.putMutate).toHaveBeenCalledTimes(1));

    const options = mocks.putMutate.mock.calls[0]?.[1] as {
      onError(error: unknown): void;
    };
    const error = Object.assign(new TypeError("secret response body"), {
      payload: { token: "do-not-ship" },
    });
    options.onError(error);

    expect(diagnosticValues(diagnostics[0]!)).toEqual({
      failure_stage: "selection_write",
      error_name: "TypeError",
      harness_kind: "claude",
    });
    expect(JSON.stringify(diagnostics[0])).not.toContain("secret response body");
    expect(JSON.stringify(diagnostics[0])).not.toContain("do-not-ship");
  });
});
