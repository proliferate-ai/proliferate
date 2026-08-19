// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";
import { useHomeNextModelSelection } from "#product/hooks/home/derived/use-home-next-model-selection";

const mocks = vi.hoisted(() => ({ data: undefined as Record<string, unknown> | undefined }));

vi.mock("@anyharness/sdk-react", () => ({
  useAgentLaunchOptionsQuery: () => ({
    data: mocks.data,
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

vi.mock("#product/hooks/agents/derived/use-agent-catalog", () => ({
  useAgentCatalog: () => ({ readyAgents: [], isLoading: false, isError: false, error: null }),
}));

describe("useHomeNextModelSelection", () => {
  beforeEach(() => {
    mocks.data = undefined;
    useUserPreferencesStore.setState({
      defaultChatAgentKind: "claude",
      defaultChatModelIdByAgentKind: {},
    });
  });
  afterEach(cleanup);

  it("uses the exact observed default and keeps an unknown upstream id reachable", () => {
    mocks.data = response();
    const { result } = renderHook(() => useHomeNextModelSelection({ modelSelectionOverride: null }));
    expect(result.current.modelAvailabilityState).toBe("launchable");
    expect(result.current.effectiveModelSelection).toEqual({ kind: "claude", modelId: "fable" });
    expect(result.current.modelGroups[0]?.models.map((model) => model.modelId)).toEqual([
      "fable",
      "unknown-upstream",
    ]);
  });

  it("offers no explicit model before the target has an observation", () => {
    const { result } = renderHook(() => useHomeNextModelSelection({ modelSelectionOverride: null }));
    expect(result.current.modelAvailabilityState).toBe("no_launchable_model");
    expect(result.current.effectiveModelSelection).toBeNull();
  });
});

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
