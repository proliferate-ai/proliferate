// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  refreshMutate: vi.fn(),
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

vi.mock("@anyharness/sdk-react", () => ({
  useRefreshHarnessLaunchOptionsMutation: () => ({ mutate: mocks.refreshMutate }),
}));

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

const LOCAL_TARGET = { kind: "local", sourceRoot: "/repo", existingWorkspaceId: null } as const;
const CLOUD_TARGET = {
  kind: "cloud",
  gitOwner: "owner",
  gitRepoName: "repo",
  baseBranch: "main",
} as const;

describe("useHomeNextModelSelection", () => {
  beforeEach(() => {
    mocks.args = null;
    mocks.data = undefined;
    mocks.targetIsLoading = false;
    mocks.targetIsError = false;
    mocks.refetch = vi.fn();
    mocks.refetchKind = vi.fn();
    mocks.refetchAgents = vi.fn();
    mocks.refreshMutate = vi.fn();
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
    const { result } = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
      launchTarget: LOCAL_TARGET,
    }));
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
    const { result } = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
      launchTarget: LOCAL_TARGET,
    }));
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
    const { result } = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
      launchTarget: LOCAL_TARGET,
    }));
    expect(result.current.modelGroups.map((group) => group.kind)).toEqual(["claude"]);
    expect(result.current.modelGate).toEqual({ kind: "launchable" });
  });

  it("offers no explicit model before the target has an observation", () => {
    mocks.isTargetUnobserved = true;
    const { result } = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
      launchTarget: CLOUD_TARGET,
    }));
    expect(result.current.modelGate).toEqual({ kind: "blocked", reason: "target_unobserved" });
    expect(result.current.effectiveModelSelection).toBeNull();
  });

  it("offers no explicit model when no launch target is selected", () => {
    const { result } = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
      launchTarget: null,
    }));
    expect(result.current.modelGate).toEqual({ kind: "blocked", reason: "target_missing" });
    expect(result.current.effectiveModelSelection).toBeNull();
  });

  // The two reasons PR B's list-hook flags exist to keep apart. `data === null`
  // is identical in both; only isPending/isError separate them.
  it("reads querying from a pending list entry and transport_error from a failed one", () => {
    mocks.agents = [{ kind: "claude", readiness: "ready" }, { kind: "codex", readiness: "ready" }];
    mocks.readyAgents = [{ kind: "claude" }, { kind: "codex" }];
    mocks.otherEntries = [entry("codex", null, { isPending: true })];
    const querying = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
      launchTarget: LOCAL_TARGET,
    }));
    expect(querying.result.current.modelGate).toEqual({ kind: "blocked", reason: "querying" });
    querying.unmount();

    mocks.otherEntries = [entry("codex", null, { isError: true })];
    const failed = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
      launchTarget: LOCAL_TARGET,
    }));
    expect(failed.result.current.modelGate).toEqual({
      kind: "blocked",
      reason: "transport_error",
    });
  });

  it("reads observation_pending from a running probe on the requested kind", () => {
    mocks.agents = [{ kind: "claude", readiness: "ready" }];
    mocks.readyAgents = [{ kind: "claude" }];
    mocks.data = { ...response(), state: "detecting", probePhase: "running", options: null };
    const { result } = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
      launchTarget: LOCAL_TARGET,
    }));
    expect(result.current.modelGate).toEqual({
      kind: "blocked",
      reason: "observation_pending",
    });
  });

  it("reads agent_setup_required only from real install/login readiness", () => {
    mocks.agents = [{ kind: "claude", readiness: "install_required" }];
    const { result } = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
      launchTarget: LOCAL_TARGET,
    }));
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
    const { result } = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
      launchTarget: CLOUD_TARGET,
    }));
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
    const { result } = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
      launchTarget: LOCAL_TARGET,
    }));
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
    const { result } = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
      launchTarget: LOCAL_TARGET,
    }));
    expect(result.current.modelGate).toEqual({ kind: "selection_required" });
    expect(result.current.effectiveModelSelection).toBeNull();
    expect(result.current.modelGroups.map((group) => group.kind)).toEqual(["codex"]);
  });

  it("keeps refreshing and last_good_after_failure launchable", () => {
    for (const state of ["refreshing", "last_good_after_failure"] as const) {
      mocks.data = { ...response(), state, probePhase: "running" };
      const { result, unmount } = renderHook(() => useHomeNextModelSelection({
        modelSelectionOverride: null,
        launchTarget: LOCAL_TARGET,
      }));
      expect(result.current.modelGate).toEqual({ kind: "launchable" });
      unmount();
    }
  });

  it("requests a new probe for a failed observation and refetches otherwise", () => {
    mocks.agents = [{ kind: "claude", readiness: "ready" }];
    mocks.readyAgents = [{ kind: "claude" }];
    mocks.data = { ...response(), state: "failed_without_observation", options: null };
    const failed = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
      launchTarget: LOCAL_TARGET,
    }));
    expect(failed.result.current.modelGate).toEqual({
      kind: "blocked",
      reason: "observation_failed",
    });
    failed.result.current.retryModelObservation();
    expect(mocks.refreshMutate).toHaveBeenCalledWith("claude");
    expect(mocks.refetch).not.toHaveBeenCalled();
    failed.unmount();

    mocks.data = undefined;
    mocks.targetIsError = true;
    const broken = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
      launchTarget: LOCAL_TARGET,
    }));
    expect(broken.result.current.modelGate).toEqual({
      kind: "blocked",
      reason: "transport_error",
    });
    broken.result.current.retryModelObservation();
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it("reports a settled unprobed harness as observation_idle and refreshes it", () => {
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
    const { result } = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
      launchTarget: LOCAL_TARGET,
    }));
    expect(result.current.modelGate).toEqual({
      kind: "blocked",
      reason: "observation_idle",
    });
    result.current.retryModelObservation();
    expect(mocks.refreshMutate).toHaveBeenCalledWith("cursor");
    expect(mocks.refetch).not.toHaveBeenCalled();
  });

  it("repairs the query that actually failed, not the one it can reach", () => {
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
    const fanout = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
      launchTarget: LOCAL_TARGET,
    }));
    fanout.result.current.retryModelObservation();
    expect(mocks.refetchKind).toHaveBeenCalledWith("codex");
    expect(mocks.refetch).not.toHaveBeenCalled();
    fanout.unmount();

    // The AGENT CATALOG's own read failed. It is a third query, and nothing in
    // the launch-options family can repair it.
    mocks.otherEntries = [];
    mocks.data = undefined;
    mocks.agentsError = true;
    const catalog = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
      launchTarget: LOCAL_TARGET,
    }));
    expect(catalog.result.current.modelGate).toEqual({
      kind: "blocked",
      reason: "transport_error",
    });
    catalog.result.current.retryModelObservation();
    expect(mocks.refetchAgents).toHaveBeenCalled();
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
    const { result } = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
      launchTarget: CLOUD_TARGET,
    }));
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
    const { result } = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
      launchTarget: LOCAL_TARGET,
    }));
    expect(result.current.modelGate).toEqual({ kind: "blocked", reason: "observed_empty" });
    // The catalog still knows the agent, so the picker keeps a truthful label.
    expect(result.current.hasKnownAgents).toBe(true);
  });
});

function entry(
  harnessKind: string,
  data: Record<string, unknown> | null,
  flags?: { isPending?: boolean; isError?: boolean },
) {
  return {
    harnessKind,
    data,
    isPending: flags?.isPending ?? false,
    isError: flags?.isError ?? false,
  };
}

function codexResponse() {
  return {
    ...response(),
    harnessKind: "codex",
    options: {
      models: [{ id: "gpt-5.6-sol", observedName: "GPT-5.6 Sol", observedDescription: null }],
      controls: [],
      defaults: { modelId: "gpt-5.6-sol", controlValues: {} },
    },
  };
}

function response() {
  return {
    harnessKind: "claude",
    basisRevision: "basis-1",
    revision: 2,
    state: "observed",
    probePhase: "idle",
    options: {
      models: [
        { id: "fable", observedName: "Fable", observedDescription: null },
        { id: "unknown-upstream", observedName: null, observedDescription: null },
      ],
      controls: [],
      defaults: { modelId: "fable", controlValues: {} },
    },
    observedAt: "2026-08-19T00:00:00Z",
    probeAttemptedAt: "2026-08-19T00:00:00Z",
    probeFailureCode: null,
    readiness: "ready",
  };
}
