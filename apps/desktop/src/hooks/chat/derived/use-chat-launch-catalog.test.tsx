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
  useWorkspaceAgentLaunchOptionsQuery: vi.fn(),
  useSelectedCloudRuntimeState: vi.fn(),
}));

vi.mock("@/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog", () => ({
  useCloudAgentCatalog: mocks.useCloudAgentCatalog,
}));

vi.mock("@/hooks/agents/derived/use-agent-catalog", () => ({
  useAgentCatalog: mocks.useAgentCatalog,
}));

vi.mock("@/hooks/access/anyharness/agents/use-workspace-agent-launch-options", () => ({
  useWorkspaceAgentLaunchOptionsQuery: mocks.useWorkspaceAgentLaunchOptionsQuery,
}));

vi.mock("@/hooks/workspaces/facade/use-selected-cloud-runtime-state", () => ({
  useSelectedCloudRuntimeState: mocks.useSelectedCloudRuntimeState,
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
    models: [{
      id: modelId,
      displayName: modelId,
      aliases: [],
      status: "active",
      isDefault: true,
    }],
    launchControls: [],
  };
}

function catalog(agents: DesktopAgentLaunchAgent[]): DesktopAgentLaunchCatalog {
  return {
    schemaVersion: 2,
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
    mocks.useWorkspaceAgentLaunchOptionsQuery.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    });
    mocks.useSelectedCloudRuntimeState.mockReturnValue({
      connectionInfo: null,
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
    expect(mocks.useWorkspaceAgentLaunchOptionsQuery).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      cloudConnectionInfo: null,
    });
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

    const { result } = renderHook(() => useChatLaunchCatalog({
      activeSelection: { kind: "claude", modelId: "opus[1m]" },
    }));

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

  it("uses runtime launch options when the target has refreshed dynamic models", () => {
    mocks.useCloudAgentCatalog.mockReturnValue({
      data: catalog([
        launchAgent("cursor", "auto", "Cursor"),
      ]),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    mocks.useAgentCatalog.mockReturnValue({
      isLoading: false,
      isError: false,
      error: null,
      agentsByKind: new Map([["cursor", { readiness: "ready" }]]),
    });
    mocks.useWorkspaceAgentLaunchOptionsQuery.mockReturnValue({
      data: {
        workspaceId: "workspace-1",
        agents: [{
          kind: "cursor",
          displayName: "Cursor",
          defaultModelId: "gpt-5.4-medium",
          models: [{
            id: "gpt-5.4-medium",
            displayName: "GPT-5.4 1M",
            isDefault: true,
            defaultOptIn: true,
          }],
        }],
      },
      isLoading: false,
      isError: false,
      error: null,
    });
    useUserPreferencesStore.setState({
      defaultChatAgentKind: "cursor",
      defaultChatModelIdByAgentKind: { cursor: "gpt-5.4-medium" },
    });

    const { result } = renderHook(() => useChatLaunchCatalog({ activeSelection: null }));

    expect(result.current.launchAgents[0]?.models.map((model) => model.id)).toEqual([
      "gpt-5.4-medium",
    ]);
    expect(result.current.defaultLaunchSelection).toEqual({
      kind: "cursor",
      modelId: "gpt-5.4-medium",
    });
  });

  it("uses managed cloud runtime launch options instead of stale cloud catalog models", () => {
    mocks.useCloudAgentCatalog.mockReturnValue({
      data: catalog([
        launchAgent("codex", "gpt-5.5", "Codex"),
        launchAgent("claude", "opus[1m]", "Claude"),
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
    const cloudConnectionInfo = {
      runtimeUrl: "https://api.local/v1/gateway/managed-sandbox/anyharness",
      accessToken: "product-token",
      anyharnessWorkspaceId: "cloud-workspace-1",
      readyAgentKinds: ["codex"],
    };
    mocks.useSelectedCloudRuntimeState.mockReturnValue({
      connectionInfo: cloudConnectionInfo,
    });
    mocks.useWorkspaceAgentLaunchOptionsQuery.mockReturnValue({
      data: {
        workspaceId: "cloud-workspace-1",
        agents: [{
          kind: "claude",
          displayName: "Claude",
          defaultModelId: "opus",
          models: [{
            id: "opus",
            displayName: "Opus",
            isDefault: true,
            defaultOptIn: true,
          }],
        }],
      },
      isLoading: false,
      isError: false,
      error: null,
    });
    useUserPreferencesStore.setState({
      defaultChatAgentKind: "claude",
      defaultChatModelIdByAgentKind: { claude: "opus[1m]" },
    });

    const { result } = renderHook(() => useChatLaunchCatalog({
      activeSelection: { kind: "claude", modelId: "opus[1m]" },
    }));

    expect(mocks.useWorkspaceAgentLaunchOptionsQuery).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      cloudConnectionInfo,
    });
    expect(result.current.launchAgents.map((agent) => agent.kind)).toEqual(["claude"]);
    expect(result.current.launchAgents[0]?.models.map((model) => model.id)).toEqual(["opus"]);
    expect(result.current.defaultLaunchSelection).toEqual({
      kind: "claude",
      modelId: "opus",
    });
    expect(result.current.selectedLaunchSelection).toEqual({
      kind: "claude",
      modelId: "opus",
    });
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
