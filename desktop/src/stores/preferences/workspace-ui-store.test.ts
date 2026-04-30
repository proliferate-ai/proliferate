import { describe, expect, it } from "vitest";
import {
  migrateWorkspaceUiState,
  WORKSPACE_UI_DEFAULTS,
  useWorkspaceUiStore,
} from "./workspace-ui-store";
import { createManualChatGroupId } from "@/lib/domain/workspaces/tabs/manual-groups";

describe("workspace ui tab persistence", () => {
  it("preserves archived workspaces for current v3 preference blobs", () => {
    const { state, didMigrate } = migrateWorkspaceUiState({
      ...WORKSPACE_UI_DEFAULTS,
      migrationVersion: 3,
      archivedWorkspaceIds: ["workspace-a"],
    });

    expect(didMigrate).toBe(false);
    expect(state.archivedWorkspaceIds).toEqual(["workspace-a"]);
  });

  it("defaults missing visible tab fields without bumping migration", () => {
    const { state, didMigrate } = migrateWorkspaceUiState({
      ...WORKSPACE_UI_DEFAULTS,
      migrationVersion: 3,
      visibleChatSessionIdsByWorkspace: undefined as unknown as Record<string, string[]>,
      recentlyHiddenChatSessionIdsByWorkspace: undefined as unknown as Record<string, string[]>,
      collapsedChatGroupsByWorkspace: undefined as unknown as Record<string, string[]>,
      manualChatGroupsByWorkspace: undefined as unknown as Record<string, never[]>,
    });

    expect(didMigrate).toBe(true);
    expect(state.migrationVersion).toBe(3);
    expect(state.visibleChatSessionIdsByWorkspace).toEqual({});
    expect(state.recentlyHiddenChatSessionIdsByWorkspace).toEqual({});
    expect(state.collapsedChatGroupsByWorkspace).toEqual({});
    expect(state.manualChatGroupsByWorkspace).toEqual({});
  });

  it("sanitizes malformed manual chat groups without bumping migration", () => {
    const { state, didMigrate } = migrateWorkspaceUiState({
      ...WORKSPACE_UI_DEFAULTS,
      migrationVersion: 3,
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
    expect(state.migrationVersion).toBe(3);
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
