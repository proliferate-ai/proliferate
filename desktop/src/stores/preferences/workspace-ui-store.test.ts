import { describe, expect, it } from "vitest";
import {
  migrateWorkspaceUiState,
  WORKSPACE_UI_DEFAULTS,
  useWorkspaceUiStore,
} from "./workspace-ui-store";
import { createManualChatGroupId } from "@/lib/domain/workspaces/tabs/manual-groups";

describe("workspace ui tab persistence", () => {
  it("preserves archived workspaces for current v6 preference blobs", () => {
    const { state, didMigrate } = migrateWorkspaceUiState({
      ...WORKSPACE_UI_DEFAULTS,
      migrationVersion: 6,
      archivedWorkspaceIds: ["workspace-a"],
    });

    expect(didMigrate).toBe(false);
    expect(state.archivedWorkspaceIds).toEqual(["workspace-a"]);
  });

  it("defaults missing visible tab fields without bumping migration", () => {
    const { state, didMigrate } = migrateWorkspaceUiState({
      ...WORKSPACE_UI_DEFAULTS,
      migrationVersion: 6,
      visibleChatSessionIdsByWorkspace: undefined as unknown as Record<string, string[]>,
      recentlyHiddenChatSessionIdsByWorkspace: undefined as unknown as Record<string, string[]>,
      collapsedChatGroupsByWorkspace: undefined as unknown as Record<string, string[]>,
      manualChatGroupsByWorkspace: undefined as unknown as Record<string, never[]>,
    });

    expect(didMigrate).toBe(true);
    expect(state.migrationVersion).toBe(6);
    expect(state.visibleChatSessionIdsByWorkspace).toEqual({});
    expect(state.recentlyHiddenChatSessionIdsByWorkspace).toEqual({});
    expect(state.collapsedChatGroupsByWorkspace).toEqual({});
    expect(state.manualChatGroupsByWorkspace).toEqual({});
  });

  it("defaults missing session error views without bumping migration", () => {
    const legacyState = {
      ...WORKSPACE_UI_DEFAULTS,
      migrationVersion: 6,
    } as Partial<typeof WORKSPACE_UI_DEFAULTS> & { migrationVersion: number };
    delete legacyState.lastViewedSessionErrorAtBySession;

    const { state, didMigrate } = migrateWorkspaceUiState(
      legacyState as typeof WORKSPACE_UI_DEFAULTS,
    );

    expect(didMigrate).toBe(false);
    expect(state.migrationVersion).toBe(6);
    expect(state.lastViewedSessionErrorAtBySession).toEqual({});
  });

  it("sanitizes malformed manual chat groups without bumping migration", () => {
    const { state, didMigrate } = migrateWorkspaceUiState({
      ...WORKSPACE_UI_DEFAULTS,
      migrationVersion: 6,
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
    expect(state.migrationVersion).toBe(6);
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

  it("migrates missing right panel preferences from v3 state", () => {
    const { state, didMigrate } = migrateWorkspaceUiState({
      ...WORKSPACE_UI_DEFAULTS,
      migrationVersion: 3,
      rightPanelByWorkspace: undefined as unknown as typeof WORKSPACE_UI_DEFAULTS.rightPanelByWorkspace,
      rightPanelWidthByWorkspace: undefined as unknown as typeof WORKSPACE_UI_DEFAULTS.rightPanelWidthByWorkspace,
    });

    expect(didMigrate).toBe(true);
    expect(state.migrationVersion).toBe(6);
    expect(state.rightPanelByWorkspace).toEqual({});
    expect(state.rightPanelWidthByWorkspace).toEqual({});
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
    });

    expect(didMigrate).toBe(true);
    expect(state.rightPanelByWorkspace).toEqual({
      w1: {
        activeTool: "git",
        toolOrder: ["files", "git", "settings"],
        terminalOrder: ["t1", "t2"],
        headerOrder: ["tool:files", "tool:git", "tool:settings", "terminal:t1", "terminal:t2"],
        activeTerminalId: "t2",
      },
    });
    expect(state.rightPanelWidthByWorkspace).toEqual({ w1: 700 });
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

  it("stores right panel preferences per workspace", () => {
    useWorkspaceUiStore.setState({
      ...WORKSPACE_UI_DEFAULTS,
      _hydrated: true,
    });

    const store = useWorkspaceUiStore.getState();
    store.setRightPanelForWorkspace("w1", {
      activeTool: "terminal",
      toolOrder: ["files", "git"],
      terminalOrder: ["t1"],
      headerOrder: ["tool:files", "tool:git", "terminal:t1"],
      activeTerminalId: "t1",
    });
    store.setRightPanelWidthForWorkspace("w1", 900);

    expect(useWorkspaceUiStore.getState().rightPanelByWorkspace.w1?.activeTool).toBe("terminal");
    expect(useWorkspaceUiStore.getState().rightPanelWidthByWorkspace.w1).toBe(700);
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
