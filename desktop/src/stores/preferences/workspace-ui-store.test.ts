import { afterEach, describe, expect, it, vi } from "vitest";
import {
  migrateWorkspaceUiState,
  WORKSPACE_UI_DEFAULTS,
  useWorkspaceUiStore,
} from "./workspace-ui-store";
import { createManualChatGroupId } from "@/lib/domain/workspaces/tabs/manual-groups";
import { fileWorkspaceShellTabKey } from "@/lib/domain/workspaces/tabs/shell-tabs";

afterEach(() => {
  vi.useRealTimers();
});

describe("workspace ui tab persistence", () => {
  it("migrates archived workspaces from v7 preference blobs", () => {
    const { state, didMigrate } = migrateWorkspaceUiState({
      ...WORKSPACE_UI_DEFAULTS,
      migrationVersion: 7,
      archivedWorkspaceIds: ["workspace-a"],
    });

    expect(didMigrate).toBe(true);
    expect(state.migrationVersion).toBe(9);
    expect(state.archivedWorkspaceIds).toEqual(["workspace-a"]);
  });

  it("defaults missing visible tab fields during migration", () => {
    const { state, didMigrate } = migrateWorkspaceUiState({
      ...WORKSPACE_UI_DEFAULTS,
      migrationVersion: 7,
      visibleChatSessionIdsByWorkspace: undefined as unknown as Record<string, string[]>,
      recentlyHiddenChatSessionIdsByWorkspace: undefined as unknown as Record<string, string[]>,
      collapsedChatGroupsByWorkspace: undefined as unknown as Record<string, string[]>,
      manualChatGroupsByWorkspace: undefined as unknown as Record<string, never[]>,
    });

    expect(didMigrate).toBe(true);
    expect(state.migrationVersion).toBe(9);
    expect(state.visibleChatSessionIdsByWorkspace).toEqual({});
    expect(state.recentlyHiddenChatSessionIdsByWorkspace).toEqual({});
    expect(state.collapsedChatGroupsByWorkspace).toEqual({});
    expect(state.manualChatGroupsByWorkspace).toEqual({});
  });

  it("defaults and sanitizes persisted archived visibility", () => {
    const missingState = {
      ...WORKSPACE_UI_DEFAULTS,
      migrationVersion: 8,
    } as Partial<typeof WORKSPACE_UI_DEFAULTS> & { migrationVersion: number };
    delete missingState.showArchived;

    const missing = migrateWorkspaceUiState(
      missingState as typeof WORKSPACE_UI_DEFAULTS,
    );
    const invalid = migrateWorkspaceUiState({
      ...WORKSPACE_UI_DEFAULTS,
      migrationVersion: 8,
      showArchived: "yes" as never,
    });

    expect(missing.didMigrate).toBe(true);
    expect(missing.state.showArchived).toBe(false);
    expect(invalid.didMigrate).toBe(true);
    expect(invalid.state.showArchived).toBe(false);
  });

  it("defaults missing session error views during migration", () => {
    const legacyState = {
      ...WORKSPACE_UI_DEFAULTS,
      migrationVersion: 7,
    } as Partial<typeof WORKSPACE_UI_DEFAULTS> & { migrationVersion: number };
    delete legacyState.lastViewedSessionErrorAtBySession;

    const { state, didMigrate } = migrateWorkspaceUiState(
      legacyState as typeof WORKSPACE_UI_DEFAULTS,
    );

    expect(didMigrate).toBe(true);
    expect(state.migrationVersion).toBe(9);
    expect(state.lastViewedSessionErrorAtBySession).toEqual({});
  });

  it("sanitizes malformed manual chat groups during migration", () => {
    const { state, didMigrate } = migrateWorkspaceUiState({
      ...WORKSPACE_UI_DEFAULTS,
      migrationVersion: 7,
      manualChatGroupsByWorkspace: {
        w1: [
          {
            id: createManualChatGroupId("group-a"),
            label: "Group A",
            colorId: "magenta",
            sessionIds: ["a", "a", "b"],
          },
          {
            id: "bad",
            label: "Bad",
            colorId: "blue",
            sessionIds: ["a", "b"],
          } as never,
        ],
      },
    });

    expect(didMigrate).toBe(true);
    expect(state.migrationVersion).toBe(9);
    expect(state.manualChatGroupsByWorkspace).toEqual({
      w1: [
        {
          id: createManualChatGroupId("group-a"),
          label: "Group A",
          colorId: "magenta",
          sessionIds: ["a", "b"],
        },
      ],
    });
  });

  it("drops transient projected chat session ids from persisted workspace UI state", () => {
    const transientSessionId = "client-session:codex:1000:abc123";
    const legacyPendingSessionId = "pending-session:codex:1:abc123";
    const materializedSessionId = "session-real";
    const { state, didMigrate } = migrateWorkspaceUiState({
      ...WORKSPACE_UI_DEFAULTS,
      migrationVersion: 8,
      activeShellTabKeyByWorkspace: {
        w1: `chat:${transientSessionId}`,
        w2: `chat:${materializedSessionId}`,
        w3: "chat-shell",
      },
      lastViewedSessionByWorkspace: {
        w1: transientSessionId,
        w2: materializedSessionId,
        w3: legacyPendingSessionId,
      },
      shellTabOrderByWorkspace: {
        w1: [
          `chat:${transientSessionId}`,
          `chat:${materializedSessionId}`,
          fileWorkspaceShellTabKey("src/App.tsx"),
        ],
      },
      visibleChatSessionIdsByWorkspace: {
        w1: [transientSessionId, materializedSessionId, materializedSessionId],
      },
      recentlyHiddenChatSessionIdsByWorkspace: {
        w1: [legacyPendingSessionId, materializedSessionId],
      },
      collapsedChatGroupsByWorkspace: {
        w1: [transientSessionId, materializedSessionId],
      },
      manualChatGroupsByWorkspace: {
        w1: [
          {
            id: createManualChatGroupId("group-a"),
            label: "Group A",
            colorId: "magenta",
            sessionIds: [transientSessionId, materializedSessionId],
          },
          {
            id: createManualChatGroupId("group-b"),
            label: "Group B",
            colorId: "blue",
            sessionIds: [legacyPendingSessionId],
          },
        ],
      },
    });

    expect(didMigrate).toBe(true);
    expect(state.migrationVersion).toBe(9);
    expect(state.activeShellTabKeyByWorkspace).toEqual({
      w2: `chat:${materializedSessionId}`,
      w3: "chat-shell",
    });
    expect(state.lastViewedSessionByWorkspace).toEqual({
      w2: materializedSessionId,
    });
    expect(state.shellTabOrderByWorkspace.w1).toEqual([
      `chat:${materializedSessionId}`,
      fileWorkspaceShellTabKey("src/App.tsx"),
    ]);
    expect(state.visibleChatSessionIdsByWorkspace.w1).toEqual([materializedSessionId]);
    expect(state.recentlyHiddenChatSessionIdsByWorkspace.w1).toEqual([materializedSessionId]);
    expect(state.collapsedChatGroupsByWorkspace.w1).toEqual([materializedSessionId]);
    expect(state.manualChatGroupsByWorkspace.w1).toEqual([
      {
        id: createManualChatGroupId("group-a"),
        label: "Group A",
        colorId: "magenta",
        sessionIds: [materializedSessionId],
      },
    ]);
  });

  it("migrates missing right panel preferences from v3 state", () => {
    const { state, didMigrate } = migrateWorkspaceUiState({
      ...WORKSPACE_UI_DEFAULTS,
      migrationVersion: 3,
      rightPanelDurableByWorkspace: undefined as unknown as typeof WORKSPACE_UI_DEFAULTS.rightPanelDurableByWorkspace,
      rightPanelMaterializedByWorkspace: undefined as unknown as typeof WORKSPACE_UI_DEFAULTS.rightPanelMaterializedByWorkspace,
    });

    expect(didMigrate).toBe(true);
    expect(state.migrationVersion).toBe(9);
    expect(state.rightPanelDurableByWorkspace).toEqual({});
    expect(state.rightPanelMaterializedByWorkspace).toEqual({});
  });

  it("sanitizes persisted right panel preferences and clamps widths", () => {
    const { state, didMigrate } = migrateWorkspaceUiState({
      ...WORKSPACE_UI_DEFAULTS,
      migrationVersion: 6,
      rightPanelByWorkspace: {
        w1: {
          activeTool: "git",
          toolOrder: ["terminal", "bad", "terminal", "files"],
          terminalOrder: ["t1", "t1", "t2"],
          activeTerminalId: "t2",
        },
        w2: "bad",
      } as never,
      rightPanelWidthByWorkspace: {
        w1: 900,
        w2: Number.NaN,
      },
    } as never);

    expect(didMigrate).toBe(true);
    expect(state.rightPanelDurableByWorkspace).toEqual({
      w1: {
        open: false,
        width: 700,
      },
    });
    expect(state.rightPanelMaterializedByWorkspace).toEqual({
      w1: {
        activeEntryKey: "tool:git",
        headerOrder: ["tool:files", "tool:git", "tool:settings", "terminal:t1", "terminal:t2"],
        browserTabsById: {},
      },
    });
  });

  it("migrates legacy right panel preferences from current mainline v6 state", () => {
    const { state, didMigrate } = migrateWorkspaceUiState({
      ...WORKSPACE_UI_DEFAULTS,
      migrationVersion: 6,
      rightPanelByWorkspace: {
        w1: {
          activeTool: "terminal",
          toolOrder: ["git", "files"],
          terminalOrder: ["terminal-a", "terminal-b"],
          headerOrder: ["tool:git", "terminal:terminal-b", "tool:files", "terminal:terminal-a"],
          activeTerminalId: "terminal-b",
        },
      },
      rightPanelWidthByWorkspace: {
        w1: 512,
      },
    } as never);

    expect(didMigrate).toBe(true);
    expect(state.migrationVersion).toBe(9);
    expect(state.rightPanelDurableByWorkspace.w1).toEqual({
      open: false,
      width: 512,
    });
    expect(state.rightPanelMaterializedByWorkspace.w1).toEqual({
      activeEntryKey: "terminal:terminal-b",
      headerOrder: ["tool:git", "terminal:terminal-b", "tool:files", "terminal:terminal-a", "tool:settings"],
      browserTabsById: {},
    });
  });

  it("preserves valid v7 active entry keys and drops legacy right panel fields", () => {
    const { state, didMigrate } = migrateWorkspaceUiState({
      ...WORKSPACE_UI_DEFAULTS,
      migrationVersion: 7,
      rightPanelDurableByWorkspace: {
        w1: {
          open: true,
          width: 420,
          toolOrder: ["files"],
        } as never,
      },
      rightPanelMaterializedByWorkspace: {
        w1: {
          activeEntryKey: "terminal:t1",
          headerOrder: ["terminal:t1", "tool:git"],
          terminalOrder: ["t1"],
          activeTerminalId: "t1",
        } as never,
      },
    });

    expect(didMigrate).toBe(true);
    expect(state.rightPanelDurableByWorkspace.w1).toEqual({
      open: true,
      width: 420,
    });
    expect(state.rightPanelMaterializedByWorkspace.w1).toEqual({
      activeEntryKey: "terminal:t1",
      headerOrder: ["terminal:t1", "tool:git", "tool:files", "tool:settings"],
      browserTabsById: {},
    });
    expect(state.rightPanelDurableByWorkspace.w1).not.toHaveProperty("toolOrder");
    expect(state.rightPanelMaterializedByWorkspace.w1).not.toHaveProperty("terminalOrder");
    expect(state.rightPanelMaterializedByWorkspace.w1).not.toHaveProperty("activeTerminalId");
  });

  it("stores visible and hidden chat ids per workspace", () => {
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
    });

    const store = useWorkspaceUiStore.getState();
    store.setVisibleChatSessionIdsForWorkspace("w1", ["a", "a", "b"]);
    store.rememberHiddenChatSessionForWorkspace("w1", "c");
    store.rememberHiddenChatSessionForWorkspace("w1", "b");
    store.clearHiddenChatSessionsForWorkspace("w1", ["c"]);

    expect(useWorkspaceUiStore.getState().visibleChatSessionIdsByWorkspace.w1).toEqual(["a", "b"]);
    expect(useWorkspaceUiStore.getState().recentlyHiddenChatSessionIdsByWorkspace.w1).toEqual(["b"]);
  });

  it("marks workspace viewed at exact monotonic timestamps", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-04T00:00:30.000Z"));
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
      lastViewedAt: {
        w1: "2026-04-04T00:00:10.000Z",
      },
    });

    const store = useWorkspaceUiStore.getState();
    store.markWorkspaceViewedAt("w1", "2026-04-04T00:00:09.000Z");
    expect(useWorkspaceUiStore.getState().lastViewedAt.w1)
      .toBe("2026-04-04T00:00:10.000Z");

    store.markWorkspaceViewedAt("w1", "2026-04-04T00:00:10.000Z");
    expect(useWorkspaceUiStore.getState().lastViewedAt.w1)
      .toBe("2026-04-04T00:00:10.000Z");

    store.markWorkspaceViewedAt("w1", "2026-04-04T00:00:11.000Z");
    expect(useWorkspaceUiStore.getState().lastViewedAt.w1)
      .toBe("2026-04-04T00:00:11.000Z");

    store.markWorkspaceViewed("w2");
    expect(useWorkspaceUiStore.getState().lastViewedAt.w2)
      .toBe("2026-04-04T00:00:30.000Z");
  });

  it("stores archived workspace visibility", () => {
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
    });

    useWorkspaceUiStore.getState().setShowArchived(true);

    expect(useWorkspaceUiStore.getState().showArchived).toBe(true);
  });

  it("stores right panel preferences per workspace", () => {
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
    });

    const store = useWorkspaceUiStore.getState();
    store.setRightPanelForWorkspace("w1", {
      activeEntryKey: "terminal:t1",
      headerOrder: ["tool:files", "tool:git", "terminal:t1"],
      browserTabsById: {},
    });
    store.setRightPanelWidthForWorkspace("w1", 900);

    expect(useWorkspaceUiStore.getState().rightPanelMaterializedByWorkspace.w1?.activeEntryKey)
      .toBe("terminal:t1");
    expect(useWorkspaceUiStore.getState().rightPanelDurableByWorkspace.w1?.width).toBe(700);
  });

  it("stores shell tab state without notifying on unchanged writes", () => {
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
      shellActivationEpochByWorkspace: {},
      pendingChatActivationByWorkspace: {},
    });

    const store = useWorkspaceUiStore.getState();
    store.setActiveShellTabKeyForWorkspace("w1", "chat:s1");
    store.setShellTabOrderForWorkspace("w1", ["chat:s1", "file:src/App.tsx"]);
    store.setShellTabOrderForWorkspace("w2", []);

    expect(useWorkspaceUiStore.getState().activeShellTabKeyByWorkspace.w1).toBe("chat:s1");
    expect(useWorkspaceUiStore.getState().shellTabOrderByWorkspace.w1)
      .toEqual(["chat:s1", "file:src/App.tsx"]);
    expect(useWorkspaceUiStore.getState().shellTabOrderByWorkspace.w2).toEqual([]);
  });

  it("keeps chat-shell out of real tab order while accepting it as active intent", () => {
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
      shellActivationEpochByWorkspace: {},
      pendingChatActivationByWorkspace: {},
    });

    const store = useWorkspaceUiStore.getState();
    store.writeShellIntent({
      workspaceId: "w1",
      intent: "chat-shell",
    });
    store.setShellTabOrderForWorkspace("w1", ["chat:s1"]);

    expect(useWorkspaceUiStore.getState().activeShellTabKeyByWorkspace.w1).toBe("chat-shell");
    expect(useWorkspaceUiStore.getState().shellTabOrderByWorkspace.w1)
      .toEqual(["chat:s1"]);
  });

  it("does not roll back a shell intent after another activation replaced it", () => {
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
      shellActivationEpochByWorkspace: {},
      pendingChatActivationByWorkspace: {},
    });

    const first = useWorkspaceUiStore.getState().writeShellIntent({
      workspaceId: "w1",
      intent: "chat:s1",
    });
    useWorkspaceUiStore.getState().writeShellIntent({
      workspaceId: "w1",
      intent: "file:src/App.tsx",
    });

    const rollback = useWorkspaceUiStore.getState().rollbackShellIntent({
      workspaceId: "w1",
      expectedIntent: "chat:s1",
      expectedEpoch: first.epoch,
      rollbackIntent: null,
    });

    expect(rollback.rolledBack).toBe(false);
    expect(useWorkspaceUiStore.getState().activeShellTabKeyByWorkspace.w1)
      .toBe("file:src/App.tsx");
  });

  it("does not replace a pending shell intent after another activation replaced it", () => {
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
      shellActivationEpochByWorkspace: {},
      pendingChatActivationByWorkspace: {},
    });

    const pending = useWorkspaceUiStore.getState().writeShellIntent({
      workspaceId: "w1",
      intent: "chat:pending-1",
    });
    useWorkspaceUiStore.getState().writeShellIntent({
      workspaceId: "w1",
      intent: "file:src/App.tsx",
    });

    const replace = useWorkspaceUiStore.getState().replaceShellIntent({
      workspaceId: "w1",
      expectedIntent: "chat:pending-1",
      expectedEpoch: pending.epoch,
      nextIntent: "chat:real-1",
    });

    expect(replace.replaced).toBe(false);
    expect(useWorkspaceUiStore.getState().activeShellTabKeyByWorkspace.w1)
      .toBe("file:src/App.tsx");
  });

  it("does not roll back a same-intent activation after pending ownership changed", () => {
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
      shellActivationEpochByWorkspace: {},
      pendingChatActivationByWorkspace: {},
    });

    const store = useWorkspaceUiStore.getState();
    store.writeShellIntent({ workspaceId: "w1", intent: "chat:s1" });
    const firstWrite = store.writeShellIntent({
      workspaceId: "w1",
      intent: "chat:s2",
    });
    store.setPendingChatActivation({
      workspaceId: "w1",
      pending: {
        attemptId: "attempt-1",
        sessionId: "s2",
        intent: "chat:s2",
        guardToken: 1,
        workspaceSelectionNonce: 1,
        shellEpochAtWrite: firstWrite.epoch,
        sessionActivationEpochAtWrite: 1,
      },
    });

    const secondWrite = store.writeShellIntent({
      workspaceId: "w1",
      intent: "chat:s2",
    });
    store.setPendingChatActivation({
      workspaceId: "w1",
      pending: {
        attemptId: "attempt-2",
        sessionId: "s2",
        intent: "chat:s2",
        guardToken: 2,
        workspaceSelectionNonce: 1,
        shellEpochAtWrite: secondWrite.epoch,
        sessionActivationEpochAtWrite: 2,
      },
    });

    const rollback = store.rollbackShellIntent({
      workspaceId: "w1",
      expectedIntent: "chat:s2",
      expectedEpoch: firstWrite.epoch,
      expectedPendingAttemptId: "attempt-1",
      rollbackIntent: "chat:s1",
    });

    expect(rollback.rolledBack).toBe(false);
    expect(useWorkspaceUiStore.getState().activeShellTabKeyByWorkspace.w1)
      .toBe("chat:s2");
    expect(useWorkspaceUiStore.getState().pendingChatActivationByWorkspace.w1?.attemptId)
      .toBe("attempt-2");
  });

  it("stores and clears viewed session error keys without eviction", () => {
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
    });

    const store = useWorkspaceUiStore.getState();
    store.markSessionErrorViewed("s1", "error-item:one");
    store.markSessionErrorViewed("s1", "error-item:one");
    for (let index = 0; index < 50; index += 1) {
      store.markSessionErrorViewed(`s${index + 2}`, `error-item:${index + 2}`);
    }
    store.clearViewedSessionErrors(["s2", "missing"]);

    expect(useWorkspaceUiStore.getState().lastViewedSessionErrorAtBySession.s1)
      .toBe("error-item:one");
    expect(useWorkspaceUiStore.getState().lastViewedSessionErrorAtBySession.s2)
      .toBeUndefined();
    expect(Object.keys(useWorkspaceUiStore.getState().lastViewedSessionErrorAtBySession))
      .toHaveLength(50);
  });

  it("stores and clears finish suggestion dismissals", () => {
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
    });

    const store = useWorkspaceUiStore.getState();
    store.dismissFinishSuggestion("w1", "fingerprint-1");
    expect(
      useWorkspaceUiStore.getState().finishSuggestionDismissalsByWorkspaceId.w1,
    ).toBe("fingerprint-1");

    store.clearFinishSuggestionDismissal("w1");
    expect(
      useWorkspaceUiStore.getState().finishSuggestionDismissalsByWorkspaceId.w1,
    ).toBeUndefined();
  });

  it("toggles collapsed chat groups per workspace", () => {
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
    });

    const store = useWorkspaceUiStore.getState();
    store.toggleChatGroupCollapsedForWorkspace("w1", "parent-a");
    store.toggleChatGroupCollapsedForWorkspace("w1", "parent-b");
    store.toggleChatGroupCollapsedForWorkspace("w1", "parent-a");

    expect(useWorkspaceUiStore.getState().collapsedChatGroupsByWorkspace.w1).toEqual(["parent-b"]);
  });

  it("stores and removes manual chat groups per workspace", () => {
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
    });

    const store = useWorkspaceUiStore.getState();
    const firstGroup = {
      id: createManualChatGroupId("group-a"),
      label: "Group A",
      colorId: "blue" as const,
      sessionIds: ["a", "b"],
    };
    const secondGroup = {
      id: createManualChatGroupId("group-b"),
      label: "Group B",
      colorId: "yellow" as const,
      sessionIds: ["b", "c"],
    };

    store.upsertManualChatGroupForWorkspace("w1", firstGroup);
    store.upsertManualChatGroupForWorkspace("w1", secondGroup);
    store.updateManualChatGroupForWorkspace("w1", secondGroup.id, {
      label: "Renamed",
    });
    store.removeSessionsFromManualChatGroupsForWorkspace("w1", ["c"]);

    expect(useWorkspaceUiStore.getState().manualChatGroupsByWorkspace.w1).toBeUndefined();
  });

  it("clears chat tab state including collapsed and manual groups", () => {
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
      visibleChatSessionIdsByWorkspace: { w1: ["a"] },
      recentlyHiddenChatSessionIdsByWorkspace: { w1: ["b"] },
      collapsedChatGroupsByWorkspace: { w1: ["parent-a"] },
      manualChatGroupsByWorkspace: {
        w1: [
          {
            id: createManualChatGroupId("group-a"),
            label: "Group A",
            colorId: "blue",
            sessionIds: ["a", "b"],
          },
        ],
      },
    });

    useWorkspaceUiStore.getState().clearWorkspaceChatTabState("w1");

    expect(useWorkspaceUiStore.getState().visibleChatSessionIdsByWorkspace.w1).toBeUndefined();
    expect(useWorkspaceUiStore.getState().recentlyHiddenChatSessionIdsByWorkspace.w1).toBeUndefined();
    expect(useWorkspaceUiStore.getState().collapsedChatGroupsByWorkspace.w1).toBeUndefined();
    expect(useWorkspaceUiStore.getState().manualChatGroupsByWorkspace.w1).toBeUndefined();
  });
});
