import { describe, expect, it } from "vitest";
import type { HeaderStripRow } from "./group-rows";
import {
  buildHeaderShellRows,
  type ShellChatTab,
} from "./shell-rows";
import {
  chatWorkspaceShellTabKey,
  fileWorkspaceShellTabKey,
} from "./shell-tabs";

describe("buildHeaderShellRows", () => {
  const chatRows: HeaderStripRow<ShellChatTab>[] = [
    {
      kind: "pill",
      groupKind: "manual",
      groupId: "manual:1",
      manualGroupId: "manual:1",
      color: "red",
      label: "Group",
      isCollapsed: false,
    },
    { kind: "tab", tab: chatTab("a", "manual:1") },
    { kind: "tab", tab: chatTab("b", "manual:1") },
    { kind: "tab", tab: chatTab("c", null) },
  ];

  it("keeps chat group rows atomic when ordered by any member key", () => {
    const rows = buildHeaderShellRows({
      stripRows: chatRows,
      openTabs: ["src/a.ts"],
      orderedTabs: [
        { kind: "file", path: "src/a.ts" },
        { kind: "chat", sessionId: "b" },
        { kind: "chat", sessionId: "a" },
        { kind: "chat", sessionId: "c" },
      ],
      manualGroups: [{ id: "manual:1", sessionIds: ["a", "b"] }],
    });

    expect(rows.map(rowKey)).toEqual([
      fileWorkspaceShellTabKey("src/a.ts"),
      "pill:manual:1",
      chatWorkspaceShellTabKey("a"),
      chatWorkspaceShellTabKey("b"),
      chatWorkspaceShellTabKey("c"),
    ]);
  });

  it("pushes files outside a group slice when order keys split the group", () => {
    const rows = buildHeaderShellRows({
      stripRows: chatRows,
      openTabs: ["src/a.ts"],
      orderedTabs: [
        { kind: "chat", sessionId: "a" },
        { kind: "file", path: "src/a.ts" },
        { kind: "chat", sessionId: "b" },
      ],
      manualGroups: [{ id: "manual:1", sessionIds: ["a", "b"] }],
    });

    expect(rows.map(rowKey)).toEqual([
      "pill:manual:1",
      chatWorkspaceShellTabKey("a"),
      chatWorkspaceShellTabKey("b"),
      fileWorkspaceShellTabKey("src/a.ts"),
    ]);
  });

  it("keeps collapsed group pills when no grouped tab row is rendered", () => {
    const rows = buildHeaderShellRows({
      stripRows: [
        {
          kind: "pill",
          groupKind: "manual",
          groupId: "manual:1",
          manualGroupId: "manual:1",
          color: "red",
          label: "Group",
          isCollapsed: true,
        },
      ],
      openTabs: ["src/a.ts"],
      orderedTabs: [
        { kind: "file", path: "src/a.ts" },
      ],
      manualGroups: [{ id: "manual:1", sessionIds: ["a", "b"] }],
    });

    expect(rows.map(rowKey)).toEqual([
      fileWorkspaceShellTabKey("src/a.ts"),
      "pill:manual:1",
    ]);
    expect(rows[1]).toMatchObject({
      kind: "chat",
      shellKeys: [
        chatWorkspaceShellTabKey("a"),
        chatWorkspaceShellTabKey("b"),
      ],
    });
  });

  it("anchors collapsed subagent groups by hidden child keys", () => {
    const rows = buildHeaderShellRows({
      stripRows: [
        {
          kind: "pill",
          groupKind: "subagent",
          groupId: "parent",
          parentId: "parent",
          color: null,
          label: "Agents",
          isCollapsed: true,
        },
      ],
      openTabs: ["src/a.ts"],
      orderedTabs: [
        { kind: "chat", sessionId: "child" },
        { kind: "file", path: "src/a.ts" },
      ],
      manualGroups: [],
      subagentChildIdsByParentId: new Map([["parent", ["child"]]]),
    });

    expect(rows.map(rowKey)).toEqual([
      "pill:parent",
      fileWorkspaceShellTabKey("src/a.ts"),
    ]);
    expect(rows[0]).toMatchObject({
      kind: "chat",
      shellKeys: [
        chatWorkspaceShellTabKey("parent"),
        chatWorkspaceShellTabKey("child"),
      ],
    });
  });
});

function chatTab(sessionId: string, visualGroupId: string | null): ShellChatTab {
  return {
    id: sessionId,
    sessionId,
    parentSessionId: null,
    groupRootSessionId: sessionId,
    isChild: false,
    visualGroupId,
  };
}

function rowKey(row: ReturnType<typeof buildHeaderShellRows<ShellChatTab>>[number]): string {
  if (row.kind === "file") {
    return row.shellKey;
  }
  return row.row.kind === "pill"
    ? `pill:${row.row.groupId}`
    : chatWorkspaceShellTabKey(row.row.tab.sessionId);
}
