// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";
import { useHomeNextModelSelection } from "#product/hooks/home/derived/use-home-next-model-selection";

const mocks = vi.hoisted(() => ({
  args: null as Record<string, unknown> | null,
  data: undefined as Record<string, unknown> | undefined,
  otherResponses: [] as Array<Record<string, unknown> | null>,
  readyAgents: [] as Array<{ kind: string }>,
  isTargetUnobserved: false,
}));

vi.mock("#product/hooks/home/derived/use-home-target-agent-launch-options", () => ({
  useHomeTargetAgentLaunchOptions: (args: Record<string, unknown>) => {
    mocks.args = args;
    return {
      data: mocks.data,
      isLoading: false,
      isError: false,
      error: null,
      isTargetUnobserved: mocks.isTargetUnobserved,
    };
  },
  useHomeTargetOtherAgentsLaunchOptions: () => mocks.otherResponses,
}));

vi.mock("#product/hooks/agents/derived/use-agent-catalog", () => ({
  useAgentCatalog: () => ({ readyAgents: mocks.readyAgents, isLoading: false, isError: false, error: null }),
}));

describe("useHomeNextModelSelection", () => {
  beforeEach(() => {
    mocks.args = null;
    mocks.data = undefined;
    mocks.otherResponses = [];
    mocks.readyAgents = [];
    mocks.isTargetUnobserved = false;
    useUserPreferencesStore.setState({
      defaultChatAgentKind: "claude",
      defaultChatModelIdByAgentKind: {},
    });
  });
  afterEach(cleanup);

  it("uses the exact observed default and keeps an unknown upstream id reachable", () => {
    mocks.data = response();
    const launchTarget = { kind: "local", sourceRoot: "/repo", existingWorkspaceId: null } as const;
    const { result } = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
      launchTarget,
    }));
    expect(result.current.modelAvailabilityState).toBe("launchable");
    expect(mocks.args).toEqual({ harnessKind: "claude", launchTarget });
    expect(result.current.effectiveModelSelection).toEqual({ kind: "claude", modelId: "fable" });
    expect(result.current.modelGroups[0]?.models.map((model) => model.modelId)).toEqual([
      "fable",
      "unknown-upstream",
    ]);
  });

  it("keeps every other ready harness pickable from the launch composer", () => {
    mocks.data = response();
    mocks.readyAgents = [{ kind: "claude" }, { kind: "codex" }];
    mocks.otherResponses = [codexResponse()];
    const launchTarget = { kind: "local", sourceRoot: "/repo", existingWorkspaceId: null } as const;
    const { result } = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
      launchTarget,
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
    mocks.otherResponses = [null];
    const { result } = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
      launchTarget: { kind: "local", sourceRoot: "/repo", existingWorkspaceId: null },
    }));
    expect(result.current.modelGroups.map((group) => group.kind)).toEqual(["claude"]);
    expect(result.current.modelAvailabilityState).toBe("launchable");
  });

  it("offers no explicit model before the target has an observation", () => {
    mocks.isTargetUnobserved = true;
    const { result } = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
      launchTarget: {
        kind: "cloud",
        gitOwner: "owner",
        gitRepoName: "repo",
        baseBranch: "main",
      },
    }));
    expect(result.current.modelAvailabilityState).toBe("target_unobserved");
    expect(result.current.effectiveModelSelection).toBeNull();
  });

  it("offers no explicit model when no launch target is selected", () => {
    const { result } = renderHook(() => useHomeNextModelSelection({
      modelSelectionOverride: null,
      launchTarget: null,
    }));
    expect(result.current.modelAvailabilityState).toBe("no_launchable_model");
    expect(result.current.effectiveModelSelection).toBeNull();
  });
});

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
