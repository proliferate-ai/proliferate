import type { CloudWorkspaceSummary } from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";
import type { PendingWorkspaceEntry } from "#product/lib/domain/workspaces/creation/pending-entry";
import {
  resolveCloudWorkspacePollOutcome,
} from "#product/lib/domain/workspaces/cloud/cloud-workspace-poll-plan";

/** Whether a deferred launch may send its queued prompt yet. */
export type DeferredLaunchReadiness = "waiting" | "ready" | "failed";

/**
 * Readiness is per launch, never per selection: the polling loop refreshes the
 * launch's own cloud workspace and records the attempt's outcome on its
 * registry entry, and both of those reads work while the user is looking at
 * some other workspace (PRO-230). The entry outranks the workspace record
 * because a failed attempt has already announced itself; the record can lag it.
 */
export function resolveDeferredLaunchReadiness(input: {
  cloudWorkspace: CloudWorkspaceSummary | null;
  pendingEntry: PendingWorkspaceEntry | null;
}): DeferredLaunchReadiness {
  if (input.pendingEntry?.stage === "failed") {
    return "failed";
  }
  if (!input.cloudWorkspace) {
    return "waiting";
  }
  switch (resolveCloudWorkspacePollOutcome(input.cloudWorkspace)) {
    case "ready":
      return "ready";
    case "failed":
      return "failed";
    case "pending":
      return "waiting";
  }
}
