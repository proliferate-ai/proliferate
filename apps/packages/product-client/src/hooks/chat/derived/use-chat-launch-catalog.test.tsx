// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";
import { useChatLaunchCatalog } from "#product/hooks/chat/derived/use-chat-launch-catalog";

const mocks = vi.hoisted(() => ({
  query: { data: undefined as Record<string, unknown> | undefined, isLoading: false, isError: false, error: null as Error | null },
  otherResponses: [] as Array<Record<string, unknown> | null>,
  otherKindsRequested: null as readonly string[] | null,
  readyAgentKinds: new Set(["claude"]),
  cloudConnectionInfo: null as Record<string, unknown> | null,
}));

vi.mock("#product/hooks/agents/derived/use-agent-catalog", () => ({
  useAgentCatalog: () => ({
    readyAgentKinds: mocks.readyAgentKinds, isLoading: false, isError: false, error: null,
  }),
}));
vi.mock("#product/hooks/access/anyharness/agents/use-workspace-agent-launch-options", () => ({
  useWorkspaceAgentLaunchOptionsQuery: () => mocks.query,
  useWorkspaceAgentsLaunchOptionsListQuery: (args: { harnessKinds: readonly string[] }) => {
    mocks.otherKindsRequested = args.harnessKinds;
    return mocks.otherResponses;
  },
}));
vi.mock("#product/hooks/workspaces/facade/use-selected-cloud-runtime-state", () => ({
  useSelectedCloudRuntimeState: () => ({ connectionInfo: mocks.cloudConnectionInfo }),
}));

describe("useChatLaunchCatalog", () => {
  beforeEach(() => {
    mocks.query = { data: response(["fable", "unknown-upstream"]), isLoading: false, isError: false, error: null };
    mocks.otherResponses = [];
    mocks.otherKindsRequested = null;
    mocks.readyAgentKinds = new Set(["claude"]);
    mocks.cloudConnectionInfo = null;
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

  it("keeps every other ready harness listed while a session is active", () => {
    mocks.readyAgentKinds = new Set(["claude", "codex"]);
    mocks.otherResponses = [response(["gpt-5.6-sol"], "codex")];
    const { result } = renderHook(() => useChatLaunchCatalog({
      activeSelection: { kind: "claude", modelId: "live-only" },
      activeModelControl: {
        kind: "claude",
        values: [{ value: "live-only", label: "Live only" }],
      },
    }));
    // Negative control against the cutover regression: an active live control
    // must not collapse the picker to the active harness alone.
    expect(result.current.groups.map((group) => group.kind)).toEqual(["claude", "codex"]);
    expect(result.current.groups[0]?.models.map((model) => model.modelId)).toEqual(["live-only"]);
    expect(result.current.groups[1]?.models.map((model) => model.modelId)).toEqual(["gpt-5.6-sol"]);
    expect(result.current.groups[1]?.models[0]?.actionKind).toBe("open_new_chat");
  });

  it("fans out over the sandbox ready list on a cloud workspace, not the local one", () => {
    mocks.readyAgentKinds = new Set(["claude", "codex"]);
    mocks.cloudConnectionInfo = { readyAgentKinds: ["claude", "grok"] };
    mocks.otherResponses = [response(["grok-4.6"], "grok")];
    const { result } = renderHook(() => useChatLaunchCatalog({ activeSelection: null }));
    // Negative control: the LOCAL runtime's ready list (codex) must not drive
    // the cloud fan-out; the sandbox connection's list (grok) is the authority.
    expect(mocks.otherKindsRequested).toEqual(["grok"]);
    expect(result.current.groups.map((group) => group.kind)).toEqual(["claude", "grok"]);
  });

  it("omits an unresolved other harness without failing the catalog", () => {
    mocks.readyAgentKinds = new Set(["claude", "codex"]);
    mocks.otherResponses = [null];
    const { result } = renderHook(() => useChatLaunchCatalog({ activeSelection: null }));
    expect(result.current.groups.map((group) => group.kind)).toEqual(["claude"]);
    expect(result.current.error).toBeNull();
  });
});

function response(ids: string[], harnessKind = "claude") {
  return {
    harnessKind, basisRevision: "basis-1", revision: 5, state: "observed",
    options: {
      models: ids.map((id) => ({ id, observedName: id === "fable" ? "Fable" : null, observedDescription: null })),
      controls: [], defaults: { modelId: ids[0] ?? null, controlValues: {} },
    },
    observedAt: null, probeAttemptedAt: null, probeFailureCode: null, readiness: "ready",
  };
}
