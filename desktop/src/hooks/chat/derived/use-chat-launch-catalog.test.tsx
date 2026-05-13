// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { useChatLaunchCatalog } from "@/hooks/chat/derived/use-chat-launch-catalog";
import type {
  DesktopAgentLaunchAgent,
  DesktopAgentLaunchCatalog,
} from "@/lib/domain/agents/cloud-launch-catalog";

const mocks = vi.hoisted(() => ({
  useCloudAgentCatalog: vi.fn(),
  useAgentCatalog: vi.fn(),
}));

vi.mock("@/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog", () => ({
  useCloudAgentCatalog: mocks.useCloudAgentCatalog,
}));

vi.mock("@/hooks/agents/derived/use-agent-catalog", () => ({
  useAgentCatalog: mocks.useAgentCatalog,
}));

function launchAgent(
  kind: string,
  modelId: string,
  displayName = kind,
): DesktopAgentLaunchAgent {
  return {
    kind,
    displayName,
    defaultModelId: modelId,
    defaultModeId: null,
    dynamicModels: false,
    modelDisplayPolicy: null,
    promptCapabilities: null,
    models: [{
      id: modelId,
      displayName: modelId,
      aliases: [],
      status: "active",
      isDefault: true,
      tags: [],
      launchRemediation: null,
    }],
    launchControls: [],
  };
}

function catalog(agents: DesktopAgentLaunchAgent[]): DesktopAgentLaunchCatalog {
  return {
    schemaVersion: 1,
    catalogVersion: "cloud-test",
    generatedAt: "2026-05-05T00:00:00Z",
    workspaceId: null,
    agents,
  };
}

describe("useChatLaunchCatalog", () => {
  beforeEach(() => {
    mocks.useCloudAgentCatalog.mockReturnValue({
      data: catalog([
        launchAgent("codex", "gpt-5.5", "Codex"),
        launchAgent("claude", "sonnet", "Claude"),
      ]),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    mocks.useAgentCatalog.mockReturnValue({
      isLoading: false,
      isError: false,
      error: null,
      agentsByKind: new Map([
        ["codex", { readiness: "ready" }],
        ["claude", { readiness: "ready" }],
      ]),
    });
    useSessionSelectionStore.setState({
      pendingWorkspaceEntry: null,
      selectedWorkspaceId: "workspace-1",
      hotPaintGate: null,
    });
    useUserPreferencesStore.setState({
      defaultChatAgentKind: "codex",
      defaultChatModelIdByAgentKind: { codex: "gpt-5.5" },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("uses the cloud agent catalog projection for launch groups and defaults", () => {
    const { result } = renderHook(() => useChatLaunchCatalog({ activeSelection: null }));

    expect(mocks.useCloudAgentCatalog).toHaveBeenCalledWith(true);
    expect(result.current.launchAgents.map((agent) => agent.kind)).toEqual([
      "claude",
      "codex",
    ]);
    expect(result.current.defaultLaunchSelection).toEqual({
      kind: "codex",
      modelId: "gpt-5.5",
    });
    expect(result.current.groups.map((group) => group.kind)).toEqual([
      "claude",
      "codex",
    ]);
    expect(result.current.snapshot).toMatchObject({
      snapshotId: "cloud-launch-catalog:workspace-1:cloud-test",
      runtimeUrl: null,
      catalogVersion: "cloud-test",
    });
  });

  it("surfaces cloud catalog errors without runtime fallback data", () => {
    const error = new Error("cloud unavailable");
    mocks.useCloudAgentCatalog.mockReturnValue({
      data: undefined,
      isLoading: false,
      error,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useChatLaunchCatalog({ activeSelection: null }));

    expect(result.current.error).toBe(error);
    expect(result.current.cloudCatalogError).toBe(error);
    expect(result.current.targetReadinessError).toBeNull();
    expect(result.current.launchAgents).toEqual([]);
    expect(result.current.hasLaunchableAgents).toBe(false);
    expect(result.current.isEmpty).toBe(false);
  });

  it("filters cloud launch options to target-ready agents", () => {
    mocks.useAgentCatalog.mockReturnValue({
      isLoading: false,
      isError: false,
      error: null,
      agentsByKind: new Map([
        ["codex", { readiness: "ready" }],
        ["claude", { readiness: "login_required" }],
      ]),
    });

    const { result } = renderHook(() => useChatLaunchCatalog({ activeSelection: null }));

    expect(result.current.launchAgents.map((agent) => agent.kind)).toEqual(["codex"]);
    expect(result.current.groups.map((group) => group.kind)).toEqual(["codex"]);
    expect(result.current.defaultLaunchSelection).toEqual({
      kind: "codex",
      modelId: "gpt-5.5",
    });
    expect(result.current.snapshot?.agents.map((agent) => agent.kind)).toEqual(["codex"]);
  });

  it("surfaces target readiness errors distinctly from cloud catalog errors", () => {
    const error = new Error("runtime unavailable");
    mocks.useAgentCatalog.mockReturnValue({
      isLoading: false,
      isError: true,
      error,
      agentsByKind: new Map(),
    });

    const { result } = renderHook(() => useChatLaunchCatalog({ activeSelection: null }));

    expect(result.current.error).toBe(error);
    expect(result.current.cloudCatalogError).toBeNull();
    expect(result.current.targetReadinessError).toBe(error);
    expect(result.current.launchAgents).toEqual([]);
    expect(result.current.hasLaunchableAgents).toBe(false);
    expect(result.current.isEmpty).toBe(false);
  });
});
