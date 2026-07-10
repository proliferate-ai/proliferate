export type AppCommandInvocation = "shortcut" | "palette";

export interface AppCommandAction {
  execute: (invocation: AppCommandInvocation) => void;
  disabledReason: string | null;
  /**
   * When true, callers should not register/offer this action at all (as
   * opposed to registering it disabled). Used for actions whose availability
   * depends on server capabilities rather than transient app state — e.g.
   * `openSupport` under a self-managed server with no configured support
   * destination. Defaults to visible when omitted.
   */
  hidden?: boolean;
}

export interface AppCommandActions {
  openSettings: AppCommandAction;
  showKeyboardShortcuts: AppCommandAction;
  goHome: AppCommandAction;
  goWorkflows: AppCommandAction;
  openWebApp: AppCommandAction;
  openSupport: AppCommandAction;
  addRepository: AppCommandAction;
  newLocalWorkspace: AppCommandAction;
  newWorktreeWorkspace: AppCommandAction;
  newCloudWorkspace: AppCommandAction;
  copyWorkspacePath: AppCommandAction;
  copyBranchName: AppCommandAction;
}
