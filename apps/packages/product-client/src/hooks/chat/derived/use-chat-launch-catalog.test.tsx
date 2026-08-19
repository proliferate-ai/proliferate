// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";
import { useChatLaunchCatalog } from "#product/hooks/chat/derived/use-chat-launch-catalog";

const mocks = vi.hoisted(() => ({
  query: { data: undefined as Record<string, unknown> | undefined, isLoading: false, isError: false, error: null as Error | null },
}));

vi.mock("#product/hooks/agents/derived/use-agent-catalog", () => ({
  useAgentCatalog: () => ({
    readyAgentKinds: new Set(["claude"]), isLoading: false, isError: false, error: null,
  }),
}));
vi.mock("#product/hooks/access/anyharness/agents/use-workspace-agent-launch-options", () => ({
  useWorkspaceAgentLaunchOptionsQuery: () => mocks.query,
}));
vi.mock("#product/hooks/workspaces/facade/use-selected-cloud-runtime-state", () => ({
  useSelectedCloudRuntimeState: () => ({ connectionInfo: null }),
}));

describe("useChatLaunchCatalog", () => {
  beforeEach(() => {
    mocks.query = { data: response(["fable", "unknown-upstream"]), isLoading: false, isError: false, error: null };
    useSessionSelectionStore.setState({ selectedWorkspaceId: "workspace-1" });
    useUserPreferencesStore.setState({
      defaultChatAgentKind: "claude",
      defaultChatModelIdByAgentKind: { claude: "fable" },
    });
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("maps one target response without adding or dropping executable ids", () => {
    const { result } = renderHook(() => useChatLaunchCatalog({ activeSelection: null }));
    expect(result.current.groups[0]?.models.map((model) => model.modelId)).toEqual([
      "fable", "unknown-upstream",
    ]);
    expect(result.current.defaultLaunchSelection).toEqual({ kind: "claude", modelId: "fable" });
    expect(result.current.snapshot?.snapshotId).toContain("harness-launch-options:workspace-1:claude:basis-1:5");
  });

  it("surfaces a typed target-read error without catalog fallback choices", () => {
    const error = new Error("target unavailable");
    mocks.query = { data: undefined, isLoading: false, isError: true, error };
    const { result } = renderHook(() => useChatLaunchCatalog({ activeSelection: null }));
    expect(result.current.error).toBe(error);
    expect(result.current.launchAgents).toEqual([]);
  });

  it("renders active session models from the live snapshot even if target options differ", () => {
    const { result } = renderHook(() => useChatLaunchCatalog({
      activeSelection: { kind: "claude", modelId: "live-only" },
      activeModelControl: {
        kind: "claude",
        values: [{ value: "live-only", label: "Live only" }],
      },
    }));
    expect(result.current.groups[0]?.models.map((model) => model.modelId)).toEqual(["live-only"]);
  });
});

function response(ids: string[]) {
  return {
    harnessKind: "claude", basisRevision: "basis-1", revision: 5, state: "observed",
    options: {
      models: ids.map((id) => ({ id, observedName: id === "fable" ? "Fable" : null, observedDescription: null })),
      controls: [], defaults: { modelId: "fable", controlValues: {} },
    },
    observedAt: null, probeAttemptedAt: null, probeFailureCode: null, readiness: "ready",
  };
}
