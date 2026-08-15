import { describe, expect, it, vi } from "vitest";
import type { AppCommandActions } from "#product/hooks/app/workflows/app-command-action-types";
import { buildWorkspaceCommandPaletteEntries } from "#product/hooks/workspaces/facade/workspace-command-palette-entries";

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

// Same treatment for the gen-2 Workflows entry: while the workflows_v2 gate is
// off, "Go to Workflows" must not be offered at all — a disabled entry would
// still advertise a surface that ships dark.
describe("buildWorkspaceCommandPaletteEntries workflows gating", () => {
  it("registers 'Go to Workflows' when the action is visible (gate on)", () => {
    const appActions = baseAppActions();
    const entries = buildWorkspaceCommandPaletteEntries(baseArgs(appActions));

    expect(entries.find((entry) => entry.id === "app.go-workflows")).not.toBeUndefined();
  });

  it("does not register 'Go to Workflows' at all when the action is hidden (gate off)", () => {
    const appActions = baseAppActions();
    appActions.goWorkflows = { ...commandAction(), hidden: true };
    const entries = buildWorkspaceCommandPaletteEntries(baseArgs(appActions));

    expect(entries.find((entry) => entry.id === "app.go-workflows")).toBeUndefined();
    expect(entries.find((entry) => entry.id === "app.go-home")).not.toBeUndefined();
  });

  it("drops both entries when support and workflows are hidden together", () => {
    const appActions = baseAppActions();
    appActions.openSupport = { ...commandAction(), hidden: true };
    appActions.goWorkflows = { ...commandAction(), hidden: true };
    const entries = buildWorkspaceCommandPaletteEntries(baseArgs(appActions));

    expect(entries.find((entry) => entry.id === "app.open-support")).toBeUndefined();
    expect(entries.find((entry) => entry.id === "app.go-workflows")).toBeUndefined();
    expect(entries.find((entry) => entry.id === "app.open-web")).not.toBeUndefined();
  });
});
