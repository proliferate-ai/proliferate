// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@anyharness/sdk";
import { useChatLaunchActions } from "./use-chat-launch-actions";

const launchMocks = vi.hoisted(() => ({
  createEmptySessionWithResolvedConfig: vi.fn(async () => undefined),
  setActiveSessionConfigOption: vi.fn(async () => undefined),
  createThreadFromSelection: vi.fn(async () => undefined),
  setWorkspaceArrivalEvent: vi.fn(),
  showToast: vi.fn(),
  useActiveSessionLaunchState: vi.fn(() => ({
    activeSessionId: "session-1",
    currentLaunchIdentity: {
      kind: "gemini",
      modelId: "gemini-3-flash-preview",
    },
    currentModelConfigId: "model",
    pendingConfigChanges: null,
    modelId: "gemini-3-flash-preview",
    agentKind: "gemini",
    modelControl: {
      key: "model",
      rawConfigId: "model",
      label: "Model",
      currentValue: "gemini-3-flash-preview",
      settable: true,
      values: [],
    },
  })),
}));

vi.mock("@/hooks/sessions/use-session-actions", () => ({
  useSessionActions: () => ({
    createEmptySessionWithResolvedConfig:
      launchMocks.createEmptySessionWithResolvedConfig,
    setActiveSessionConfigOption: launchMocks.setActiveSessionConfigOption,
  }),
}));

vi.mock("@/hooks/cowork/use-cowork-thread-workflow", () => ({
  useCoworkThreadWorkflow: () => ({
    createThreadFromSelection: launchMocks.createThreadFromSelection,
  }),
}));

vi.mock("@/hooks/workspaces/use-workspaces", () => ({
  useWorkspaces: () => ({
    data: {
      workspaces: [
        {
          id: "workspace-1",
          surface: "chat",
        } as unknown as Workspace,
      ],
    },
  }),
}));

vi.mock("@/stores/sessions/harness-store", () => ({
  useHarnessStore: (selector: (state: {
    selectedWorkspaceId: string;
    setWorkspaceArrivalEvent: (event: null) => void;
  }) => unknown) =>
    selector({
      selectedWorkspaceId: "workspace-1",
      setWorkspaceArrivalEvent: launchMocks.setWorkspaceArrivalEvent,
    }),
}));

vi.mock("@/stores/chat/chat-input-store", () => ({
  useChatInputStore: (selector: (state: {
    draftByWorkspaceId: Record<string, never>;
  }) => unknown) => selector({ draftByWorkspaceId: {} }),
}));

vi.mock("@/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: {
    show: (message: string) => void;
  }) => unknown) => selector({ show: launchMocks.showToast }),
}));

vi.mock("@/stores/workspaces/logical-workspace-store", () => ({
  useLogicalWorkspaceStore: (selector: (state: {
    selectedLogicalWorkspaceId: string | null;
  }) => unknown) => selector({ selectedLogicalWorkspaceId: null }),
}));

vi.mock("@/lib/infra/latency-flow", () => ({
  failLatencyFlow: vi.fn(),
  startLatencyFlow: vi.fn(() => "latency-flow-1"),
}));

vi.mock("./use-active-chat-session-selectors", () => ({
  useActiveSessionLaunchState: launchMocks.useActiveSessionLaunchState,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useChatLaunchActions", () => {
  it("updates the active same-agent session when the model control uses synthetic model id", () => {
    const { result } = renderHook(() => useChatLaunchActions());

    act(() => {
      result.current.handleLaunchSelect({
        kind: "gemini",
        modelId: "gemini-2.5-flash-lite",
      });
    });

    expect(launchMocks.setActiveSessionConfigOption).toHaveBeenCalledWith(
      "model",
      "gemini-2.5-flash-lite",
    );
    expect(launchMocks.createEmptySessionWithResolvedConfig).not.toHaveBeenCalled();
    expect(launchMocks.createThreadFromSelection).not.toHaveBeenCalled();
  });
});
