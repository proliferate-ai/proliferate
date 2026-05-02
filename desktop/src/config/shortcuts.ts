export type ShortcutOwner = "js" | "native-menu";

interface ShortcutModifierMatch {
  meta: boolean;
  shift: boolean;
  alt: boolean;
  ctrl?: boolean;
}

export type ShortcutMatch =
  | ({
    kind: "fixed";
    key: string;
  } & ShortcutModifierMatch)
  | ({
    kind: "digit-key";
  } & ShortcutModifierMatch)
  | ({
    kind: "digit-code";
  } & ShortcutModifierMatch);

export interface ShortcutDef<Id extends string = string> {
  id: Id;
  label: string;
  nonMacLabel?: string;
  description: string;
  owner: ShortcutOwner;
  match: ShortcutMatch;
  nonMacMatch?: ShortcutMatch;
  allowInInputs: boolean;
}

export interface ComposerShortcutDef {
  key: string;
  label: string;
  nonMacLabel?: string;
  description: string;
}

export const SHORTCUTS = {
  openSettings: {
    id: "app.open-settings",
    label: "⌘,",
    description: "Open settings",
    owner: "native-menu",
    match: { kind: "fixed", key: ",", meta: true, shift: false, alt: false },
    allowInInputs: true,
  },
  selectAll: {
    id: "app.select-all",
    label: "⌘A",
    nonMacLabel: "Ctrl+A",
    description: "Select all",
    owner: "native-menu",
    match: { kind: "fixed", key: "a", meta: true, shift: false, alt: false },
    allowInInputs: true,
  },
  undo: {
    id: "app.undo",
    label: "⌘Z",
    nonMacLabel: "Ctrl+Z",
    description: "Undo",
    owner: "native-menu",
    match: { kind: "fixed", key: "z", meta: true, shift: false, alt: false },
    allowInInputs: true,
  },
  redo: {
    id: "app.redo",
    label: "⌘⇧Z",
    nonMacLabel: "Ctrl+Shift+Z",
    description: "Redo",
    owner: "native-menu",
    match: { kind: "fixed", key: "z", meta: true, shift: true, alt: false },
    allowInInputs: true,
  },
  newWorktree: {
    id: "workspace.new-worktree",
    label: "⌘N",
    description: "New worktree workspace",
    owner: "js",
    match: { kind: "fixed", key: "n", meta: true, shift: false, alt: false },
    allowInInputs: true,
  },
  newLocal: {
    id: "workspace.new-local",
    label: "⌘⇧N",
    description: "New local workspace",
    owner: "js",
    match: { kind: "fixed", key: "n", meta: true, shift: true, alt: false },
    allowInInputs: true,
  },
  newCloud: {
    id: "workspace.new-cloud",
    label: "⌘⌃N",
    nonMacLabel: "Ctrl+Alt+N",
    description: "New cloud workspace",
    owner: "js",
    match: { kind: "fixed", key: "n", meta: true, ctrl: true, shift: false, alt: false },
    nonMacMatch: { kind: "fixed", key: "n", meta: true, shift: false, alt: true },
    allowInInputs: true,
  },
  addRepository: {
    id: "workspace.add-repository",
    label: "⌘I",
    description: "Add repository",
    owner: "js",
    match: { kind: "fixed", key: "i", meta: true, shift: false, alt: false },
    allowInInputs: false,
  },
  workspaceByIndex: {
    id: "workspace.by-index",
    label: "⌘⌥1-9",
    description: "Switch to workspace by index",
    owner: "js",
    match: { kind: "digit-code", meta: true, shift: false, alt: true },
    allowInInputs: true,
  },
  previousTab: {
    id: "workspace.previous-tab",
    label: "⌘⌥←",
    description: "Previous tab",
    owner: "js",
    match: { kind: "fixed", key: "ArrowLeft", meta: true, shift: false, alt: true },
    allowInInputs: true,
  },
  nextTab: {
    id: "workspace.next-tab",
    label: "⌘⌥→",
    description: "Next tab",
    owner: "js",
    match: { kind: "fixed", key: "ArrowRight", meta: true, shift: false, alt: true },
    allowInInputs: true,
  },
  tabByIndex: {
    id: "workspace.tab-by-index",
    label: "⌘1-9",
    description: "Jump to tab by index",
    owner: "js",
    match: { kind: "digit-key", meta: true, shift: false, alt: false },
    allowInInputs: true,
  },
  newSessionTab: {
    id: "workspace.new-session-tab",
    label: "⌘T",
    description: "New session tab",
    owner: "js",
    match: { kind: "fixed", key: "t", meta: true, shift: false, alt: false },
    allowInInputs: true,
  },
  restoreTab: {
    id: "workspace.restore-tab",
    label: "⌘⇧T",
    description: "Restore closed tab",
    owner: "js",
    match: { kind: "fixed", key: "t", meta: true, shift: true, alt: false },
    allowInInputs: true,
  },
  closeActiveTab: {
    id: "workspace.close-active-tab",
    label: "⌘W",
    description: "Close tab",
    owner: "native-menu",
    match: { kind: "fixed", key: "w", meta: true, shift: false, alt: false },
    allowInInputs: true,
  },
  closeOtherTabs: {
    id: "workspace.close-other-tabs",
    label: "⌘⇧O",
    nonMacLabel: "Ctrl+Shift+O",
    description: "Close other tabs",
    owner: "js",
    match: { kind: "fixed", key: "o", meta: true, shift: true, alt: false },
    allowInInputs: false,
  },
  closeTabsToRight: {
    id: "workspace.close-tabs-to-right",
    label: "⌘⇧R",
    nonMacLabel: "Ctrl+Shift+R",
    description: "Close tabs to the right",
    owner: "js",
    match: { kind: "fixed", key: "r", meta: true, shift: true, alt: false },
    allowInInputs: false,
  },
  focusChat: {
    id: "workspace.focus-chat",
    label: "⌘L",
    description: "Focus chat input",
    owner: "js",
    match: { kind: "fixed", key: "l", meta: true, shift: false, alt: false },
    allowInInputs: true,
  },
  openTerminal: {
    id: "workspace.open-terminal",
    label: "⌘J",
    description: "Open terminal",
    owner: "js",
    match: { kind: "fixed", key: "j", meta: true, shift: false, alt: false },
    allowInInputs: true,
  },
  toggleLeftSidebar: {
    id: "workspace.toggle-left-sidebar",
    label: "⌘B",
    nonMacLabel: "Ctrl+B",
    description: "Toggle left sidebar",
    owner: "js",
    match: { kind: "fixed", key: "b", meta: true, shift: false, alt: false },
    allowInInputs: false,
  },
  toggleRightPanel: {
    id: "workspace.toggle-right-panel",
    label: "⌘⌥B",
    nonMacLabel: "Ctrl+Alt+B",
    description: "Toggle right panel",
    owner: "js",
    match: { kind: "fixed", key: "b", meta: true, shift: false, alt: true },
    allowInInputs: false,
  },
  openCommandPalette: {
    id: "workspace.open-command-palette",
    label: "⌘K",
    description: "Open command palette",
    owner: "js",
    match: { kind: "fixed", key: "k", meta: true, shift: false, alt: false },
    allowInInputs: true,
  },
  renameSession: {
    id: "session.rename",
    label: "⌘R",
    description: "Rename current chat",
    owner: "js",
    match: { kind: "fixed", key: "r", meta: true, shift: false, alt: false },
    allowInInputs: true,
  },
} as const satisfies Record<string, ShortcutDef>;

export type ShortcutId = (typeof SHORTCUTS)[keyof typeof SHORTCUTS]["id"];

export const COMPOSER_SHORTCUTS = {
  submitMessage: {
    key: "Enter",
    label: "↵ / ⌘↵",
    nonMacLabel: "↵ / Ctrl+Enter",
    description: "Submit message",
  },
  previousMode: {
    key: "Tab",
    label: "⇧⇥",
    description: "Previous session mode",
  },
  stopSession: {
    key: "Escape",
    label: "Esc",
    description: "Stop running session",
  },
} as const satisfies Record<string, ComposerShortcutDef>;

export type ShortcutKey = keyof typeof SHORTCUTS;
export type ComposerShortcutKey = keyof typeof COMPOSER_SHORTCUTS;

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
    ],
  },
  {
    title: "Workspaces",
    shortcutKeys: [
      "newWorktree",
      "newLocal",
      "newCloud",
      "addRepository",
      "workspaceByIndex",
    ],
  },
  {
    title: "Tabs",
    shortcutKeys: [
      "previousTab",
      "nextTab",
      "tabByIndex",
      "newSessionTab",
      "restoreTab",
      "closeActiveTab",
      "closeOtherTabs",
      "closeTabsToRight",
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
