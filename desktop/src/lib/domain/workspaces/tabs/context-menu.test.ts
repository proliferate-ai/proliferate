import { describe, expect, it } from "vitest";
import {
  FILE_TAB_CONTEXT_MENU_ITEMS,
  buildChatTabContextMenuItems,
  buildGroupPillContextMenuItems,
  resolveChatTabContextMenuSessionIds,
  resolveFileTabContextMenuPaths,
} from "@/lib/domain/workspaces/tabs/context-menu";

describe("workspace tab context menu", () => {
  it("builds chat tab commands from feature flags", () => {
    expect(buildChatTabContextMenuItems({
      canRename: true,
      canDismiss: true,
    })).toEqual([
      {
        kind: "action",
        command: "rename",
        label: "Rename Session",
        shortcutKey: "renameSession",
      },
      { kind: "separator", id: "close-separator" },
      { kind: "action", command: "close", label: "Close Tab", shortcutKey: "closeActiveTab" },
      {
        kind: "action",
        command: "close-others",
        label: "Close Other Tabs",
        shortcutKey: "closeOtherTabs",
      },
      {
        kind: "action",
        command: "close-right",
        label: "Close Tabs to the Right",
        shortcutKey: "closeTabsToRight",
      },
      { kind: "separator", id: "dismiss-separator" },
      { kind: "action", command: "dismiss", label: "Dismiss Session", tone: "destructive" },
    ]);

    expect(buildChatTabContextMenuItems({
      canRename: false,
      canDismiss: false,
    })).toEqual(FILE_TAB_CONTEXT_MENU_ITEMS);

    expect(buildChatTabContextMenuItems({
      canRename: false,
      canFork: true,
      canDismiss: false,
    })).toEqual([
      { kind: "action", command: "fork", label: "Fork Session" },
      { kind: "separator", id: "close-separator" },
      { kind: "action", command: "close", label: "Close Tab", shortcutKey: "closeActiveTab" },
      {
        kind: "action",
        command: "close-others",
        label: "Close Other Tabs",
        shortcutKey: "closeOtherTabs",
      },
      {
        kind: "action",
        command: "close-right",
        label: "Close Tabs to the Right",
        shortcutKey: "closeTabsToRight",
      },
    ]);
  });

  it("gates create-group and child-tab commands", () => {
    expect(buildChatTabContextMenuItems({
      canRename: true,
      canDismiss: true,
      canCreateGroup: true,
    })).toEqual([
      {
        kind: "action",
        command: "rename",
        label: "Rename Session",
        shortcutKey: "renameSession",
      },
      { kind: "action", command: "create-group", label: "Create Group" },
      { kind: "separator", id: "close-separator" },
      { kind: "action", command: "close", label: "Close Tab", shortcutKey: "closeActiveTab" },
      {
        kind: "action",
        command: "close-others",
        label: "Close Other Tabs",
        shortcutKey: "closeOtherTabs",
      },
      {
        kind: "action",
        command: "close-right",
        label: "Close Tabs to the Right",
        shortcutKey: "closeTabsToRight",
      },
      { kind: "separator", id: "dismiss-separator" },
      { kind: "action", command: "dismiss", label: "Dismiss Session", tone: "destructive" },
    ]);

    expect(buildChatTabContextMenuItems({
      canRename: true,
      canFork: true,
      canDismiss: true,
      isChild: true,
    })).toEqual([
      {
        kind: "action",
        command: "rename",
        label: "Rename Session",
        shortcutKey: "renameSession",
      },
      { kind: "separator", id: "close-separator" },
      { kind: "action", command: "close", label: "Close Tab", shortcutKey: "closeActiveTab" },
      { kind: "separator", id: "dismiss-separator" },
      { kind: "action", command: "dismiss", label: "Dismiss Session", tone: "destructive" },
    ]);
  });

  it("builds different manual and subagent pill menus", () => {
    expect(buildGroupPillContextMenuItems({
      groupKind: "subagent",
      isCollapsed: false,
    })).toEqual([
      { kind: "action", command: "collapse-group", label: "Collapse" },
    ]);

    expect(buildGroupPillContextMenuItems({
      groupKind: "manual",
      isCollapsed: true,
    })).toEqual([
      { kind: "action", command: "expand-group", label: "Expand" },
      { kind: "separator", id: "manual-group-separator" },
      { kind: "action", command: "rename-group", label: "Rename Group" },
      { kind: "action", command: "change-group-color", label: "Change Color" },
      { kind: "action", command: "ungroup", label: "Ungroup", tone: "destructive" },
    ]);
  });

  it("resolves file tab close targets", () => {
    const openTabs = ["a.ts", "b.ts", "c.ts"];

    expect(resolveFileTabContextMenuPaths(openTabs, "b.ts", "close")).toEqual(["b.ts"]);
    expect(resolveFileTabContextMenuPaths(openTabs, "b.ts", "close-others")).toEqual([
      "a.ts",
      "c.ts",
    ]);
    expect(resolveFileTabContextMenuPaths(openTabs, "b.ts", "close-right")).toEqual(["c.ts"]);
  });

  it("resolves chat close targets from rendered tab-row order", () => {
    const renderedTabRows = ["parent", "child", "manual-a", "manual-b"];

    expect(resolveChatTabContextMenuSessionIds(
      renderedTabRows,
      "child",
      "close",
    )).toEqual(["child"]);
    expect(resolveChatTabContextMenuSessionIds(
      renderedTabRows,
      "child",
      "close-others",
    )).toEqual(["parent", "manual-a", "manual-b"]);
    expect(resolveChatTabContextMenuSessionIds(
      renderedTabRows,
      "child",
      "close-right",
    )).toEqual(["manual-a", "manual-b"]);
    expect(resolveChatTabContextMenuSessionIds(
      renderedTabRows,
      "missing",
      "close-right",
    )).toEqual([]);
  });

  it("ignores non-file-tab commands and missing anchors", () => {
    const openTabs = ["a.ts", "b.ts"];

    expect(resolveFileTabContextMenuPaths(openTabs, "missing.ts", "close-right")).toEqual([]);
    expect(resolveFileTabContextMenuPaths(openTabs, "a.ts", "rename")).toEqual([]);
    expect(resolveFileTabContextMenuPaths(openTabs, "a.ts", "dismiss")).toEqual([]);
  });
});
