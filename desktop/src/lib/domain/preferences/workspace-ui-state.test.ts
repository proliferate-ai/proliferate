import { describe, expect, it } from "vitest";
import {
  getChangedWorkspaceUiStateKeys,
  isNonPersistedWorkspaceUiStateKey,
  migrateWorkspaceUiState,
  selectPersistedWorkspaceUiState,
  WORKSPACE_SIDEBAR_MAX_WIDTH,
  WORKSPACE_UI_DEFAULTS,
  WORKSPACE_UI_MIGRATION_VERSION,
  type PersistedWorkspaceUiState,
  type WorkspaceUiChangeTrackedState,
} from "@/lib/domain/preferences/workspace-ui-state";
import {
  chatShellWorkspaceIntentKey,
  chatWorkspaceShellTabKey,
  fileWorkspaceShellTabKey,
} from "@/lib/domain/workspaces/tabs/shell-tabs";

describe("workspace UI state", () => {
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

  it("sanitizes persisted chat slices and excludes non-persisted runtime state", () => {
    const selected = selectPersistedWorkspaceUiState({
      ...WORKSPACE_UI_DEFAULTS,
      migrationVersion: 3,
      lastViewedSessionByWorkspace: {
        "workspace-1": "session-1",
        "workspace-2": "client-session:tmp",
      },
      visibleChatSessionIdsByWorkspace: {
        "workspace-1": [
          "session-1",
          "client-session:tmp",
          "session-1",
          "pending-session:tmp",
        ],
      },
      recentlyHiddenChatSessionIdsByWorkspace: {
        "workspace-1": ["session-2", "pending-session:tmp"],
      },
      collapsedChatGroupsByWorkspace: {
        "workspace-1": ["session-2", "session-2", "client-session:tmp"],
      },
      manualChatGroupsByWorkspace: {
        "workspace-1": [{
          id: "manual:review",
          label: " Review ",
          colorId: "magenta",
          sessionIds: ["session-1", "client-session:tmp", "session-2", "session-2"],
        }],
        "workspace-2": [{
          id: "manual:transient",
          label: "Transient",
          colorId: "blue",
          sessionIds: ["client-session:one", "pending-session:two"],
        }],
      },
      shellActivationEpochByWorkspace: { "workspace-1": 2 },
      pendingChatActivationByWorkspace: { "workspace-1": { kind: "chat" } },
      urgentHighlightedChatSessionByWorkspace: { "workspace-1": "session-1" },
    } as WorkspaceUiChangeTrackedState);

    expect(selected.migrationVersion).toBe(WORKSPACE_UI_MIGRATION_VERSION);
    expect(selected.lastViewedSessionByWorkspace).toEqual({
      "workspace-1": "session-1",
    });
    expect(selected.visibleChatSessionIdsByWorkspace).toEqual({
      "workspace-1": ["session-1"],
    });
    expect(selected.recentlyHiddenChatSessionIdsByWorkspace).toEqual({
      "workspace-1": ["session-2"],
    });
    expect(selected.collapsedChatGroupsByWorkspace).toEqual({
      "workspace-1": ["session-2"],
    });
    expect(selected.manualChatGroupsByWorkspace).toEqual({
      "workspace-1": [{
        id: "manual:review",
        label: "Review",
        colorId: "magenta",
        sessionIds: ["session-1", "session-2"],
      }],
    });
    expect(selected).not.toHaveProperty("shellActivationEpochByWorkspace");
    expect(selected).not.toHaveProperty("pendingChatActivationByWorkspace");
    expect(selected).not.toHaveProperty("urgentHighlightedChatSessionByWorkspace");
  });

  it("tracks persisted and runtime-only keys separately", () => {
    const previous = {
      ...WORKSPACE_UI_DEFAULTS,
      shellActivationEpochByWorkspace: {},
      pendingChatActivationByWorkspace: {},
      urgentHighlightedChatSessionByWorkspace: {},
    } satisfies WorkspaceUiChangeTrackedState;
    const next = {
      ...previous,
      sidebarOpen: true,
      shellActivationEpochByWorkspace: { "workspace-1": 1 },
      urgentHighlightedChatSessionByWorkspace: { "workspace-1": "session-1" },
    } satisfies WorkspaceUiChangeTrackedState;

    expect(getChangedWorkspaceUiStateKeys(previous, next)).toEqual([
      "sidebarOpen",
      "shellActivationEpochByWorkspace",
      "urgentHighlightedChatSessionByWorkspace",
    ]);
    expect(isNonPersistedWorkspaceUiStateKey("shellActivationEpochByWorkspace")).toBe(true);
    expect(isNonPersistedWorkspaceUiStateKey("pendingChatActivationByWorkspace")).toBe(true);
    expect(isNonPersistedWorkspaceUiStateKey("urgentHighlightedChatSessionByWorkspace")).toBe(true);
    expect(isNonPersistedWorkspaceUiStateKey("sidebarOpen")).toBe(false);
  });
});
