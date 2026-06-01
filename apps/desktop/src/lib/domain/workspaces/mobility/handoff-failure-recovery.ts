export type HandoffFinalizationResolution =
  | "finalized"
  | "not_finalized"
  | "unknown";

export function deriveHandoffFailureRecovery(args: {
  handoffStarted: boolean;
  finalized: boolean;
  finalizationUnresolved?: boolean;
  cleanupCompleted: boolean;
}) {
  if (!args.handoffStarted) {
    return {
      shouldMarkHandoffFailed: false,
      shouldRestoreSourceRuntimeState: false,
      shouldRefreshWorkspaceSelection: false,
    };
  }

  if (!args.finalized && args.finalizationUnresolved) {
    return {
      shouldMarkHandoffFailed: false,
      shouldRestoreSourceRuntimeState: false,
      shouldRefreshWorkspaceSelection: true,
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
