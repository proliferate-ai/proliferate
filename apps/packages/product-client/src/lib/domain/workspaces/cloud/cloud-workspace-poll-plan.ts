import type { CloudWorkspaceSummary } from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";
import type { PendingWorkspaceEntry } from "#product/lib/domain/workspaces/creation/pending-entry";
import { isCloudWorkspaceId } from "#product/lib/domain/workspaces/cloud/cloud-ids";
import {
  type CloudWorkspaceStatusFields,
  isCloudWorkspacePostReadyPending,
  isCloudWorkspaceTerminallyUnavailable,
  resolveCloudWorkspaceStatus,
  shouldPollCloudWorkspaceForUpdates,
} from "#product/lib/domain/workspaces/cloud/cloud-workspace-status";

/** What one tick should do about one parked attempt. */
export type CloudWorkspacePollAction = "skip" | "fail-cached" | "refresh";

/** What the refreshed workspace says about the attempt that was waiting on it. */
export type CloudWorkspacePollOutcome = "pending" | "ready" | "failed";

export function isAwaitingCloudWorkspaceEntry(
  entry: PendingWorkspaceEntry,
): boolean {
  return entry.stage === "awaiting-cloud-ready" && isCloudWorkspaceId(entry.workspaceId);
}

/**
 * A cached record is trusted only to stop work early: a failed provision needs
 * no round trip, while a cached "ready" is still confirmed by a refresh so the
 * finalize runs against the same payload every other path sees.
 */
export function resolveCloudWorkspacePollAction(input: {
  entry: PendingWorkspaceEntry;
  cachedWorkspace: CloudWorkspaceSummary | null;
}): CloudWorkspacePollAction {
  if (!isAwaitingCloudWorkspaceEntry(input.entry)) {
    return "skip";
  }
  const cachedWorkspace = input.cachedWorkspace;
  if (!cachedWorkspace) {
    // The collections cache lags creation, so an attempt whose workspace has
    // not landed in it yet still polls; the refresh fetches by id.
    return "refresh";
  }
  const status = resolveCloudWorkspaceStatus(cachedWorkspace);
  // `lost` and `archived` are as final as `error` for an attempt that never
  // reached ready: refreshing them forever would park the entry and its queued
  // prompt until the hour-long staleness timer (PRO-230 review finding 4).
  if (status === "error" || isCloudWorkspaceTerminallyUnavailable(cachedWorkspace)) {
    return "fail-cached";
  }
  if (shouldPollCloudWorkspaceForUpdates(cachedWorkspace)) {
    return "refresh";
  }
  return status === "ready" ? "refresh" : "skip";
}

export function resolveCloudWorkspacePollOutcome(
  workspace: CloudWorkspaceSummary,
): CloudWorkspacePollOutcome {
  if (
    resolveCloudWorkspaceStatus(workspace) === "error"
    || isCloudWorkspaceTerminallyUnavailable(workspace)
  ) {
    return "failed";
  }
  if (resolveCloudWorkspaceStatus(workspace) === "ready" && !isCloudWorkspacePostReadyPending(workspace)) {
    return "ready";
  }
  return "pending";
}

export function resolveCloudWorkspaceFailureMessage(
  workspace: CloudWorkspaceStatusFields & Pick<CloudWorkspaceSummary, "lastError" | "statusDetail">,
): string {
  const reportedMessage = workspace.lastError ?? workspace.statusDetail;
  if (reportedMessage) {
    return reportedMessage;
  }
  // A terminal status usually carries no error text of its own, so say what
  // happened instead of claiming a provisioning error.
  switch (resolveCloudWorkspaceStatus(workspace)) {
    case "lost":
      return "Cloud workspace was lost before it became ready.";
    case "archived":
      return "Cloud workspace was archived before it became ready.";
    default:
      return "Cloud workspace provisioning failed.";
  }
}

export interface CloudWorkspacePollBatch<T> {
  batch: readonly T[];
  nextCursor: number;
}

const EMPTY_POLL_BATCH: readonly never[] = [];

/**
 * Rotates through the parked attempts so a per-tick cap bounds concurrent
 * refreshes without starving the attempts past the cap: the cursor carries
 * over, so the fourth launch is polled on the next tick rather than never.
 */
export function selectCloudWorkspacePollBatch<T>(
  candidates: readonly T[],
  cursor: number,
  limit: number,
): CloudWorkspacePollBatch<T> {
  if (candidates.length === 0 || limit <= 0) {
    return { batch: EMPTY_POLL_BATCH, nextCursor: 0 };
  }
  const size = Math.min(limit, candidates.length);
  const start = ((cursor % candidates.length) + candidates.length) % candidates.length;
  const batch: T[] = [];
  for (let offset = 0; offset < size; offset += 1) {
    batch.push(candidates[(start + offset) % candidates.length] as T);
  }
  return { batch, nextCursor: (start + size) % candidates.length };
}
