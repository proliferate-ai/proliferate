import type { ShortcutKey } from "@/config/shortcuts";

export type WorkspaceTabContextMenuCommand =
  | "rename"
  | "create-group"
  | "close"
  | "close-others"
  | "close-right"
  | "dismiss"
  | "collapse-group"
  | "expand-group"
  | "rename-group"
  | "change-group-color"
  | "ungroup";

export type WorkspaceTabContextMenuItem =
  | {
      kind: "action";
      command: WorkspaceTabContextMenuCommand;
      label: string;
      shortcutKey?: ShortcutKey;
      tone?: "destructive";
    }
  | {
      kind: "separator";
      id: string;
    };

const CLOSE_TAB_ACTION: WorkspaceTabContextMenuItem = {
  kind: "action",
  command: "close",
  label: "Close Tab",
  shortcutKey: "closeActiveTab",
};

const CLOSE_OTHER_TABS_ACTION: WorkspaceTabContextMenuItem = {
  kind: "action",
  command: "close-others",
  label: "Close Other Tabs",
  shortcutKey: "closeOtherTabs",
};

const CLOSE_TABS_TO_RIGHT_ACTION: WorkspaceTabContextMenuItem = {
  kind: "action",
  command: "close-right",
  label: "Close Tabs to the Right",
  shortcutKey: "closeTabsToRight",
};

export const FILE_TAB_CONTEXT_MENU_ITEMS: readonly WorkspaceTabContextMenuItem[] = [
  CLOSE_TAB_ACTION,
  CLOSE_OTHER_TABS_ACTION,
  CLOSE_TABS_TO_RIGHT_ACTION,
];

export function buildChatTabContextMenuItems({
  canRename,
  canDismiss,
  canCreateGroup = false,
  isChild = false,
}: {
  canRename: boolean;
  canDismiss: boolean;
  canCreateGroup?: boolean;
  isChild?: boolean;
}): WorkspaceTabContextMenuItem[] {
  const items: WorkspaceTabContextMenuItem[] = [];

  if (canRename) {
    items.push({
      kind: "action",
      command: "rename",
      label: "Rename Session",
      shortcutKey: "renameSession",
    });
  }

  if (canCreateGroup) {
    items.push({
      kind: "action",
      command: "create-group",
      label: "Create Group",
    });
  }

  if (items.length > 0) {
    items.push({ kind: "separator", id: "close-separator" });
  }

  items.push(CLOSE_TAB_ACTION);

  if (!isChild) {
    items.push(
      CLOSE_OTHER_TABS_ACTION,
      CLOSE_TABS_TO_RIGHT_ACTION,
    );
  }

  if (canDismiss) {
    items.push(
      { kind: "separator", id: "dismiss-separator" },
      {
        kind: "action",
        command: "dismiss",
        label: "Dismiss Session",
        tone: "destructive",
      },
    );
  }

  return items;
}

export function buildGroupPillContextMenuItems({
  groupKind,
  isCollapsed,
}: {
  groupKind: "manual" | "subagent";
  isCollapsed: boolean;
}): WorkspaceTabContextMenuItem[] {
  const items: WorkspaceTabContextMenuItem[] = [
    {
      kind: "action",
      command: isCollapsed ? "expand-group" : "collapse-group",
      label: isCollapsed ? "Expand" : "Collapse",
    },
  ];

  if (groupKind === "manual") {
    items.push(
      { kind: "separator", id: "manual-group-separator" },
      {
        kind: "action",
        command: "rename-group",
        label: "Rename Group",
      },
      {
        kind: "action",
        command: "change-group-color",
        label: "Change Color",
      },
      {
        kind: "action",
        command: "ungroup",
        label: "Ungroup",
        tone: "destructive",
      },
    );
  }

  return items;
}

export function resolveFileTabContextMenuPaths(
  openTabs: readonly string[],
  anchorPath: string,
  command: WorkspaceTabContextMenuCommand,
): string[] {
  switch (command) {
    case "close":
      return [anchorPath];
    case "close-others":
      return openTabs.filter((path) => path !== anchorPath);
    case "close-right": {
      const index = openTabs.indexOf(anchorPath);
      return index >= 0 ? openTabs.slice(index + 1) : [];
    }
    case "create-group":
    case "dismiss":
    case "collapse-group":
    case "expand-group":
    case "rename-group":
    case "change-group-color":
    case "ungroup":
    case "rename":
      return [];
  }
}

export function resolveChatTabContextMenuSessionIds(
  renderedTabSessionIds: readonly string[],
  anchorSessionId: string,
  command: WorkspaceTabContextMenuCommand,
): string[] {
  switch (command) {
    case "close":
      return [anchorSessionId];
    case "close-others":
      return renderedTabSessionIds.filter((sessionId) => sessionId !== anchorSessionId);
    case "close-right": {
      const index = renderedTabSessionIds.indexOf(anchorSessionId);
      return index >= 0 ? renderedTabSessionIds.slice(index + 1) : [];
    }
    case "create-group":
    case "dismiss":
    case "collapse-group":
    case "expand-group":
    case "rename-group":
    case "change-group-color":
    case "ungroup":
    case "rename":
      return [];
  }
}
