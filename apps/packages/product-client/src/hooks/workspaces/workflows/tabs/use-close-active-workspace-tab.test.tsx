// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceContentShortcuts } from "#product/hooks/workspaces/ui/use-workspace-content-shortcuts";
import { useCloseActiveWorkspaceTab } from "#product/hooks/workspaces/workflows/tabs/use-close-active-workspace-tab";
import { commitActiveSession } from "#product/hooks/sessions/workflows/session-activation-guard";
import {
  resolveWorkspaceShellActivation,
  type PendingChatActivation,
} from "#product/lib/domain/workspaces/tabs/shell-activation";
import {
  chatWorkspaceShellTabKey,
  type WorkspaceShellTab,
} from "#product/lib/domain/workspaces/tabs/shell-tabs";
import type { HeaderWorkspaceShellStripRow } from "#product/lib/domain/workspaces/tabs/workspace-header-tabs-view-model-types";
import { WORKSPACE_UI_DEFAULTS } from "#product/lib/domain/preferences/workspace-ui/model";
import {
  clearShortcutHandlerRegistryForTests,
  runShortcutHandler,
} from "#product/lib/domain/shortcuts/registry";
import {
  createEmptySessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";

const WORKSPACE_ID = "workspace-1";
const SESSION_IDS = ["session-a", "session-b", "session-c"] as const;

const hookMocks = vi.hoisted(() => ({
  selectSession: vi.fn(),
  scheduledCallbacks: [] as Array<() => void>,
}));

vi.mock("#product/hooks/sessions/facade/use-session-selection-actions", () => ({
  useSessionSelectionActions: () => ({
    selectSession: hookMocks.selectSession,
  }),
}));

vi.mock("#product/hooks/sessions/workflows/use-session-restore-actions", () => ({
  useSessionRestoreActions: () => ({
    restoreLastDismissedSession: vi.fn(),
  }),
}));

vi.mock("#product/hooks/workspaces/workflows/tabs/use-chat-session-archive-action", () => ({
  useChatSessionArchiveAction: () => vi.fn(),
}));

vi.mock("#product/lib/infra/scheduling/schedule-after-next-paint", () => ({
  scheduleAfterNextPaint: vi.fn((callback: () => void) => {
    hookMocks.scheduledCallbacks.push(callback);
    return () => {
      hookMocks.scheduledCallbacks = hookMocks.scheduledCallbacks
        .filter((candidate) => candidate !== callback);
    };
  }),
}));

function useRepeatedCloseHarness() {
  const visibleIds = useWorkspaceUiStore(
    (state) => state.visibleChatSessionIdsByWorkspace[WORKSPACE_ID] ?? [],
  );
  const pending = useWorkspaceUiStore(
    (state) => state.pendingChatActivationByWorkspace[WORKSPACE_ID] ?? null,
  );
  const storedIntent = useWorkspaceUiStore(
    (state) => state.activeShellTabKeyByWorkspace[WORKSPACE_ID] ?? null,
  );
  const shellActivationEpoch = useWorkspaceUiStore(
    (state) => state.shellActivationEpochByWorkspace[WORKSPACE_ID] ?? 0,
  );
  const activeSessionId = useSessionSelectionStore((state) => state.activeSessionId);
  const workspaceSelectionNonce = useSessionSelectionStore(
    (state) => state.workspaceSelectionNonce,
  );
  const sessionActivationEpoch = useSessionSelectionStore(
    (state) => state.sessionActivationIntentEpochByWorkspace[WORKSPACE_ID] ?? 0,
  );
  const orderedTabs: WorkspaceShellTab[] = visibleIds.map((sessionId) => ({
    kind: "chat",
    sessionId,
  }));
  const orderedTabKeys = visibleIds.map(chatWorkspaceShellTabKey);
  const activation = resolveWorkspaceShellActivation({
    workspaceId: WORKSPACE_ID,
    storedIntent,
    orderedTabs: orderedTabKeys,
    activeSessionId,
    activeViewerTargetKey: null,
    liveChatSessionIds: new Set(SESSION_IDS),
    openViewerTargetKeys: new Set(),
    pendingChatActivation: pending,
    currentShellActivationEpoch: shellActivationEpoch,
    currentSessionActivationEpoch: sessionActivationEpoch,
    currentWorkspaceSelectionNonce: workspaceSelectionNonce,
  });
  const highlightedSessionId = activation.highlightedTabKey?.startsWith("chat:")
    ? activation.highlightedTabKey.slice("chat:".length)
    : null;
  const activeShellTab = highlightedSessionId
    ? { kind: "chat" as const, sessionId: highlightedSessionId }
    : null;
  const shellRows = visibleIds.map((sessionId) => ({
    kind: "chat",
    row: {
      kind: "tab",
      tab: {
        id: sessionId,
        isActive: sessionId === highlightedSessionId,
      },
    },
    shellKeys: [chatWorkspaceShellTabKey(sessionId)],
  })) as unknown as HeaderWorkspaceShellStripRow[];
  const closeActiveWorkspaceTab = useCloseActiveWorkspaceTab({
    workspaceUiKey: WORKSPACE_ID,
    materializedWorkspaceId: WORKSPACE_ID,
    selectedWorkspaceId: WORKSPACE_ID,
    visibleChatSessionIds: visibleIds,
    liveChatSessionIds: [...SESSION_IDS],
    childToParent: new Map(),
    shellRows,
    orderedTabs,
    activeShellTab,
    activeShellTabKey: activation.highlightedTabKey,
  });

  useWorkspaceContentShortcuts({
    activateRelativeTab: () => false,
    activateTabByShortcutIndex: () => false,
    closeActiveWorkspaceTab,
    openNewSessionTab: () => false,
    restoreLastDismissedTab: () => false,
  });

  return {
    activation,
    activeSessionId,
    pending: pending as PendingChatActivation | null,
    visibleIds,
  };
}

describe("useCloseActiveWorkspaceTab", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    clearShortcutHandlerRegistryForTests();
    hookMocks.scheduledCallbacks = [];
    useSessionSelectionStore.getState().clearSelection();
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
      shellActivationEpochByWorkspace: {},
      pendingChatActivationByWorkspace: {},
      urgentHighlightedChatSessionByWorkspace: {},
      archivingChatSessionIdsByWorkspace: {},
    });
    useSessionSelectionStore.getState().activateWorkspace({
      logicalWorkspaceId: WORKSPACE_ID,
      workspaceId: WORKSPACE_ID,
      initialActiveSessionId: "session-c",
    });
    for (const sessionId of SESSION_IDS) {
      putSessionRecord(createEmptySessionRecord(sessionId, "codex", {
        workspaceId: WORKSPACE_ID,
      }));
    }
    const workspaceUi = useWorkspaceUiStore.getState();
    workspaceUi.setVisibleChatSessionIdsForWorkspace(WORKSPACE_ID, [...SESSION_IDS]);
    workspaceUi.setActiveShellTabKeyForWorkspace(
      WORKSPACE_ID,
      chatWorkspaceShellTabKey("session-c"),
    );
    hookMocks.selectSession.mockImplementation(async (sessionId: string, options: any) =>
      commitActiveSession(sessionId, options.guard)
    );
  });

  afterEach(() => {
    cleanup();
    clearShortcutHandlerRegistryForTests();
    vi.useRealTimers();
  });

  it("keeps repeated close shortcuts anchored to a visible session", async () => {
    const rendered = renderHook(() => useRepeatedCloseHarness());

    act(() => {
      expect(runShortcutHandler("workspace.close-active-tab", { source: "menu" }))
        .toBe(true);
    });
    expect(rendered.result.current.visibleIds).toEqual(["session-a", "session-b"]);
    expect(rendered.result.current.activeSessionId).toBe("session-c");
    expect(rendered.result.current.pending?.sessionId).toBe("session-b");

    act(() => {
      expect(runShortcutHandler("workspace.close-active-tab", { source: "menu" }))
        .toBe(true);
    });
    expect(rendered.result.current.visibleIds).toEqual(["session-a"]);
    expect(rendered.result.current.pending?.sessionId).toBe("session-a");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
      hookMocks.scheduledCallbacks.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.result.current.pending).toBeNull();
    expect(rendered.result.current.activeSessionId).toBe("session-a");
    expect(rendered.result.current.visibleIds).toContain(
      rendered.result.current.activeSessionId,
    );
    expect(rendered.result.current.activation).toEqual({
      renderSurface: { kind: "chat-session", sessionId: "session-a" },
      highlightedTabKey: "chat:session-a",
    });
  });
});
