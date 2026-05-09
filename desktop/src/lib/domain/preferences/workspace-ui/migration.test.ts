import { describe, expect, it } from "vitest";
import { migrateWorkspaceUiState } from "@/lib/domain/preferences/workspace-ui/migration";
import {
  WORKSPACE_UI_DEFAULTS,
  WORKSPACE_UI_MIGRATION_VERSION,
  type PersistedWorkspaceUiState,
} from "@/lib/domain/preferences/workspace-ui/model";
import { WORKSPACE_SIDEBAR_MAX_WIDTH } from "@/lib/domain/preferences/workspace-ui/sidebar";
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
});
