import { SHORTCUTS } from "@/config/shortcuts";
import type { AppCommandActions } from "@/hooks/app/workflows/use-app-command-actions";
import {
  commandPaletteCommandValue,
  type CommandPaletteEntry,
} from "@/lib/domain/command-palette/entries";
import { focusChatInput } from "@/lib/domain/focus-zone";
import { getShortcutDisplayLabel } from "@/lib/domain/shortcuts/matching";
import { runShortcutHandler } from "@/lib/domain/shortcuts/registry";
import { requestRightPanelBrowserTab } from "@/lib/infra/right-panel-new-tab-menu";

export interface RunCommandState {
  onRun: () => void;
  canRun: boolean;
  disabledReason: string | null;
  isLaunching: boolean;
}

export interface WorkspaceWebActionState {
  openCurrentWorkspaceInWeb: () => void;
  disabledReason: string | null;
}

export interface WorkspaceRemoteAccessActionState {
  syncToWeb: () => void;
  syncToWebDisabledReason: string | null;
}

export interface WorkspaceCommandPaletteTabActions {
  activeSessionId: string | null;
  activateRelativeTab: (delta: number) => unknown;
  canActivateRelativeTab: boolean;
  canOpenNewSessionTab: boolean;
  newSessionDisabledReason: string | null;
  openNewSessionTab: () => unknown;
  relativeTabDisabledReason: string | null;
  restoreLastDismissedTab: () => unknown;
  restoreTabDisabledReason: string | null;
}

export function buildWorkspaceCommandPaletteEntries(args: {
  activeSessionId: string | null;
  appActions: AppCommandActions;
  canActivateRelativeTab: boolean;
  canOpenNewSessionTab: boolean;
  canOpenRepositorySettings: boolean;
  hasWorkspaceShell: boolean;
  navigate: (to: string) => void;
  newSessionDisabledReason: string | null;
  onToggleLeftSidebar: () => void;
  onToggleRightPanel: () => void;
  openNewSessionTab: () => unknown;
  openTerminalPanel: () => boolean;
  activateRelativeTab: (delta: number) => unknown;
  relativeTabDisabledReason: string | null;
  repoSettingsHref: string | null;
  repositorySettingsDisabledReason: string | null;
  restoreLastDismissedTab: () => unknown;
  restoreTabDisabledReason: string | null;
  runCommand: RunCommandState;
  selectedWorkspaceId: string | null;
  workspaceRemoteAccessActions: WorkspaceRemoteAccessActionState;
  workspaceWebActions: WorkspaceWebActionState;
}): CommandPaletteEntry[] {
  return [
    {
      id: "workspace.focus-chat",
      value: commandPaletteCommandValue("workspace.focus-chat"),
      group: "workspace",
      label: "Focus Chat",
      icon: "chat",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.focusChat),
      disabledReason: args.hasWorkspaceShell ? null : "Workspace is still opening.",
      execute: () => {
        focusChatInput();
      },
    },
    {
      id: "workspace.open-terminal",
      value: commandPaletteCommandValue("workspace.open-terminal"),
      group: "workspace",
      label: "Show Terminal",
      icon: "panel-bottom",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.openTerminal),
      disabledReason: args.selectedWorkspaceId ? null : "Workspace is still opening.",
      execute: () => {
        args.openTerminalPanel();
      },
    },
    {
      id: "workspace.toggle-left-sidebar",
      value: commandPaletteCommandValue("workspace.toggle-left-sidebar"),
      group: "workspace",
      label: "Toggle Left Sidebar",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.toggleLeftSidebar),
      disabledReason: args.hasWorkspaceShell ? null : "Workspace is still opening.",
      execute: args.onToggleLeftSidebar,
    },
    {
      id: "workspace.toggle-right-panel",
      value: commandPaletteCommandValue("workspace.toggle-right-panel"),
      group: "workspace",
      label: "Toggle Right Panel",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.toggleRightPanel),
      disabledReason: args.hasWorkspaceShell ? null : "Workspace is still opening.",
      execute: args.onToggleRightPanel,
    },
    {
      id: "workspace.open-in-web",
      value: commandPaletteCommandValue("workspace.open-in-web"),
      group: "workspace",
      label: "Open Current Workspace in Web",
      icon: "arrow-right",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.openWorkspaceInWeb),
      disabledReason: args.workspaceWebActions.disabledReason,
      execute: args.workspaceWebActions.openCurrentWorkspaceInWeb,
    },
    {
      id: "workspace.sync-to-web",
      value: commandPaletteCommandValue("workspace.sync-to-web"),
      group: "workspace",
      label: "Sync Current Workspace to Web",
      icon: "cloud-plus",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.syncWorkspaceToWeb),
      disabledReason: args.workspaceRemoteAccessActions.syncToWebDisabledReason,
      execute: args.workspaceRemoteAccessActions.syncToWeb,
    },
    {
      id: "workspace.run-command",
      value: commandPaletteCommandValue("workspace.run-command"),
      group: "workspace",
      label: "Run Workspace Command",
      icon: "play",
      detail: args.runCommand.isLaunching ? "Launching..." : null,
      keywords: ["show run", "terminal"],
      disabledReason: args.runCommand.disabledReason,
      execute: args.runCommand.onRun,
    },
    {
      id: "workspace.repository-settings",
      value: commandPaletteCommandValue("workspace.repository-settings"),
      group: "workspace",
      label: "Repository Settings",
      icon: "settings",
      keywords: ["repo settings"],
      disabledReason: args.canOpenRepositorySettings
        ? null
        : args.repositorySettingsDisabledReason,
      execute: () => {
        if (args.repoSettingsHref) {
          args.navigate(args.repoSettingsHref);
        }
      },
    },
    {
      id: "workspace.new-session-tab",
      value: commandPaletteCommandValue("workspace.new-session-tab"),
      group: "tabs",
      label: "New Chat",
      icon: "chat-plus",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.newSessionTab),
      disabledReason: args.canOpenNewSessionTab ? null : args.newSessionDisabledReason,
      execute: () => {
        args.openNewSessionTab();
      },
    },
    {
      id: "workspace.previous-tab",
      value: commandPaletteCommandValue("workspace.previous-tab"),
      group: "tabs",
      label: "Previous Tab",
      icon: "arrow-left",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.previousTab),
      disabledReason: args.canActivateRelativeTab ? null : args.relativeTabDisabledReason,
      execute: () => {
        args.activateRelativeTab(-1);
      },
    },
    {
      id: "workspace.next-tab",
      value: commandPaletteCommandValue("workspace.next-tab"),
      group: "tabs",
      label: "Next Tab",
      icon: "arrow-right",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.nextTab),
      disabledReason: args.canActivateRelativeTab ? null : args.relativeTabDisabledReason,
      execute: () => {
        args.activateRelativeTab(1);
      },
    },
    {
      id: "workspace.restore-tab",
      value: commandPaletteCommandValue("workspace.restore-tab"),
      group: "tabs",
      label: "Restore Closed Tab",
      icon: "rotate-ccw",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.restoreTab),
      disabledReason: args.restoreTabDisabledReason,
      execute: () => {
        args.restoreLastDismissedTab();
      },
    },
    {
      id: "workspace.open-browser-tab",
      value: commandPaletteCommandValue("workspace.open-browser-tab"),
      group: "tabs",
      label: "Open Browser Tab",
      icon: "panel-bottom",
      disabledReason: args.selectedWorkspaceId ? null : "Workspace is still opening.",
      execute: () => {
        requestRightPanelBrowserTab();
      },
    },
    {
      id: "session.rename",
      value: commandPaletteCommandValue("session.rename"),
      group: "tabs",
      label: "Rename Current Chat",
      icon: "pencil",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.renameSession),
      disabledReason: args.activeSessionId ? null : "No active chat tab.",
      execute: () => {
        runShortcutHandler("session.rename", { source: "palette" });
      },
    },
    {
      id: "app.open-settings",
      value: commandPaletteCommandValue("app.open-settings"),
      group: "app",
      label: "Open Settings",
      icon: "settings",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.openSettings),
      disabledReason: args.appActions.openSettings.disabledReason,
      execute: () => args.appActions.openSettings.execute("palette"),
    },
    {
      id: "app.show-keyboard-shortcuts",
      value: commandPaletteCommandValue("app.show-keyboard-shortcuts"),
      group: "app",
      label: "Show Keyboard Shortcuts",
      icon: "keyboard",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.showKeyboardShortcuts),
      disabledReason: args.appActions.showKeyboardShortcuts.disabledReason,
      execute: () => args.appActions.showKeyboardShortcuts.execute("palette"),
    },
    {
      id: "app.go-home",
      value: commandPaletteCommandValue("app.go-home"),
      group: "app",
      label: "Go Home",
      icon: "arrow-left",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.goHome),
      disabledReason: args.appActions.goHome.disabledReason,
      execute: () => args.appActions.goHome.execute("palette"),
    },
    {
      id: "app.go-plugins",
      value: commandPaletteCommandValue("app.go-plugins"),
      group: "app",
      label: "Go to Plugins",
      icon: "command",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.goPlugins),
      disabledReason: args.appActions.goPlugins.disabledReason,
      execute: () => args.appActions.goPlugins.execute("palette"),
    },
    {
      id: "app.go-automations",
      value: commandPaletteCommandValue("app.go-automations"),
      group: "app",
      label: "Go to Automations",
      icon: "command",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.goAutomations),
      disabledReason: args.appActions.goAutomations.disabledReason,
      execute: () => args.appActions.goAutomations.execute("palette"),
    },
    {
      id: "app.open-web",
      value: commandPaletteCommandValue("app.open-web"),
      group: "app",
      label: "Open Web App",
      icon: "arrow-right",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.openWebApp),
      disabledReason: args.appActions.openWebApp.disabledReason,
      execute: () => args.appActions.openWebApp.execute("palette"),
    },
    {
      id: "app.open-support",
      value: commandPaletteCommandValue("app.open-support"),
      group: "app",
      label: "Open Support",
      icon: "command",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.openSupport),
      disabledReason: args.appActions.openSupport.disabledReason,
      execute: () => args.appActions.openSupport.execute("palette"),
    },
    {
      id: "workspace.add-repository",
      value: commandPaletteCommandValue("workspace.add-repository"),
      group: "app",
      label: "Add Repository",
      icon: "folder-plus",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.addRepository),
      disabledReason: args.appActions.addRepository.disabledReason,
      execute: () => args.appActions.addRepository.execute("palette"),
    },
    {
      id: "workspace.new-local",
      value: commandPaletteCommandValue("workspace.new-local"),
      group: "app",
      label: "New Local Workspace",
      icon: "folder-plus",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.newLocal),
      disabledReason: args.appActions.newLocalWorkspace.disabledReason,
      execute: () => args.appActions.newLocalWorkspace.execute("palette"),
    },
    {
      id: "workspace.new-worktree",
      value: commandPaletteCommandValue("workspace.new-worktree"),
      group: "app",
      label: "New Worktree Workspace",
      icon: "tree",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.newWorktree),
      disabledReason: args.appActions.newWorktreeWorkspace.disabledReason,
      execute: () => args.appActions.newWorktreeWorkspace.execute("palette"),
    },
    {
      id: "workspace.new-cloud",
      value: commandPaletteCommandValue("workspace.new-cloud"),
      group: "app",
      label: "New Cloud Workspace",
      icon: "cloud-plus",
      shortcut: getShortcutDisplayLabel(SHORTCUTS.newCloud),
      disabledReason: args.appActions.newCloudWorkspace.disabledReason,
      execute: () => args.appActions.newCloudWorkspace.execute("palette"),
    },
  ];
}
