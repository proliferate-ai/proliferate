// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatLaunchActions } from "#product/hooks/chat/workflows/use-chat-launch-actions";

const mocks = vi.hoisted(() => ({
  createEmptySessionWithResolvedConfig: vi.fn(async () => "client-new"),
  createThreadFromSelection: vi.fn(),
  failLatencyFlow: vi.fn(),
  persistPreferences: vi.fn(),
  setActiveSessionConfigOption: vi.fn(),
  setWorkspaceArrivalEvent: vi.fn(),
  showToast: vi.fn(),
  startLatencyFlow: vi.fn(() => "flow-1"),
}));

vi.mock("#product/hooks/sessions/workflows/use-session-creation-actions", () => ({
  useSessionCreationActions: () => ({
    createEmptySessionWithResolvedConfig: mocks.createEmptySessionWithResolvedConfig,
  }),
}));

vi.mock("#product/hooks/sessions/workflows/use-session-config-actions", () => ({
  useSessionConfigActions: () => ({
    setActiveSessionConfigOption: mocks.setActiveSessionConfigOption,
  }),
}));

vi.mock("#product/providers/CoworkThreadLaunchProvider", () => ({
  useCoworkThreadLaunchContext: () => ({
    desktopTargetsAvailable: true,
    createThreadFromSelection: mocks.createThreadFromSelection,
  }),
}));

vi.mock("#product/hooks/workspaces/cache/use-workspaces", () => ({
  useWorkspaces: () => ({ data: { workspaces: [] } }),
}));

vi.mock("#product/hooks/chat/derived/use-active-session-config-state", () => ({
  useActiveSessionLaunchState: () => ({
    activeSessionId: "store-active",
    currentLaunchIdentity: { kind: "codex", modelId: "gpt-5" },
    currentModelConfigId: "model",
    modelControl: null,
  }),
}));

vi.mock("#product/hooks/chat/derived/use-configured-launch-readiness", () => ({
  useConfiguredLaunchReadiness: () => ({
    disabledReason: null,
    launchCatalog: { launchAgents: [] },
  }),
}));

vi.mock("#product/lib/domain/chat/models/launch-selection-defaults", () => ({
  resolveAvailableLaunchSelection: (_agents: unknown, selection: unknown) => selection,
}));

vi.mock("#product/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (selector: (state: unknown) => unknown) => selector({
    selectedWorkspaceId: "workspace-1",
    selectedLogicalWorkspaceId: "logical-workspace-1",
    setWorkspaceArrivalEvent: mocks.setWorkspaceArrivalEvent,
  }),
}));

vi.mock("#product/stores/chat/chat-input-store", () => ({
  useChatInputStore: {
    getState: () => ({ draftByWorkspaceId: {} }),
  },
}));

vi.mock("#product/stores/preferences/user-preferences-store", () => ({
  useUserPreferencesStore: {
    getState: () => ({
      defaultChatModelIdByAgentKind: {},
      setMultiple: mocks.persistPreferences,
    }),
  },
}));

vi.mock("#product/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: unknown) => unknown) => selector({
    show: mocks.showToast,
  }),
}));

vi.mock("#product/lib/infra/measurement/measurement-port", () => ({
  failLatencyFlow: mocks.failLatencyFlow,
  startLatencyFlow: mocks.startLatencyFlow,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => cleanup());

describe("useChatLaunchActions replacement identity", () => {
  it("uses the rendered pending shell as the replacement while config state is suppressed", () => {
    const { result } = renderHook(() => useChatLaunchActions({
      suppressActiveSessionState: true,
      replacementSessionId: "pending-visible",
    }));

    act(() => {
      result.current.handleLaunchSelect({ kind: "claude", modelId: "sonnet" });
    });

    expect(mocks.createEmptySessionWithResolvedConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        agentKind: "claude",
        modelId: "sonnet",
        replacesSessionId: "pending-visible",
      }),
    );
  });

  it("uses the active materialized session when no pending render identity exists", () => {
    const { result } = renderHook(() => useChatLaunchActions());

    act(() => {
      result.current.handleLaunchSelect({ kind: "claude", modelId: "sonnet" });
    });

    expect(mocks.createEmptySessionWithResolvedConfig).toHaveBeenCalledWith(
      expect.objectContaining({ replacesSessionId: "store-active" }),
    );
  });
});
