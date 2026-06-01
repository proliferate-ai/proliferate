import { getCloudMobilityWorkspaceDetail } from "@proliferate/cloud-sdk/client/mobility";
import type { HandoffFinalizationResolution } from "@/lib/domain/workspaces/mobility/handoff-failure-recovery";

export async function getCloudMobilityWorkspaceHandoffDetail(
  mobilityWorkspaceId: string,
) {
  return getCloudMobilityWorkspaceDetail(mobilityWorkspaceId);
}

export async function resolveHandoffFinalizationAfterAmbiguousCutover(args: {
  mobilityWorkspaceId: string;
  handoffOpId: string;
}): Promise<HandoffFinalizationResolution> {
  try {
    const detail = await getCloudMobilityWorkspaceHandoffDetail(args.mobilityWorkspaceId);
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
