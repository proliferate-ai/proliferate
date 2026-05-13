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
      isLoading: false,
      launchAgents: [],
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
      isLoading: false,
      launchAgents: [],
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
});
