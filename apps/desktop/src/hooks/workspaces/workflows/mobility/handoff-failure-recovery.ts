import { getCloudMobilityWorkspaceDetail } from "@proliferate/cloud-sdk/client/mobility";

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

export async function resolveHandoffFinalizationAfterAmbiguousCutover(args: {
  mobilityWorkspaceId: string;
  handoffOpId: string;
}): Promise<HandoffFinalizationResolution> {
  try {
    const detail = await getCloudMobilityWorkspaceDetail(args.mobilityWorkspaceId);
    const handoff = detail.activeHandoff;
    if (!handoff || handoff.id !== args.handoffOpId) {
      return "finalized";
    }
    if (
      handoff.finalizedAt
      || handoff.canonicalSide === "destination"
      || handoff.phase === "cutover_committed"
      || handoff.phase === "cleanup_pending"
      || handoff.phase === "cleanup_failed"
      || handoff.phase === "completed"
    ) {
      return "finalized";
    }
    return "not_finalized";
  } catch {
    return "unknown";
  }
}
