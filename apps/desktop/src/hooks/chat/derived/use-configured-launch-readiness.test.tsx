// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { useConfiguredLaunchReadiness } from "@/hooks/chat/derived/use-configured-launch-readiness";

const mocks = vi.hoisted(() => ({
  useChatLaunchCatalog: vi.fn(),
}));

vi.mock("@/hooks/chat/derived/use-chat-launch-catalog", () => ({
  useChatLaunchCatalog: mocks.useChatLaunchCatalog,
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

  it("blocks configured pre-session launch when the configured target agent is unavailable", () => {
    mocks.useChatLaunchCatalog.mockReturnValue({
      data: {},
      error: null,
      targetReadinessError: null,
      isLoading: false,
      launchAgents: [],
      defaultLaunchSelection: null,
    });

    const { result } = renderHook(() => useConfiguredLaunchReadiness());

    expect(result.current).toMatchObject({
      selection: null,
      disabledReason: "opencode isn't available on this target.",
      status: "unavailable",
      isReady: false,
    });
  });

  it("allows cloud-ready target agents even when local readiness would be missing", () => {
    mocks.useChatLaunchCatalog.mockReturnValue({
      data: {},
      error: null,
      targetReadinessError: null,
      isLoading: false,
      launchAgents: [{
        kind: "opencode",
        displayName: "OpenCode",
        defaultModelId: "opencode/custom-model",
        models: [{
          id: "opencode/custom-model",
          displayName: "Custom Model",
          aliases: [],
          status: "active",
          isDefault: true,
        }],
        launchControls: [],
      }],
      defaultLaunchSelection: { kind: "opencode", modelId: "opencode/custom-model" },
    });

    const { result } = renderHook(() => useConfiguredLaunchReadiness());

    expect(result.current).toMatchObject({
      selection: { kind: "opencode", modelId: "opencode/custom-model" },
      status: "ready",
      isReady: true,
    });
  });

  it("falls back to a ready target agent when the fresh Claude default is unavailable", () => {
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
        models: [{
          id: "gpt-5.4",
          displayName: "GPT 5.4",
          aliases: [],
          status: "active",
          isDefault: true,
        }],
        launchControls: [],
      }],
      defaultLaunchSelection: { kind: "codex", modelId: "gpt-5.4" },
    });
    const { result } = renderHook(() => useConfiguredLaunchReadiness());

    expect(result.current).toMatchObject({
      configuredKind: "codex",
      selection: { kind: "codex", modelId: "gpt-5.4" },
      displayName: "GPT 5.4",
      status: "ready",
      isReady: true,
    });
  });
});
