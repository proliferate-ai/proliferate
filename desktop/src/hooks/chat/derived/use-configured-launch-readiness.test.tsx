// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { useConfiguredLaunchReadiness } from "@/hooks/chat/derived/use-configured-launch-readiness";

const mocks = vi.hoisted(() => ({
  useChatLaunchCatalog: vi.fn(),
  useAgentCatalog: vi.fn(),
}));

vi.mock("@/hooks/chat/derived/use-chat-launch-catalog", () => ({
  useChatLaunchCatalog: mocks.useChatLaunchCatalog,
}));

vi.mock("@/hooks/agents/derived/use-agent-catalog", () => ({
  useAgentCatalog: mocks.useAgentCatalog,
}));

describe("useConfiguredLaunchReadiness", () => {
  beforeEach(() => {
    useUserPreferencesStore.setState({
      defaultChatAgentKind: "opencode",
      defaultChatModelIdByAgentKind: {
        opencode: "opencode/custom-model",
      },
    });
    mocks.useChatLaunchCatalog.mockReturnValue({
      data: undefined,
      error: null,
      targetReadinessError: null,
      isLoading: false,
      launchAgents: [],
      defaultLaunchSelection: null,
    });
    mocks.useAgentCatalog.mockReturnValue({
      agentsByKind: new Map(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("blocks configured pre-session launch when the cloud catalog is unavailable", () => {
    mocks.useChatLaunchCatalog.mockReturnValue({
      data: undefined,
      error: new Error("cloud unavailable"),
      targetReadinessError: null,
      isLoading: false,
      launchAgents: [],
      defaultLaunchSelection: null,
    });

    const { result } = renderHook(() => useConfiguredLaunchReadiness());

    expect(result.current).toMatchObject({
      selection: null,
      disabledReason: "Couldn't load the agent catalog. Retry once cloud is reachable.",
      status: "unavailable",
      isLoading: false,
      isReady: false,
    });
  });

  it("blocks configured pre-session launch when target readiness is unavailable", () => {
    const targetError = new Error("runtime unavailable");
    mocks.useChatLaunchCatalog.mockReturnValue({
      data: {},
      error: targetError,
      targetReadinessError: targetError,
      isLoading: false,
      launchAgents: [],
      defaultLaunchSelection: null,
    });

    const { result } = renderHook(() => useConfiguredLaunchReadiness());

    expect(result.current).toMatchObject({
      selection: null,
      disabledReason: "Couldn't load target agent readiness. Retry once AnyHarness is reachable.",
      status: "unavailable",
      isLoading: false,
      isReady: false,
    });
  });

  it("blocks configured pre-session launch when the target agent is not ready", () => {
    mocks.useChatLaunchCatalog.mockReturnValue({
      data: {},
      error: null,
      targetReadinessError: null,
      isLoading: false,
      launchAgents: [{
        kind: "opencode",
        displayName: "OpenCode",
        defaultModelId: "opencode/custom-model",
        dynamicModels: true,
        modelDisplayPolicy: {
          defaultVisibleModelIds: [],
          allowUserVisibleModelSelection: true,
          moreModelsSource: "lastKnownLiveSnapshot",
        },
        models: [],
      }],
      defaultLaunchSelection: null,
    });
    mocks.useAgentCatalog.mockReturnValue({
      agentsByKind: new Map([
        ["opencode", {
          kind: "opencode",
          displayName: "OpenCode",
          readiness: "login_required",
        }],
      ]),
    });

    const { result } = renderHook(() => useConfiguredLaunchReadiness());

    expect(result.current).toMatchObject({
      selection: null,
      disabledReason: "OpenCode is login required.",
      status: "unavailable",
      isReady: false,
    });
  });

  it("blocks configured pre-session launch when target readiness is missing", () => {
    mocks.useChatLaunchCatalog.mockReturnValue({
      data: {},
      error: null,
      targetReadinessError: null,
      isLoading: false,
      launchAgents: [{
        kind: "opencode",
        displayName: "OpenCode",
        defaultModelId: "opencode/custom-model",
        dynamicModels: true,
        modelDisplayPolicy: {
          defaultVisibleModelIds: [],
          allowUserVisibleModelSelection: true,
          moreModelsSource: "lastKnownLiveSnapshot",
        },
        models: [],
      }],
      defaultLaunchSelection: null,
    });
    mocks.useAgentCatalog.mockReturnValue({
      agentsByKind: new Map(),
    });

    const { result } = renderHook(() => useConfiguredLaunchReadiness());

    expect(result.current).toMatchObject({
      selection: null,
      disabledReason: "opencode isn't supported by this runtime yet.",
      status: "unavailable",
      isReady: false,
    });
  });

  it("falls back to another ready agent when the fresh Claude default is unavailable", () => {
    useUserPreferencesStore.setState({
      defaultChatAgentKind: "claude",
      defaultChatModelIdByAgentKind: {},
    });
    mocks.useChatLaunchCatalog.mockReturnValue({
      data: {},
      error: null,
      targetReadinessError: null,
      isLoading: false,
      launchAgents: [{
        kind: "codex",
        displayName: "Codex",
        defaultModelId: "gpt-5.4",
        dynamicModels: false,
        modelDisplayPolicy: null,
        promptCapabilities: null,
        models: [{
          id: "gpt-5.4",
          displayName: "GPT 5.4",
          aliases: [],
          status: "active",
          isDefault: true,
          tags: [],
          launchRemediation: null,
        }],
        launchControls: [],
      }],
      defaultLaunchSelection: { kind: "codex", modelId: "gpt-5.4" },
    });
    mocks.useAgentCatalog.mockReturnValue({
      agentsByKind: new Map(),
    });

    const { result } = renderHook(() => useConfiguredLaunchReadiness());

    expect(result.current).toMatchObject({
      configuredKind: "claude",
      selection: { kind: "codex", modelId: "gpt-5.4" },
      displayName: "GPT 5.4",
      disabledReason: null,
      status: "ready",
      isReady: true,
    });
  });
});
