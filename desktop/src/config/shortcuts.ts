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
    kind: "fixed-code";
    code: string;
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
    nonMacLabel: "Ctrl+,",
    description: "Open settings",
    owner: "native-menu",
    match: { kind: "fixed", key: ",", meta: true, shift: false, alt: false },
    allowInInputs: true,
  },
  goHome: {
    id: "app.go-home",
    label: "⌘⇧,",
    nonMacLabel: "Ctrl+Shift+,",
    description: "Go home",
    owner: "js",
    match: { kind: "fixed-code", code: "Comma", meta: true, shift: true, alt: false },
    allowInInputs: false,
  },
  goPlugins: {
    id: "app.go-plugins",
    label: "⌘P",
    nonMacLabel: "Ctrl+P",
    description: "Go to plugins",
    owner: "js",
    match: { kind: "fixed-code", code: "KeyP", meta: true, shift: false, alt: false },
    allowInInputs: false,
  },
  goAutomations: {
    id: "app.go-automations",
    label: "⌘U",
    nonMacLabel: "Ctrl+U",
    description: "Go to automations",
    owner: "js",
    match: { kind: "fixed-code", code: "KeyU", meta: true, shift: false, alt: false },
    allowInInputs: false,
  },
  openSupport: {
    id: "app.open-support",
    label: "⌘S",
    nonMacLabel: "Ctrl+S",
    description: "Open support",
    owner: "js",
    match: { kind: "fixed-code", code: "KeyS", meta: true, shift: false, alt: false },
    allowInInputs: false,
  },
  showKeyboardShortcuts: {
    id: "app.show-keyboard-shortcuts",
    label: "⌘?",
    nonMacLabel: "Ctrl+?",
    description: "Show keyboard shortcuts",
    owner: "js",
    match: { kind: "fixed-code", code: "Slash", meta: true, shift: true, alt: false },
    allowInInputs: true,
  },
  increaseTextSize: {
    id: "app.increase-text-size",
    label: "⌘+",
    nonMacLabel: "Ctrl+Plus",
    description: "Increase text size",
    owner: "js",
    match: { kind: "fixed-code", code: "Equal", meta: true, shift: true, alt: false },
    allowInInputs: true,
  },
  increaseTextSizeEqualAlias: {
    id: "app.increase-text-size",
    label: "⌘=",
    nonMacLabel: "Ctrl+=",
    description: "Increase text size",
    owner: "js",
    match: { kind: "fixed-code", code: "Equal", meta: true, shift: false, alt: false },
    allowInInputs: true,
  },
  decreaseTextSize: {
    id: "app.decrease-text-size",
    label: "⌘-",
    nonMacLabel: "Ctrl+-",
    description: "Decrease text size",
    owner: "js",
    match: { kind: "fixed-code", code: "Minus", meta: true, shift: false, alt: false },
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
    label: "⌘⌥N",
    nonMacLabel: "Ctrl+Alt+Shift+N",
    description: "New worktree workspace",
    owner: "js",
    match: { kind: "fixed", key: "n", meta: true, shift: false, alt: true },
    nonMacMatch: { kind: "fixed", key: "n", meta: true, shift: true, alt: true },
    allowInInputs: true,
  },
  newLocal: {
    id: "workspace.new-local",
    label: "⌘⇧N",
    nonMacLabel: "Ctrl+Shift+N",
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
    label: "⌘O",
    nonMacLabel: "Ctrl+O",
    description: "Add repository",
    owner: "js",
    match: { kind: "fixed", key: "o", meta: true, shift: false, alt: false },
    allowInInputs: false,
  },
  workspaceByIndex: {
    id: "workspace.by-index",
    label: "⌘⌥1-9",
    nonMacLabel: "Ctrl+Alt+1-9",
    description: "Switch to workspace by index",
    owner: "js",
    match: { kind: "digit-code", meta: true, shift: false, alt: true },
    allowInInputs: true,
  },
  previousWorkspace: {
    id: "workspace.previous-workspace",
    label: "⌘⌥↑",
    nonMacLabel: "Ctrl+Alt+↑",
    description: "Previous workspace",
    owner: "js",
    match: { kind: "fixed", key: "ArrowUp", meta: true, shift: false, alt: true },
    allowInInputs: true,
  },
  nextWorkspace: {
    id: "workspace.next-workspace",
    label: "⌘⌥↓",
    nonMacLabel: "Ctrl+Alt+↓",
    description: "Next workspace",
    owner: "js",
    match: { kind: "fixed", key: "ArrowDown", meta: true, shift: false, alt: true },
    allowInInputs: true,
  },
  previousTab: {
    id: "workspace.previous-tab",
    label: "⌘⇧[",
    nonMacLabel: "Ctrl+Shift+[",
    description: "Previous tab",
    owner: "js",
    match: { kind: "fixed-code", code: "BracketLeft", meta: true, shift: true, alt: false },
    allowInInputs: true,
  },
  nextTab: {
    id: "workspace.next-tab",
    label: "⌘⇧]",
    nonMacLabel: "Ctrl+Shift+]",
    description: "Next tab",
    owner: "js",
    match: { kind: "fixed-code", code: "BracketRight", meta: true, shift: true, alt: false },
    allowInInputs: true,
  },
  tabByIndex: {
    id: "workspace.tab-by-index",
    label: "⌘1-9",
    nonMacLabel: "Ctrl+1-9",
    description: "Jump to chat by index",
    owner: "js",
    match: { kind: "digit-key", meta: true, shift: false, alt: false },
    allowInInputs: true,
  },
  openBrowserTab: {
    id: "workspace.open-browser-tab",
    label: "⌘T",
    nonMacLabel: "Ctrl+T",
    description: "Open browser tab",
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
  toggleCoworkThreads: {
    id: "workspace.toggle-cowork-threads",
    label: "⌘⌥T",
    nonMacLabel: "Ctrl+Alt+T",
    description: "Toggle cowork threads",
    owner: "js",
    match: { kind: "fixed", key: "t", meta: true, shift: false, alt: true },
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
    label: "⌘⌥O",
    nonMacLabel: "Ctrl+Alt+O",
    description: "Close other tabs",
    owner: "js",
    match: { kind: "fixed", key: "o", meta: true, shift: false, alt: true },
    allowInInputs: true,
  },
  focusChat: {
    id: "workspace.focus-chat",
    label: "⌘L",
    nonMacLabel: "Ctrl+L",
    description: "Focus chat input",
    owner: "js",
    match: { kind: "fixed", key: "l", meta: true, shift: false, alt: false },
    allowInInputs: true,
  },
  openTerminal: {
    id: "workspace.open-terminal",
    label: "⌘J",
    nonMacLabel: "Ctrl+J",
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
    match: { kind: "fixed-code", code: "KeyB", meta: true, shift: false, alt: false },
    allowInInputs: true,
  },
  toggleRightPanel: {
    id: "workspace.toggle-right-panel",
    label: "⌘⌥B",
    nonMacLabel: "Ctrl+Alt+B",
    description: "Toggle right panel",
    owner: "js",
    match: { kind: "fixed-code", code: "KeyB", meta: true, shift: false, alt: true },
    allowInInputs: true,
  },
  openCommandPalette: {
    id: "workspace.open-command-palette",
    label: "⌘K",
    nonMacLabel: "Ctrl+K",
    description: "Open command palette",
    owner: "js",
    match: { kind: "fixed", key: "k", meta: true, shift: false, alt: false },
    allowInInputs: true,
  },
  renameSession: {
    id: "session.rename",
    label: "⌘⌥R",
    nonMacLabel: "Ctrl+Alt+R",
    description: "Rename current chat",
    owner: "js",
    match: { kind: "fixed", key: "r", meta: true, shift: false, alt: true },
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
      "goHome",
      "goPlugins",
      "goAutomations",
      "openSupport",
      "showKeyboardShortcuts",
      "increaseTextSize",
      "decreaseTextSize",
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
      "previousWorkspace",
      "nextWorkspace",
    ],
  },
  {
    title: "Tabs",
    shortcutKeys: [
      "previousTab",
      "nextTab",
      "tabByIndex",
      "openBrowserTab",
      "restoreTab",
      "toggleCoworkThreads",
      "closeActiveTab",
      "closeOtherTabs",
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
