import type { CloudPendingInteraction } from "@proliferate/cloud-sdk";
import type { SessionViewState } from "@proliferate/product-domain/sessions/activity";

export function resolveCloudTranscriptSessionViewState(input: {
  status: string | null;
  pendingInteractions: readonly CloudPendingInteraction[];
  isStreaming: boolean;
}): SessionViewState {
  if (input.pendingInteractions.some((interaction) => interaction.status === "pending")) {
    return "needs_input";
  }
  if (input.status === "errored" || input.status === "failed") {
    return "errored";
  }
  if (input.status === "closed") {
    return "closed";
  }
  if (
    input.isStreaming
    || input.status === "starting"
    || input.status === "running"
    || input.status === "queued"
  ) {
    return "working";
  }
  return "idle";
}
