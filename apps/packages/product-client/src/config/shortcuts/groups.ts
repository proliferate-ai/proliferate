import type { ComposerShortcutKey } from "#product/config/shortcuts/composer-shortcuts";
import type { ShortcutKey } from "#product/config/shortcuts/registry";

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
      "goAutomations",
      "openWebApp",
      "openSupport",
      "showKeyboardShortcuts",
      "settingsSectionByIndex",
      "settingsBack",
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
      "archiveWorkspace",
    ],
  },
  {
    title: "Tabs",
    shortcutKeys: [
      "previousTab",
      "previousTabArrow",
      "previousTabCtrlTab",
      "nextTab",
      "nextTabArrow",
      "nextTabCtrlTab",
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
      "openModelSelector",
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
      "cycleReasoningEffort",
      "stopSession",
      "editLastQueued",
    ],
  },
] as const satisfies readonly ComposerShortcutGroup[];
