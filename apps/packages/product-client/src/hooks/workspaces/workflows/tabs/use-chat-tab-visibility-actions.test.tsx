// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmptySessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { useChatTabVisibilityActions } from "#product/hooks/workspaces/workflows/tabs/use-chat-tab-visibility-actions";

const activationMocks = vi.hoisted(() => ({
  activateChatShell: vi.fn(),
  activateChatTab: vi.fn(),
}));

vi.mock("#product/hooks/sessions/workflows/use-session-restore-actions", () => ({
  useSessionRestoreActions: () => ({
    restoreLastDismissedSession: vi.fn().mockResolvedValue(null),
  }),
}));

vi.mock("#product/hooks/workspaces/workflows/tabs/use-chat-session-archive-action", () => ({
  useChatSessionArchiveAction: () => vi.fn(),
}));

vi.mock("#product/hooks/workspaces/workflows/tabs/use-workspace-shell-activation", () => ({
  useWorkspaceShellActivation: () => activationMocks,
}));

const WORKSPACE_UI_KEY = "logical:repo";
const MATERIALIZED_WORKSPACE_ID = "workspace-1";

describe("useChatTabVisibilityActions hide flows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activationMocks.activateChatTab.mockResolvedValue({ result: "completed" });
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
    useSessionSelectionStore.setState({
      selectedWorkspaceId: MATERIALIZED_WORKSPACE_ID,
      activeSessionId: null,
      pendingWorkspaceEntry: null,
    });
    putSessionRecord({
      ...createEmptySessionRecord("session-1", "codex", {
        workspaceId: MATERIALIZED_WORKSPACE_ID,
        materializedSessionId: "materialized-1",
      }),
      transcriptHydrated: true,
    });
    useWorkspaceUiStore.setState({
      lastViewedSessionByWorkspace: {
        [WORKSPACE_UI_KEY]: "materialized-1",
        [MATERIALIZED_WORKSPACE_ID]: "materialized-1",
      },
      pendingChatActivationByWorkspace: {},
      recentlyHiddenChatSessionIdsByWorkspace: {},
      visibleChatSessionIdsByWorkspace: {
        [WORKSPACE_UI_KEY]: ["session-1", "session-2"],
      },
    });
  });

  function renderVisibilityActions() {
    return renderHook(() => useChatTabVisibilityActions({
      workspaceUiKey: WORKSPACE_UI_KEY,
      materializedWorkspaceId: MATERIALIZED_WORKSPACE_ID,
      visibleIds: ["session-1", "session-2"],
      liveIds: ["session-1", "session-2"],
      childToParent: new Map(),
    }));
  }

  it("hiding a tab forgets it as the last-viewed session under both workspace keys", () => {
    const { result } = renderVisibilityActions();

    act(() => {
      expect(result.current.hideChatSessionTabs(["session-1"])).toBe(true);
    });

    const workspaceUiState = useWorkspaceUiStore.getState();
    expect(
      workspaceUiState.recentlyHiddenChatSessionIdsByWorkspace[WORKSPACE_UI_KEY],
    ).toEqual(["session-1"]);
    expect(workspaceUiState.lastViewedSessionByWorkspace[WORKSPACE_UI_KEY]).toBeUndefined();
    expect(
      workspaceUiState.lastViewedSessionByWorkspace[MATERIALIZED_WORKSPACE_ID],
    ).toBeUndefined();
  });

  it("closing the active tab selects its neighbor", () => {
    useSessionSelectionStore.setState({ activeSessionId: "session-2" });
    const { result } = renderVisibilityActions();

    act(() => {
      expect(result.current.hideChatSessionTabs(["session-2"], { selectFallback: true })).toBe(true);
    });

    expect(activationMocks.activateChatTab).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "session-1" }),
    );
  });

  it("resolves the close fallback against a pending activation, not the stale committed active (PRO-101)", () => {
    // Mirrors the second of two rapid Cmd+W presses: the first close hid
    // "session-hidden" and its fallback activation of "session-2" is still
    // pending, so the committed activeSessionId lags on the hidden session.
    useSessionSelectionStore.setState({ activeSessionId: "session-hidden" });
    useWorkspaceUiStore.setState({
      pendingChatActivationByWorkspace: {
        [WORKSPACE_UI_KEY]: {
          attemptId: "attempt-1",
          sessionId: "session-2",
          intent: "chat:session-2",
          guardToken: 1,
          workspaceSelectionNonce: 0,
          shellEpochAtWrite: 0,
          sessionActivationEpochAtWrite: 1,
        },
      },
    });
    const { result } = renderVisibilityActions();

    act(() => {
      expect(result.current.hideChatSessionTabs(["session-2"], { selectFallback: true })).toBe(true);
    });

    expect(activationMocks.activateChatTab).toHaveBeenCalledTimes(1);
    expect(activationMocks.activateChatTab).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "session-1" }),
    );
  });

  it("hiding a tab leaves an unrelated last-viewed session untouched", () => {
    useWorkspaceUiStore.setState({
      lastViewedSessionByWorkspace: {
        [WORKSPACE_UI_KEY]: "materialized-other",
      },
    });
    const { result } = renderVisibilityActions();

    act(() => {
      expect(result.current.hideChatSessionTabs(["session-1"])).toBe(true);
    });

    expect(
      useWorkspaceUiStore.getState().lastViewedSessionByWorkspace[WORKSPACE_UI_KEY],
    ).toBe("materialized-other");
  });
});
