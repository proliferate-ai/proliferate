import { describe, expect, it } from "vitest";
import { migrateWorkspaceUiState } from "@/lib/domain/preferences/workspace-ui/migration";
import {
  WORKSPACE_UI_DEFAULTS,
  WORKSPACE_UI_MIGRATION_VERSION,
  type PersistedWorkspaceUiState,
} from "@/lib/domain/preferences/workspace-ui/model";
import { WORKSPACE_SIDEBAR_MAX_WIDTH } from "@/lib/domain/preferences/workspace-ui/sidebar";
import { createManualChatGroupId } from "@/lib/domain/workspaces/tabs/manual-groups";
import {
  chatShellWorkspaceIntentKey,
  chatWorkspaceShellTabKey,
  fileWorkspaceShellTabKey,
} from "@/lib/domain/workspaces/tabs/shell-tabs";

describe("workspace UI state migration", () => {
  it("applies migration defaults and resets pre-identity-cutover persisted state", () => {
    const result = migrateWorkspaceUiState({
      ...WORKSPACE_UI_DEFAULTS,
      migrationVersion: 1,
      archivedWorkspaceIds: ["archived-workspace"],
      lastViewedAt: { "workspace-1": "2026-04-04T00:00:00Z" },
      lastViewedSessionByWorkspace: { "workspace-1": "session-1" },
      workspaceLastInteracted: { "workspace-1": "2026-04-04T00:00:00Z" },
      collapsedRepoGroups: {
        "repo-a": true,
        "repo-b": false,
      } as unknown as string[],
      sidebarOpen: "open" as unknown as boolean,
      showArchived: "yes" as unknown as boolean,
      sidebarWidth: 999,
    });

    expect(result.didMigrate).toBe(true);
    expect(result.state.migrationVersion).toBe(WORKSPACE_UI_MIGRATION_VERSION);
    expect(result.state.archivedWorkspaceIds).toEqual([]);
    expect(result.state.lastViewedAt).toEqual({});
    expect(result.state.lastViewedSessionByWorkspace).toEqual({});
    expect(result.state.workspaceLastInteracted).toEqual({});
    expect(result.state.collapsedRepoGroups).toEqual(["repo-a"]);
    expect(result.state.sidebarOpen).toBe(false);
    expect(result.state.showArchived).toBe(false);
    expect(result.state.sidebarWidth).toBe(WORKSPACE_SIDEBAR_MAX_WIDTH);
  });

  it("migrates archived workspaces from v7 preference blobs", () => {
    const { state, didMigrate } = migrateWorkspaceUiState({
      ...WORKSPACE_UI_DEFAULTS,
      migrationVersion: 7,
      archivedWorkspaceIds: ["workspace-a"],
    });

    expect(didMigrate).toBe(true);
    expect(state.migrationVersion).toBe(WORKSPACE_UI_MIGRATION_VERSION);
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
    expect(state.migrationVersion).toBe(WORKSPACE_UI_MIGRATION_VERSION);
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
    expect(state.migrationVersion).toBe(WORKSPACE_UI_MIGRATION_VERSION);
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
    expect(state.migrationVersion).toBe(WORKSPACE_UI_MIGRATION_VERSION);
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
    expect(state.migrationVersion).toBe(WORKSPACE_UI_MIGRATION_VERSION);
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

  it("normalizes durable shell tab intent and order without transient chat sessions", () => {
    const stableChatKey = chatWorkspaceShellTabKey("session-1");
    const transientChatKey = chatWorkspaceShellTabKey("client-session:tmp");
    const pendingChatKey = chatWorkspaceShellTabKey("pending-session:tmp");
    const fileKey = fileWorkspaceShellTabKey("src/App.tsx");
    const chatShellKey = chatShellWorkspaceIntentKey();

    const result = migrateWorkspaceUiState({
      ...WORKSPACE_UI_DEFAULTS,
      migrationVersion: WORKSPACE_UI_MIGRATION_VERSION,
      activeShellTabKeyByWorkspace: {
        "workspace-chat": stableChatKey,
        "workspace-transient": transientChatKey,
        "workspace-shell": chatShellKey,
        "workspace-file": fileKey,
        "workspace-invalid": "not-a-tab",
      },
      shellTabOrderByWorkspace: {
        "workspace-1": [
          transientChatKey,
          stableChatKey,
          fileKey,
          fileKey,
          "not-a-tab",
          pendingChatKey,
        ],
      },
    } as PersistedWorkspaceUiState);

    expect(result.didMigrate).toBe(true);
    expect(result.state.activeShellTabKeyByWorkspace).toEqual({
      "workspace-chat": stableChatKey,
      "workspace-shell": chatShellKey,
      "workspace-file": fileKey,
    });
    expect(result.state.shellTabOrderByWorkspace).toEqual({
      "workspace-1": [stableChatKey, fileKey],
    });
  });

  it("migrates missing right panel preferences from v3 state", () => {
    const { state, didMigrate } = migrateWorkspaceUiState({
      ...WORKSPACE_UI_DEFAULTS,
      migrationVersion: 3,
      rightPanelDurableByWorkspace: undefined as unknown as typeof WORKSPACE_UI_DEFAULTS.rightPanelDurableByWorkspace,
      rightPanelMaterializedByWorkspace: undefined as unknown as typeof WORKSPACE_UI_DEFAULTS.rightPanelMaterializedByWorkspace,
    });

    expect(didMigrate).toBe(true);
    expect(state.migrationVersion).toBe(WORKSPACE_UI_MIGRATION_VERSION);
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
        headerOrder: [
          "tool:scratch",
          "tool:git",
          "terminal:t1",
          "terminal:t2",
        ],
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
    expect(state.migrationVersion).toBe(WORKSPACE_UI_MIGRATION_VERSION);
    expect(state.rightPanelDurableByWorkspace.w1).toEqual({
      open: false,
      width: 512,
    });
    expect(state.rightPanelMaterializedByWorkspace.w1).toEqual({
      activeEntryKey: "terminal:terminal-b",
      headerOrder: [
        "tool:git",
        "terminal:terminal-b",
        "terminal:terminal-a",
        "tool:scratch",
      ],
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
      headerOrder: [
        "terminal:t1",
        "tool:git",
        "tool:scratch",
      ],
      browserTabsById: {},
    });
    expect(state.rightPanelDurableByWorkspace.w1).not.toHaveProperty("toolOrder");
    expect(state.rightPanelMaterializedByWorkspace.w1).not.toHaveProperty("terminalOrder");
    expect(state.rightPanelMaterializedByWorkspace.w1).not.toHaveProperty("activeTerminalId");
  });
});
