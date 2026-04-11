export function deriveHandoffFailureRecovery(args: {
  handoffStarted: boolean;
  finalized: boolean;
  cleanupCompleted: boolean;
}) {
  if (!args.handoffStarted) {
    return {
      shouldMarkHandoffFailed: false,
      shouldRestoreSourceRuntimeState: false,
    };
  }

  if (!args.finalized) {
    return {
      shouldMarkHandoffFailed: true,
      shouldRestoreSourceRuntimeState: true,
    };
  }

  if (!args.cleanupCompleted) {
    return {
      shouldMarkHandoffFailed: false,
      shouldRestoreSourceRuntimeState: true,
    };
  }

  return {
    shouldMarkHandoffFailed: false,
    shouldRestoreSourceRuntimeState: false,
  };
}
