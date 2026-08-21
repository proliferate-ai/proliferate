// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLOUD_TARGET,
  LOCAL_TARGET,
  codexResponse,
  entry,
  response,
  wrapper,
} from "#product/hooks/home/derived/home-model-selection.fixtures";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";
import { useHomeNextModelSelection } from "#product/hooks/home/derived/use-home-next-model-selection";

const mocks = vi.hoisted(() => ({
  args: null as Record<string, unknown> | null,
  data: undefined as Record<string, unknown> | undefined,
  targetIsLoading: false,
  targetIsError: false,
  refetch: vi.fn(),
  refetchKind: vi.fn(),
  refetchAgents: vi.fn(),
  refreshFn: vi.fn(),
  // Settled by hand, one entry per real `mutateAsync` call.
  refreshProbes: [] as Array<{ kind: string; succeed: () => void; refuse: () => void }>,
  otherEntries: [] as Array<{
    harnessKind: string;
    data: Record<string, unknown> | null;
    isPending: boolean;
    isError: boolean;
  }>,
  agents: [] as Array<{ kind: string; readiness: string }>,
  readyAgents: [] as Array<{ kind: string }>,
  installingAgents: [] as Array<{ kind: string }>,
  isReconciling: false,
  agentsLoading: false,
  agentsError: false,
  isTargetUnobserved: false,
}));

vi.mock("#product/hooks/home/derived/use-home-target-agent-launch-options", () => ({
  useHomeTargetAgentLaunchOptions: (args: Record<string, unknown>) => {
    mocks.args = args;
    return {
      data: mocks.data,
      isLoading: mocks.targetIsLoading,
      isError: mocks.targetIsError,
      error: null,
      isTargetUnobserved: mocks.isTargetUnobserved,
      refetch: mocks.refetch,
    };
  },
  useHomeTargetOtherAgentsLaunchOptions: () => mocks.otherEntries,
}));

vi.mock("#product/hooks/access/anyharness/agents/use-refetch-agent-launch-options-kind", () => ({
  useRefetchAgentLaunchOptionsKind: () => mocks.refetchKind,
}));

// A REAL `useMutation`, not a hand-written stand-in. The previous mock let the
// tests invoke all N per-call callbacks themselves, encoding a contract
// react-query does not honour — one `#mutateOptions` slot means only the LAST
// call's callbacks run — which hid a refresh that never stopped claiming to be
// in flight.
vi.mock("@anyharness/sdk-react", async () => {
  const { useMutation } = await import("@tanstack/react-query");
  return {
    useRefreshHarnessLaunchOptionsMutation: () => useMutation({
      mutationFn: (harnessKind: string) => mocks.refreshFn(harnessKind) as Promise<unknown>,
    }),
  };
});

vi.mock("#product/hooks/agents/derived/use-agent-catalog", () => ({
  useAgentCatalog: () => ({
    agents: mocks.agents,
    readyAgents: mocks.readyAgents,
    installingAgents: mocks.installingAgents,
    isReconciling: mocks.isReconciling,
    isLoading: mocks.agentsLoading,
    isError: mocks.agentsError,
    error: null,
    refetch: mocks.refetchAgents,
  }),
}));

type LaunchTarget = typeof LOCAL_TARGET | typeof CLOUD_TARGET | null;

function renderSelection(launchTarget: LaunchTarget) {
  return renderHook(
    () => useHomeNextModelSelection({ modelSelectionOverride: null, launchTarget }),
    { wrapper },
  );
}

/** `mutationFn` runs in a microtask: a probe has not started synchronously
 *  with the call that requested it. */
async function startProbes(start: () => void) {
  await act(async () => { start(); });
}

/** Settle every probe started so far and flush the batch's promise chain. */
async function settleProbes(outcomes: Array<"succeed" | "refuse">) {
  await act(async () => {
    outcomes.forEach((outcome, i) => mocks.refreshProbes[i][outcome]());
  });
}

describe("useHomeNextModelSelection", () => {
  beforeEach(() => {
    mocks.args = null;
    mocks.data = undefined;
    mocks.targetIsLoading = false;
    mocks.targetIsError = false;
    mocks.refetch = vi.fn();
    mocks.refetchKind = vi.fn();
    mocks.refetchAgents = vi.fn();
    mocks.refreshProbes = [];
    mocks.refreshFn = vi.fn((kind: string) => new Promise((resolve, reject) => {
      mocks.refreshProbes.push({
        kind,
        succeed: () => resolve({ harnessKind: kind }),
        refuse: () => reject(new Error("refresh refused")),
      });
    }));
    mocks.otherEntries = [];
    mocks.agents = [];
    mocks.readyAgents = [];
    mocks.installingAgents = [];
    mocks.isReconciling = false;
    mocks.agentsLoading = false;
    mocks.agentsError = false;
    mocks.isTargetUnobserved = false;
    useUserPreferencesStore.setState({
      defaultChatAgentKind: "claude",
      defaultChatModelIdByAgentKind: {},
    });
  });
  afterEach(cleanup);

  it("uses the exact observed default and keeps an unknown upstream id reachable", () => {
    mocks.data = response();
    const { result } = renderSelection(LOCAL_TARGET);
    expect(result.current.modelGate).toEqual({ kind: "launchable" });
    expect(mocks.args).toEqual({ harnessKind: "claude", launchTarget: LOCAL_TARGET });
    expect(result.current.effectiveModelSelection).toEqual({ kind: "claude", modelId: "fable" });
    expect(result.current.modelGroups[0]?.models.map((model) => model.modelId)).toEqual([
      "fable",
      "unknown-upstream",
    ]);
  });

  it("keeps every other ready harness pickable from the launch composer", () => {
    mocks.data = response();
    mocks.readyAgents = [{ kind: "claude" }, { kind: "codex" }];
    mocks.otherEntries = [entry("codex", codexResponse())];
    const { result } = renderSelection(LOCAL_TARGET);
    // Negative control against the cutover regression: the launch picker must
    // not collapse to the requested harness alone.
    expect(result.current.modelGroups.map((group) => group.kind)).toEqual(["claude", "codex"]);
    expect(result.current.modelGroups[1]?.models.map((model) => model.modelId)).toEqual(["gpt-5.6-sol"]);
    expect(result.current.effectiveModelSelection).toEqual({ kind: "claude", modelId: "fable" });
  });

  it("omits an unresolved other harness without failing the launch picker", () => {
    mocks.data = response();
    mocks.readyAgents = [{ kind: "claude" }, { kind: "codex" }];
    mocks.otherEntries = [entry("codex", null, { isPending: true })];
    const { result } = renderSelection(LOCAL_TARGET);
    expect(result.current.modelGroups.map((group) => group.kind)).toEqual(["claude"]);
    expect(result.current.modelGate).toEqual({ kind: "launchable" });
  });

  it("offers no explicit model before the target has an observation", () => {
    mocks.isTargetUnobserved = true;
    const { result } = renderSelection(CLOUD_TARGET);
    expect(result.current.modelGate).toEqual({ kind: "blocked", reason: "target_unobserved" });
    expect(result.current.effectiveModelSelection).toBeNull();
  });

  it("offers no explicit model when no launch target is selected", () => {
    const { result } = renderSelection(null);
    expect(result.current.modelGate).toEqual({ kind: "blocked", reason: "target_missing" });
    expect(result.current.effectiveModelSelection).toBeNull();
  });

  // The two reasons PR B's list-hook flags exist to keep apart. `data === null`
  // is identical in both; only isPending/isError separate them.
  it("reads querying from a pending list entry and transport_error from a failed one", () => {
    mocks.agents = [{ kind: "claude", readiness: "ready" }, { kind: "codex", readiness: "ready" }];
    mocks.readyAgents = [{ kind: "claude" }, { kind: "codex" }];
    mocks.otherEntries = [entry("codex", null, { isPending: true })];
    const querying = renderSelection(LOCAL_TARGET);
    expect(querying.result.current.modelGate).toEqual({ kind: "blocked", reason: "querying" });
    querying.unmount();

    mocks.otherEntries = [entry("codex", null, { isError: true })];
    const failed = renderSelection(LOCAL_TARGET);
    expect(failed.result.current.modelGate).toEqual({
      kind: "blocked",
      reason: "transport_error",
    });
  });

  it("reads observation_pending from a running probe on the requested kind", () => {
    mocks.agents = [{ kind: "claude", readiness: "ready" }];
    mocks.readyAgents = [{ kind: "claude" }];
    mocks.data = { ...response(), state: "detecting", probePhase: "running", options: null };
    const { result } = renderSelection(LOCAL_TARGET);
    expect(result.current.modelGate).toEqual({
      kind: "blocked",
      reason: "observation_pending",
    });
  });

  it("reads agent_setup_required only from real install/login readiness", () => {
    mocks.agents = [{ kind: "claude", readiness: "install_required" }];
    const { result } = renderSelection(LOCAL_TARGET);
    expect(result.current.modelGate).toEqual({
      kind: "blocked",
      reason: "agent_setup_required",
    });
  });

  it("never lets a cloud target read the desktop catalog's readiness", () => {
    // Local agents needing install would say agent_setup_required on a local
    // target; on a cloud target they are a different machine's business.
    mocks.agents = [{ kind: "claude", readiness: "install_required" }];
    mocks.agentsError = true;
    const { result } = renderSelection(CLOUD_TARGET);
    // Neither the local readiness nor the local catalog's failure reaches it:
    // the honest answer is that nothing has looked at the sandbox yet.
    expect(result.current.modelGate).toEqual({
      kind: "blocked",
      reason: "observation_idle",
    });
  });

  it("keeps rows offered and nothing selected when no valid default resolves", () => {
    // Both defaults name models this target does not offer: the persisted user
    // default AND the runtime's own observed default. Nothing exact resolves.
    useUserPreferencesStore.setState({
      defaultChatAgentKind: "claude",
      defaultChatModelIdByAgentKind: { claude: "model-that-was-uninstalled" },
    });
    mocks.agents = [{ kind: "claude", readiness: "ready" }];
    mocks.readyAgents = [{ kind: "claude" }];
    mocks.data = {
      ...response(),
      options: {
        ...response().options,
        defaults: { modelId: "also-gone", controlValues: {} },
      },
    };
    const { result } = renderSelection(LOCAL_TARGET);
    // No first-model fallback: the rows stay on offer, the selection does not
    // happen, and the gate says so.
    expect(result.current.modelGate).toEqual({ kind: "selection_required" });
    expect(result.current.effectiveModelSelection).toBeNull();
    expect(result.current.modelGroups[0]?.models.map((model) => model.modelId)).toEqual([
      "fable",
      "unknown-upstream",
    ]);
    expect(result.current.modelGroups[0]?.models.some((model) => model.isSelected)).toBe(false);
  });

  it("stays selection_required when the preferred harness has not reported yet", () => {
    // The Partial Ready wire: Grok observed two models, Claude still
    // installing, the user's default kind is Claude. Grok's rows are offered
    // and NOT auto-picked.
    useUserPreferencesStore.setState({
      defaultChatAgentKind: "claude",
      defaultChatModelIdByAgentKind: {},
    });
    mocks.agents = [
      { kind: "claude", readiness: "ready" },
      { kind: "codex", readiness: "ready" },
    ];
    mocks.readyAgents = [{ kind: "claude" }, { kind: "codex" }];
    mocks.data = { ...response(), state: "detecting", probePhase: "idle", options: null };
    mocks.otherEntries = [entry("codex", codexResponse())];
    const { result } = renderSelection(LOCAL_TARGET);
    expect(result.current.modelGate).toEqual({ kind: "selection_required" });
    expect(result.current.effectiveModelSelection).toBeNull();
    expect(result.current.modelGroups.map((group) => group.kind)).toEqual(["codex"]);
  });

  it("keeps refreshing and last_good_after_failure launchable", () => {
    for (const state of ["refreshing", "last_good_after_failure"] as const) {
      mocks.data = { ...response(), state, probePhase: "running" };
      const { result, unmount } = renderSelection(LOCAL_TARGET);
      expect(result.current.modelGate).toEqual({ kind: "launchable" });
      unmount();
    }
  });

  it("requests a new probe for a failed observation and refetches otherwise", async () => {
    mocks.agents = [{ kind: "claude", readiness: "ready" }];
    mocks.readyAgents = [{ kind: "claude" }];
    mocks.data = { ...response(), state: "failed_without_observation", options: null };
    const failed = renderSelection(LOCAL_TARGET);
    expect(failed.result.current.modelGate).toEqual({
      kind: "blocked",
      reason: "observation_failed",
    });
    await startProbes(() => failed.result.current.retryModelObservation());
    expect(mocks.refreshFn).toHaveBeenCalledWith("claude");
    expect(mocks.refetch).not.toHaveBeenCalled();
    failed.unmount();

    mocks.data = undefined;
    mocks.targetIsError = true;
    const broken = renderSelection(LOCAL_TARGET);
    expect(broken.result.current.modelGate).toEqual({
      kind: "blocked",
      reason: "transport_error",
    });
    await startProbes(() => broken.result.current.retryModelObservation());
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it("reports a settled unprobed harness as observation_idle and refreshes it", async () => {
    // A harness excluded from automatic probing answers `detecting` + `idle`
    // and stays there. Nothing is in flight, so the cure is a NEW probe.
    mocks.agents = [{ kind: "cursor", readiness: "ready" }];
    mocks.readyAgents = [{ kind: "cursor" }];
    useUserPreferencesStore.setState({
      defaultChatAgentKind: "cursor",
      defaultChatModelIdByAgentKind: {},
    });
    mocks.data = {
      ...response(),
      harnessKind: "cursor",
      state: "detecting",
      probePhase: "idle",
      options: null,
    };
    const { result } = renderSelection(LOCAL_TARGET);
    expect(result.current.modelGate).toEqual({
      kind: "blocked",
      reason: "observation_idle",
    });
    await startProbes(() => result.current.retryModelObservation());
    expect(mocks.refreshFn).toHaveBeenCalledWith("cursor");
    expect(mocks.refetch).not.toHaveBeenCalled();
  });

  it("repairs the query that actually failed, not the one it can reach", async () => {
    // A FAN-OUT kind's read failed. Re-asking the requested kind would re-read
    // an endpoint that was never the problem and leave the notice up.
    mocks.agents = [
      { kind: "claude", readiness: "ready" },
      { kind: "codex", readiness: "ready" },
    ];
    mocks.readyAgents = [{ kind: "claude" }, { kind: "codex" }];
    mocks.data = {
      ...response(),
      state: "observed_empty",
      options: { models: [], controls: [], defaults: { modelId: null, controlValues: {} } },
    };
    mocks.otherEntries = [entry("codex", null, { isError: true })];
    const fanout = renderSelection(LOCAL_TARGET);
    await startProbes(() => fanout.result.current.retryModelObservation());
    expect(mocks.refetchKind).toHaveBeenCalledWith("codex");
    expect(mocks.refetch).not.toHaveBeenCalled();
    fanout.unmount();

    // The AGENT CATALOG's own read failed. It is a third query, and nothing in
    // the launch-options family can repair it.
    mocks.otherEntries = [];
    mocks.data = undefined;
    mocks.agentsError = true;
    const catalog = renderSelection(LOCAL_TARGET);
    expect(catalog.result.current.modelGate).toEqual({
      kind: "blocked",
      reason: "transport_error",
    });
    await startProbes(() => catalog.result.current.retryModelObservation());
    expect(mocks.refetchAgents).toHaveBeenCalled();
  });

  it.each([
    // `probe_phase` forces queued/running for an in-flight row, so backoff can
    // only arrive on a SETTLED one — `{detecting, backoff}` is not a wire shape.
    ["a backed-off retry on a settled row", { state: "observed", probePhase: "backoff" }],
    ["a runtime that owns no probe engine", { state: "detecting", probePhase: null }],
    ["an observation with zero models", { state: "observed", probePhase: "idle" }],
    ["a zero-model last_good_after_failure", { state: "last_good_after_failure", probePhase: "idle" }],
  ])("fires a real probe for observation_idle reached via %s", async (_label, overrides) => {
    // Every one of these lands on `observation_idle` through the RESIDUAL arm,
    // not the settled-unobserved one. They were promised a Refresh and handed
    // a re-read of the same durable row, which can never change what it says.
    mocks.agents = [{ kind: "claude", readiness: "ready" }];
    mocks.readyAgents = [{ kind: "claude" }];
    mocks.data = { ...response(), ...overrides, options: null };
    const { result } = renderSelection(LOCAL_TARGET);
    expect(result.current.modelGate).toEqual({
      kind: "blocked",
      reason: "observation_idle",
    });
    await startProbes(() => result.current.retryModelObservation());
    expect(mocks.refreshFn).toHaveBeenCalledWith("claude");
    expect(mocks.refetch).not.toHaveBeenCalled();
  });

  it("re-reads the catalog when observation_idle has no kind to probe", async () => {
    // With no requested kind the single-kind query is DISABLED, so refetching
    // it is a literal no-op: a permanent sentence and a button that does
    // nothing. Only the catalog can produce a kind to probe.
    useUserPreferencesStore.setState({
      defaultChatAgentKind: "",
      defaultChatModelIdByAgentKind: {},
    });
    const { result } = renderSelection(LOCAL_TARGET);
    expect(result.current.modelGate).toEqual({
      kind: "blocked",
      reason: "observation_idle",
    });
    await startProbes(() => result.current.retryModelObservation());
    expect(mocks.refetchAgents).toHaveBeenCalled();
    expect(mocks.refetch).not.toHaveBeenCalled();
  });

  it("keeps the cloud check-again path on the generic target re-ask", async () => {
    // A cloud response carries no probePhase, so cloud always lands in the
    // residual — and there the sandbox re-read genuinely IS the cure.
    mocks.data = undefined;
    const { result } = renderSelection(CLOUD_TARGET);
    expect(result.current.modelGate).toEqual({
      kind: "blocked",
      reason: "observation_idle",
    });
    await startProbes(() => result.current.retryModelObservation());
    expect(mocks.refetch).toHaveBeenCalled();
    expect(mocks.refreshFn).not.toHaveBeenCalled();
  });

  it("claims refusal only when nothing got through, and reports the wait", async () => {
    // One `useMutation` observer tracks only its last call, so reading `isError`
    // off it made the claim depend on which kind finished last, not on truth.
    mocks.agents = [
      { kind: "claude", readiness: "ready" },
      { kind: "codex", readiness: "ready" },
    ];
    mocks.readyAgents = [{ kind: "claude" }, { kind: "codex" }];
    mocks.data = { ...response(), state: "observed", probePhase: "idle", options: null };
    mocks.otherEntries = [entry("codex", { ...codexResponse(), state: "observed", options: null })];
    const { result } = renderSelection(LOCAL_TARGET);
    expect(result.current.retryPending).toBe(false);

    await startProbes(() => result.current.retryModelObservation());
    expect(mocks.refreshProbes.map((probe) => probe.kind)).toEqual(["claude", "codex"]);
    // Still running: the settled sentence must not be rendered over live work.
    expect(result.current.retryPending).toBe(true);
    expect(result.current.retryRejected).toBe(false);

    await settleProbes(["refuse", "succeed"]);
    // Two kinds through ONE observer. Counting per-call callbacks stalled here
    // at settled=1 of 2 and pinned "Refreshing your models…" permanently.
    expect(result.current.retryPending).toBe(false);
    // One kind refused, one succeeded: the refresh DID something.
    expect(result.current.retryRejected).toBe(false);

    await startProbes(() => result.current.retryModelObservation());
    expect(result.current.retryPending).toBe(true);
    await settleProbes(["refuse", "refuse", "refuse", "refuse"]);
    // All refused, and reachable at N=2 rather than only at N=1.
    expect(result.current.retryPending).toBe(false);
    expect(result.current.retryRejected).toBe(true);
  });

  it("never carries a local refusal onto a cloud target", async () => {
    // Cloud never calls the mutation, so nothing there could clear a stale
    // refusal. The `!isCloudTarget` read mask is now the ONLY mechanism —
    // the counter reset that used to back it up was over-broad and is gone —
    // so removing it alone is what this test fails on.
    mocks.agents = [{ kind: "claude", readiness: "ready" }];
    mocks.readyAgents = [{ kind: "claude" }];
    mocks.data = { ...response(), state: "observed", probePhase: "idle", options: null };
    const view = renderHook(
      ({ target }: { target: typeof LOCAL_TARGET | typeof CLOUD_TARGET }) =>
        useHomeNextModelSelection({ modelSelectionOverride: null, launchTarget: target }),
      {
        initialProps: { target: LOCAL_TARGET as typeof LOCAL_TARGET | typeof CLOUD_TARGET },
        wrapper,
      },
    );
    await startProbes(() => view.result.current.retryModelObservation());
    await settleProbes(["refuse"]);
    expect(view.result.current.retryRejected).toBe(true);

    view.rerender({ target: CLOUD_TARGET });
    expect(view.result.current.retryRejected).toBe(false);
  });

  it("still reports a refusal owed from before the target flipped", async () => {
    // The probe is keyed on `harnessKind` and is machine-global, so a
    // local->cloud->local flip does not make an owed tally stale. Discarding
    // it left a refused refresh with NO receipt at all, and the settled
    // sentence rendering while the probes were still running.
    mocks.agents = [{ kind: "claude", readiness: "ready" }];
    mocks.readyAgents = [{ kind: "claude" }];
    mocks.data = { ...response(), state: "observed", probePhase: "idle", options: null };
    const view = renderHook(
      ({ target }: { target: typeof LOCAL_TARGET | typeof CLOUD_TARGET }) =>
        useHomeNextModelSelection({ modelSelectionOverride: null, launchTarget: target }),
      {
        initialProps: { target: LOCAL_TARGET as typeof LOCAL_TARGET | typeof CLOUD_TARGET },
        wrapper,
      },
    );
    await startProbes(() => view.result.current.retryModelObservation());
    view.rerender({ target: CLOUD_TARGET });
    view.rerender({ target: LOCAL_TARGET });
    await settleProbes(["refuse"]);
    expect(view.result.current.retryPending).toBe(false);
    expect(view.result.current.retryRejected).toBe(true);
  });

  it("states an all-unsupported catalog terminally instead of offering a probe", () => {
    mocks.agents = [
      { kind: "claude", readiness: "unsupported" },
      { kind: "codex", readiness: "unsupported" },
    ];
    const { result } = renderSelection(LOCAL_TARGET);
    expect(result.current.modelGate).toEqual({
      kind: "blocked",
      reason: "agents_unsupported",
    });
    // Navigation has to land on an agent that IS unsupported, or the notice's
    // whole justification ("see which ones and why") is false.
    expect(result.current.unsupportedHarnessKind).toBe("claude");
  });

  it("withholds the unsupported harness from every gate but its own", () => {
    // `agent_setup_required` shares the `agent_settings` action and means a
    // DIFFERENT agent. Handing it the unsupported kind opened a pane that can
    // never be set up while the agent actually needing login went unopened —
    // the ordinary first-run state of any machine with one unsupported agent.
    mocks.agents = [
      { kind: "cursor", readiness: "unsupported" },
      { kind: "claude", readiness: "login_required" },
    ];
    const { result } = renderSelection(LOCAL_TARGET);
    expect(result.current.modelGate)
      .toEqual({ kind: "blocked", reason: "agent_setup_required" });
    expect(result.current.unsupportedHarnessKind).toBeNull();
  });

  it("keeps a cloud sandbox that reported no models from claiming it has no agents", () => {
    // `observed_empty` is the one blocked state ruling 3 keeps the picker
    // ENABLED for, and an enabled picker labelled "No agents" is false: the
    // sandbox's agents are there, they reported nothing.
    mocks.data = {
      ...response(),
      state: "observed_empty",
      options: { models: [], controls: [], defaults: { modelId: null, controlValues: {} } },
    };
    const { result } = renderSelection(CLOUD_TARGET);
    expect(result.current.modelGate).toEqual({ kind: "blocked", reason: "observed_empty" });
    expect(result.current.hasKnownAgents).toBe(true);
  });

  it("reports observed_empty when the harness answered with no models", () => {
    mocks.agents = [{ kind: "claude", readiness: "ready" }];
    mocks.readyAgents = [{ kind: "claude" }];
    mocks.data = {
      ...response(),
      state: "observed_empty",
      options: { models: [], controls: [], defaults: { modelId: null, controlValues: {} } },
    };
    const { result } = renderSelection(LOCAL_TARGET);
    expect(result.current.modelGate).toEqual({ kind: "blocked", reason: "observed_empty" });
    // The catalog still knows the agent, so the picker keeps a truthful label.
    expect(result.current.hasKnownAgents).toBe(true);
  });
});

