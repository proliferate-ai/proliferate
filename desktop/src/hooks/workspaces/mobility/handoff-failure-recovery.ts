export function deriveHandoffFailureRecovery(args: {
  handoffStarted: boolean;
  finalized: boolean;
  cleanupCompleted: boolean;
}) {
  if (!args.handoffStarted) {
    return {
      shouldMarkHandoffFailed: false,
      shouldRestoreSourceRuntimeState: false,
      shouldRefreshWorkspaceSelection: false,
    };
  }

  if (!args.finalized) {
    return {
      shouldMarkHandoffFailed: true,
      shouldRestoreSourceRuntimeState: true,
      shouldRefreshWorkspaceSelection: true,
    };
  }

  if (!args.cleanupCompleted) {
    return {
      shouldMarkHandoffFailed: false,
      shouldRestoreSourceRuntimeState: false,
      shouldRefreshWorkspaceSelection: true,
    };
  }

  return {
    shouldMarkHandoffFailed: false,
    shouldRestoreSourceRuntimeState: false,
    shouldRefreshWorkspaceSelection: false,
  };
}
