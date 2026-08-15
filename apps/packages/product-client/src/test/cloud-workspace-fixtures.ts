import type { CloudWorkspaceSummary } from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";
import {
  buildSubmittingPendingWorkspaceEntry,
  type PendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry";

/**
 * The two shapes every cloud-launch test needs: a cloud workspace record as the
 * collections cache holds it, and a registry entry parked at
 * `awaiting-cloud-ready`. They were copied into each suite that drives a launch
 * (polling, deferred promotion, readiness, poll plan); one definition keeps the
 * default `readyAt`/status pairing consistent across all of them.
 */
export function cloudWorkspaceFixture(
  input: Partial<CloudWorkspaceSummary> & {
    status: CloudWorkspaceSummary["status"];
  },
): CloudWorkspaceSummary {
  return {
    id: input.id ?? "cloud-1",
    displayName: input.displayName ?? "feature-branch",
    repo: {
      provider: "github",
      owner: "proliferate-ai",
      name: "proliferate",
      branch: "feature-branch",
      baseBranch: "main",
    },
    status: input.status,
    workspaceStatus: input.status,
    runtime: undefined,
    statusDetail: input.statusDetail ?? null,
    lastError: input.lastError ?? null,
    templateVersion: null,
    updatedAt: null,
    createdAt: null,
    readyAt: "readyAt" in input
      ? input.readyAt ?? null
      : input.status === "ready"
        ? "2026-04-14T00:00:00Z"
        : null,
    postReadyPhase: input.postReadyPhase ?? "",
    postReadyFilesTotal: 0,
    postReadyFilesApplied: 0,
    postReadyStartedAt: null,
    postReadyCompletedAt: null,
    visibility: "private",
  };
}

export function awaitingCloudWorkspaceEntryFixture(
  attemptId: string,
  workspaceId: string,
): PendingWorkspaceEntry {
  return {
    ...buildSubmittingPendingWorkspaceEntry({
      attemptId,
      selectedWorkspaceId: null,
      source: "cloud-created",
      displayName: "feature-branch",
      repoLabel: "proliferate-ai/proliferate",
      baseBranchName: "main",
      request: { kind: "select-existing", workspaceId },
    }),
    stage: "awaiting-cloud-ready",
    workspaceId,
  };
}
