// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useShortcutDispatcher } from "#product/hooks/shortcuts/lifecycle/use-shortcut-dispatcher";
import { useWorkspaceContentShortcuts } from "#product/hooks/workspaces/ui/use-workspace-content-shortcuts";
import {
  cancelPendingDeferredChatActivation,
} from "#product/hooks/workspaces/workflows/tabs/use-chat-tab-activation";
import {
  useWorkspaceTabActions,
  type WorkspaceTabActionsContext,
} from "#product/hooks/workspaces/workflows/tabs/use-workspace-tab-actions";
import { WORKSPACE_UI_DEFAULTS } from "#product/lib/domain/preferences/workspace-ui/model";
import {
  resolveWorkspaceShellActivation,
} from "#product/lib/domain/workspaces/tabs/shell-activation";
import {
  chatWorkspaceShellTabKey,
  getWorkspaceShellTabKey,
  type WorkspaceShellTab,
} from "#product/lib/domain/workspaces/tabs/shell-tabs";
import {
  clearShortcutHandlerRegistryForTests,
} from "#product/lib/domain/shortcuts/registry";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

const WORKSPACE_ID = "workspace-1";
const SESSION_A: WorkspaceShellTab = { kind: "chat", sessionId: "session-a" };
const SESSION_B: WorkspaceShellTab = { kind: "chat", sessionId: "session-b" };

const hookMocks = vi.hoisted(() => ({
  archiveSession: vi.fn(),
  closeActiveTab: vi.fn(() => "noop" as const),
  createEmptySession: vi.fn(),
  restoreSession: vi.fn(),
  selectSession: vi.fn(async () => undefined),
}));

vi.mock("#product/hooks/chat/derived/use-active-session-config-state", () => ({
  useActiveSessionLaunchState: () => ({ currentLaunchIdentity: null }),
}));

vi.mock("#product/hooks/chat/derived/use-configured-launch-readiness", () => ({
  useConfiguredLaunchReadiness: () => ({
    disabledReason: "No launch configuration.",
    launchCatalog: { launchAgents: [] },
    selection: null,
  }),
}));

vi.mock("#product/hooks/sessions/facade/use-session-selection-actions", () => ({
  useSessionSelectionActions: () => ({ selectSession: hookMocks.selectSession }),
}));

vi.mock("#product/hooks/sessions/workflows/use-session-creation-actions", () => ({
  useSessionCreationActions: () => ({
    createEmptySessionWithResolvedConfig: hookMocks.createEmptySession,
  }),
}));

vi.mock("#product/hooks/sessions/workflows/use-session-restore-actions", () => ({
  useSessionRestoreActions: () => ({
    restoreLastDismissedSession: hookMocks.restoreSession,
  }),
}));

vi.mock("#product/hooks/workspaces/derived/use-workspace-runtime-block", () => ({
  useWorkspaceRuntimeBlock: () => ({
    getWorkspaceRuntimeBlockReason: () => null,
  }),
}));

vi.mock("#product/hooks/workspaces/workflows/tabs/use-chat-session-archive-action", () => ({
  useChatSessionArchiveAction: () => hookMocks.archiveSession,
}));

vi.mock("#product/hooks/workspaces/workflows/tabs/use-close-active-workspace-tab", () => ({
  useCloseActiveWorkspaceTab: () => hookMocks.closeActiveTab,
}));

describe("workspace relative-tab keyboard flow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Mac OS X",
    });
    clearShortcutHandlerRegistryForTests();
    vi.clearAllMocks();

    useSessionSelectionStore.getState().clearSelection();
    useSessionSelectionStore.setState({ _hydrated: true });
    useSessionSelectionStore.getState().activateWorkspace({
      logicalWorkspaceId: WORKSPACE_ID,
      workspaceId: WORKSPACE_ID,
      initialActiveSessionId: SESSION_A.sessionId,
    });
    resetWorkspaceUi([SESSION_A], SESSION_A);
  });

  afterEach(() => {
    cancelPendingDeferredChatActivation(WORKSPACE_ID, "intent-replaced");
    cleanup();
    clearShortcutHandlerRegistryForTests();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([
    ["Ctrl+Tab", { shiftKey: false, repeat: false }],
    ["Ctrl+Shift+Tab", { shiftKey: true, repeat: false }],
    ["repeated Ctrl+Tab", { shiftKey: false, repeat: true }],
    ["repeated Ctrl+Shift+Tab", { shiftKey: true, repeat: true }],
  ])("leaves the sole active session unchanged for %s", (_label, init) => {
    const context = createContext({ orderedTabs: [SESSION_A], activeTab: SESSION_A });
    const beforeEpoch = currentSessionActivationEpoch();
    const beforeSurface = currentShellActivation([SESSION_A]);
    render(<ShortcutHarness context={context} />);

    const event = dispatchCtrlTab(init);

    expect(event.defaultPrevented).toBe(false);
    expect(currentPendingActivation()).toBeNull();
    expect(currentSessionActivationEpoch()).toBe(beforeEpoch);
    expect(currentShellActivation([SESSION_A])).toEqual(beforeSurface);
    expect(hookMocks.selectSession).not.toHaveBeenCalled();
  });

  it("does not cycle into a hidden session", () => {
    const context = createContext({
      orderedTabs: [SESSION_A],
      activeTab: SESSION_A,
      liveSessionIds: [SESSION_A.sessionId, SESSION_B.sessionId],
    });
    render(<ShortcutHarness context={context} />);

    const event = dispatchCtrlTab({ shiftKey: false, repeat: false });

    expect(event.defaultPrevented).toBe(false);
    expect(currentPendingActivation()).toBeNull();
    expect(currentShellActivation([SESSION_A]).renderSurface).toEqual({
      kind: "chat-session",
      sessionId: SESSION_A.sessionId,
    });
  });

  it("still activates the sole tab from the chat shell", () => {
    useSessionSelectionStore.getState().setActiveSessionId(null);
    useWorkspaceUiStore.getState().writeShellIntent({
      workspaceId: WORKSPACE_ID,
      intent: "chat-shell",
    });
    const context = createContext({ orderedTabs: [SESSION_A], activeTab: null });
    render(<ShortcutHarness context={context} />);

    const event = dispatchCtrlTab({ shiftKey: false, repeat: false });

    expect(event.defaultPrevented).toBe(true);
    expect(currentPendingActivation()).toMatchObject({
      intent: chatWorkspaceShellTabKey(SESSION_A.sessionId),
      sessionId: SESSION_A.sessionId,
    });
  });

  it.each([
    ["next", false],
    ["previous", true],
  ])("still activates another tab when cycling %s", (_label, shiftKey) => {
    resetWorkspaceUi([SESSION_A, SESSION_B], SESSION_A);
    const context = createContext({
      orderedTabs: [SESSION_A, SESSION_B],
      activeTab: SESSION_A,
    });
    render(<ShortcutHarness context={context} />);

    const event = dispatchCtrlTab({ shiftKey, repeat: false });

    expect(event.defaultPrevented).toBe(true);
    expect(currentPendingActivation()).toMatchObject({
      intent: chatWorkspaceShellTabKey(SESSION_B.sessionId),
      sessionId: SESSION_B.sessionId,
    });
    expect(currentShellActivation([SESSION_A, SESSION_B]).renderSurface).toEqual({
      kind: "chat-session-pending",
      sessionId: SESSION_B.sessionId,
    });
  });
});

function ShortcutHarness({ context }: { context: WorkspaceTabActionsContext }) {
  const actions = useWorkspaceTabActions(context);
  useWorkspaceContentShortcuts(actions);
  useShortcutDispatcher();
  return null;
}

function createContext({
  orderedTabs,
  activeTab,
  liveSessionIds,
}: {
  orderedTabs: WorkspaceShellTab[];
  activeTab: WorkspaceShellTab | null;
  liveSessionIds?: string[];
}): WorkspaceTabActionsContext {
  const visibleSessionIds = orderedTabs.flatMap((tab) =>
    tab.kind === "chat" ? [tab.sessionId] : []
  );
  return {
    workspaceUiKey: WORKSPACE_ID,
    materializedWorkspaceId: WORKSPACE_ID,
    selectedWorkspaceId: WORKSPACE_ID,
    visibleChatSessionIds: visibleSessionIds,
    liveChatSessionIds: liveSessionIds ?? visibleSessionIds,
    childToParent: new Map(),
    shellRows: [],
    orderedTabs,
    activeShellTab: activeTab,
    activeShellTabKey: activeTab ? getWorkspaceShellTabKey(activeTab) : null,
  };
}

function resetWorkspaceUi(
  orderedTabs: WorkspaceShellTab[],
  activeTab: WorkspaceShellTab,
): void {
  const visibleSessionIds = orderedTabs.flatMap((tab) =>
    tab.kind === "chat" ? [tab.sessionId] : []
  );
  useWorkspaceUiStore.setState({
    ...WORKSPACE_UI_DEFAULTS,
    _hydrated: true,
    activeShellTabKeyByWorkspace: {
      [WORKSPACE_ID]: getWorkspaceShellTabKey(activeTab),
    },
    shellTabOrderByWorkspace: {
      [WORKSPACE_ID]: orderedTabs.map(getWorkspaceShellTabKey),
    },
    visibleChatSessionIdsByWorkspace: {
      [WORKSPACE_ID]: visibleSessionIds,
    },
    shellActivationEpochByWorkspace: { [WORKSPACE_ID]: 0 },
    pendingChatActivationByWorkspace: {},
    urgentHighlightedChatSessionByWorkspace: {},
  });
}

function dispatchCtrlTab(init: Pick<KeyboardEventInit, "repeat" | "shiftKey">): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Tab",
    code: "Tab",
    ctrlKey: true,
    shiftKey: init.shiftKey,
    repeat: init.repeat,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

function currentPendingActivation() {
  return useWorkspaceUiStore.getState()
    .pendingChatActivationByWorkspace[WORKSPACE_ID] ?? null;
}

function currentSessionActivationEpoch(): number {
  return useSessionSelectionStore.getState()
    .sessionActivationIntentEpochByWorkspace[WORKSPACE_ID] ?? 0;
}

function currentShellActivation(orderedTabs: WorkspaceShellTab[]) {
  const workspaceUiState = useWorkspaceUiStore.getState();
  const selectionState = useSessionSelectionStore.getState();
  return resolveWorkspaceShellActivation({
    workspaceId: WORKSPACE_ID,
    storedIntent: workspaceUiState.activeShellTabKeyByWorkspace[WORKSPACE_ID] ?? null,
    orderedTabs: orderedTabs.map(getWorkspaceShellTabKey),
    activeSessionId: selectionState.activeSessionId,
    activeViewerTargetKey: null,
    liveChatSessionIds: new Set(
      orderedTabs.flatMap((tab) => tab.kind === "chat" ? [tab.sessionId] : []),
    ),
    openViewerTargetKeys: new Set(),
    pendingChatActivation: currentPendingActivation(),
    currentShellActivationEpoch:
      workspaceUiState.shellActivationEpochByWorkspace[WORKSPACE_ID] ?? 0,
    currentSessionActivationEpoch: currentSessionActivationEpoch(),
    currentWorkspaceSelectionNonce: selectionState.workspaceSelectionNonce,
  });
}
