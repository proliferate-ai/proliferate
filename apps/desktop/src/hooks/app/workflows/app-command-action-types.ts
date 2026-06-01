export type AppCommandInvocation = "shortcut" | "palette";

export interface AppCommandAction {
  execute: (invocation: AppCommandInvocation) => void;
  disabledReason: string | null;
}

export interface AppCommandActions {
  openSettings: AppCommandAction;
  showKeyboardShortcuts: AppCommandAction;
  goHome: AppCommandAction;
  goPlugins: AppCommandAction;
  goAutomations: AppCommandAction;
  openWebApp: AppCommandAction;
  openSupport: AppCommandAction;
  addRepository: AppCommandAction;
  newLocalWorkspace: AppCommandAction;
  newWorktreeWorkspace: AppCommandAction;
  newCloudWorkspace: AppCommandAction;
  copyWorkspacePath: AppCommandAction;
  copyBranchName: AppCommandAction;
}
