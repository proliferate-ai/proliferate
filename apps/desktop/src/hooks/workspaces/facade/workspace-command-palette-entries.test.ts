import { describe, expect, it, vi } from "vitest";
import type { AppCommandActions } from "@/hooks/app/workflows/app-command-action-types";
import { buildWorkspaceCommandPaletteEntries } from "./workspace-command-palette-entries";

// Mirrors the sidebar hiding its support action under `support.kind ===
// "none"` (`SidebarHelpSection`): the command-palette "Open Support" entry
// must not merely be disabled, it must not be registered at all.

function commandAction() {
  return { execute: vi.fn(), disabledReason: null as string | null };
}

function baseAppActions(): AppCommandActions {
  return {
    openSettings: commandAction(),
    showKeyboardShortcuts: commandAction(),
    goHome: commandAction(),
    goWorkflows: commandAction(),
    openWebApp: commandAction(),
    openSupport: commandAction(),
    addRepository: commandAction(),
    newLocalWorkspace: commandAction(),
    newWorktreeWorkspace: commandAction(),
    newCloudWorkspace: commandAction(),
    copyWorkspacePath: commandAction(),
    copyBranchName: commandAction(),
  };
}

function baseArgs(appActions: AppCommandActions) {
  return {
    activeSessionId: null,
    appActions,
    canActivateRelativeTab: true,
    canOpenNewSessionTab: true,
    canOpenRepositorySettings: true,
    hasWorkspaceShell: true,
    navigate: vi.fn(),
    newSessionDisabledReason: null,
    onToggleLeftSidebar: vi.fn(),
    onToggleRightPanel: vi.fn(),
    openNewSessionTab: vi.fn(),
    openTerminalPanel: vi.fn(() => true),
    activateRelativeTab: vi.fn(),
    relativeTabDisabledReason: null,
    repoSettingsHref: null,
    repositorySettingsDisabledReason: null,
    restoreLastDismissedTab: vi.fn(),
    restoreTabDisabledReason: null,
    runCommand: {
      onRun: vi.fn(),
      canRun: true,
      disabledReason: null,
      isLaunching: false,
    },
    selectedWorkspaceId: "workspace-1",
    workspaceRemoteAccessActions: {
      syncToWeb: vi.fn(),
      syncToWebDisabledReason: null,
    },
    workspaceWebActions: {
      openCurrentWorkspaceInWeb: vi.fn(),
      disabledReason: null,
    },
  };
}

describe("buildWorkspaceCommandPaletteEntries support routing", () => {
  it("registers 'Open Support' when the action is visible (vendor/operator)", () => {
    const appActions = baseAppActions();
    const entries = buildWorkspaceCommandPaletteEntries(baseArgs(appActions));

    expect(entries.find((entry) => entry.id === "app.open-support")).not.toBeUndefined();
  });

  it("does not register 'Open Support' at all when the action is hidden (support.kind === 'none')", () => {
    const appActions = baseAppActions();
    appActions.openSupport = { ...commandAction(), hidden: true };
    const entries = buildWorkspaceCommandPaletteEntries(baseArgs(appActions));

    expect(entries.find((entry) => entry.id === "app.open-support")).toBeUndefined();
    // Sanity: hiding support doesn't drop unrelated entries.
    expect(entries.find((entry) => entry.id === "app.open-web")).not.toBeUndefined();
  });
});
