import { describe, expect, it } from "vitest";
import type { HeaderStripRow } from "@/lib/domain/workspaces/tabs/group-rows";
import { resolveWorkspaceShellTabsState } from "@/lib/domain/workspaces/tabs/shell-tab-state";
import {
  chatWorkspaceShellTabKey,
  fileWorkspaceShellTabKey,
} from "@/lib/domain/workspaces/tabs/shell-tabs";
import type { ShellChatTab } from "@/lib/domain/workspaces/tabs/shell-rows";
import { fileViewerTarget } from "@/lib/domain/workspaces/viewer-target";

interface TestChatTab extends ShellChatTab {
  title: string;
}

function chatTab(sessionId: string): TestChatTab {
  return {
    id: sessionId,
    sessionId,
    title: sessionId,
    parentSessionId: null,
    groupRootSessionId: sessionId,
    isChild: false,
    visualGroupId: null,
  };
}

describe("resolveWorkspaceShellTabsState", () => {
  it("orders chat and file tabs from persisted shell keys", () => {
    const state = resolveWorkspaceShellTabsState({
      selectedWorkspaceId: "workspace-1",
      activeSessionId: "session-a",
      storedActiveShellTabKey: null,
      persistedShellOrderKeys: [
        fileWorkspaceShellTabKey("src/App.tsx"),
        chatWorkspaceShellTabKey("session-b"),
      ],
      shellChatSessionIds: ["session-a", "session-b"],
      openTargets: [fileViewerTarget("src/App.tsx")],
      stripRows: [],
      displayManualGroups: [],
      subagentChildIdsByParentId: new Map(),
    });

    expect(state.orderedTabs).toEqual([
      { kind: "viewer", target: fileViewerTarget("src/App.tsx") },
      { kind: "chat", sessionId: "session-b" },
      { kind: "chat", sessionId: "session-a" },
    ]);
    expect(state.orderedShellTabKeys).toEqual([
      fileWorkspaceShellTabKey("src/App.tsx"),
      "chat:session-b",
      "chat:session-a",
    ]);
    expect(state.activeShellTab).toEqual({ kind: "chat", sessionId: "session-a" });
  });

  it("honors a stored active shell key when the tab still exists", () => {
    const state = resolveWorkspaceShellTabsState({
      selectedWorkspaceId: "workspace-1",
      activeSessionId: "session-a",
      storedActiveShellTabKey: fileWorkspaceShellTabKey("README.md"),
      persistedShellOrderKeys: [],
      shellChatSessionIds: ["session-a"],
      openTargets: [fileViewerTarget("README.md")],
      stripRows: [],
      displayManualGroups: [],
      subagentChildIdsByParentId: new Map(),
    });

    expect(state.activeShellTab).toEqual({ kind: "viewer", target: fileViewerTarget("README.md") });
    expect(state.activeShellTabKey).toBe(fileWorkspaceShellTabKey("README.md"));
  });

  it("builds shell rows without mutating tab stores", () => {
    const stripRows: HeaderStripRow<TestChatTab>[] = [
      {
        kind: "tab",
        tab: chatTab("session-a"),
      },
    ];

    const state = resolveWorkspaceShellTabsState({
      selectedWorkspaceId: "workspace-1",
      activeSessionId: "session-a",
      storedActiveShellTabKey: null,
      persistedShellOrderKeys: [],
      shellChatSessionIds: ["session-a"],
      openTargets: [fileViewerTarget("README.md")],
      stripRows,
      displayManualGroups: [],
      subagentChildIdsByParentId: new Map(),
    });

    expect(state.shellRows.map((row) => row.kind)).toEqual(["chat", "viewer"]);
  });
});
