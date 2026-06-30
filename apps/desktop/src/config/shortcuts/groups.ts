import type { ComposerShortcutKey } from "./composer-shortcuts";
import type { ShortcutKey } from "./registry";

export interface ShortcutGroup {
  title: string;
  shortcutKeys: readonly ShortcutKey[];
}

export interface ComposerShortcutGroup {
  title: string;
  shortcutKeys: readonly ComposerShortcutKey[];
}

export const SHORTCUT_GROUPS = [
  {
    title: "App",
    shortcutKeys: [
      "openSettings",
      "goHome",
      "goPlugins",
      "goAutomations",
      "openWebApp",
      "openSupport",
      "showKeyboardShortcuts",
      "settingsSectionByIndex",
      "increaseWindowZoom",
      "decreaseWindowZoom",
    ],
  },
  {
    title: "Workspaces",
    shortcutKeys: [
      "newDefault",
      "newWorktree",
      "newLocal",
      "newCloud",
      "addRepository",
      "copyWorkspacePath",
      "copyBranchName",
      "workspaceByIndex",
      "previousWorkspace",
      "nextWorkspace",
    ],
  },
  {
    title: "Tabs",
    shortcutKeys: [
      "previousTab",
      "previousTabArrow",
      "nextTab",
      "nextTabArrow",
      "tabByIndex",
      "newSessionTab",
      "restoreTab",
      "toggleCoworkThreads",
      "closeActiveTab",
      "closeOtherTabs",
      "closeOtherTabsShiftAlias",
    ],
  },
  {
    title: "Current Workspace",
    shortcutKeys: [
      "focusChat",
      "openTerminal",
      "toggleLeftSidebar",
      "toggleRightPanel",
      "openCommandPalette",
      "findContent",
      "openWorkspaceInWeb",
      "syncWorkspaceToWeb",
      "renameSession",
    ],
  },
] as const satisfies readonly ShortcutGroup[];

export const COMPOSER_SHORTCUT_GROUPS = [
  {
    title: "Composer",
    shortcutKeys: [
      "submitMessage",
      "previousMode",
      "stopSession",
    ],
  },
] as const satisfies readonly ComposerShortcutGroup[];
