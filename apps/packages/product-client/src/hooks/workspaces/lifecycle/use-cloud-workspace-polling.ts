import { useCallback, useEffect, useMemo, useRef } from "react";
import { cadence } from "@proliferate/design/cadence";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { pendingWorkspaceEntries } from "#product/lib/domain/workspaces/creation/pending-entry-registry";
import type { PendingWorkspaceEntry } from "#product/lib/domain/workspaces/creation/pending-entry";
import type { CloudWorkspaceSummary } from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";
import { useWorkspaces } from "#product/hooks/workspaces/cache/use-workspaces";
import { useCloudWorkspaceActions } from "#product/hooks/cloud/workflows/use-cloud-workspace-actions";
import { useWorkspaceSelection } from "#product/hooks/workspaces/workflows/selection/use-workspace-selection";
import { buildWorkspaceArrivalEvent } from "#product/lib/domain/workspaces/creation/arrival";
import {
  usePendingWorkspaceSessionMaterialization,
} from "#product/hooks/workspaces/workflows/use-pending-workspace-session-materialization";
import {
  resolveActiveProjectedSessionForPendingWorkspace,
} from "#product/hooks/workspaces/workflows/pending-workspace-projected-session";
import {
  getPendingWorkspaceEntry,
  isAttemptAttended,
  patchAttempt,
} from "#product/hooks/workspaces/workflows/pending-workspace-attempt-access";
import {
  notifyUnattendedPendingWorkspaceFailure,
} from "#product/hooks/workspaces/workflows/pending-workspace-failure-notice";
import {
  resolveCloudWorkspaceFailureMessage,
  isAwaitingCloudWorkspaceEntry,
  resolveCloudWorkspacePollAction,
  resolveCloudWorkspacePollOutcome,
  selectCloudWorkspacePollBatch,
} from "#product/lib/domain/workspaces/cloud/cloud-workspace-poll-plan";
import { parseCloudWorkspaceSyntheticId } from "#product/lib/domain/workspaces/cloud/cloud-ids";
import { resolveCloudWorkspaceStatus } from "#product/lib/domain/workspaces/cloud/cloud-workspace-status";
import { trackWorkspaceInteraction } from "#product/stores/preferences/workspace-ui-store";
import {
  elapsedMs,
  elapsedSince,
  logLatency,
  startLatencyTimer,
} from "#product/lib/infra/measurement/measurement-port";

const EMPTY_AWAITING_ENTRIES: readonly PendingWorkspaceEntry[] = [];

/**
 * Every attempt parked on cloud provisioning, attended or not: this loop drives
 * all of them so a launch completes while the user is elsewhere (PRO-230).
 *
 * It lives here rather than beside the other pending-entry readers because it
 * is the only consumer, and those readers are reached from the signed-out
 * shell's eager graph — keeping this hook (and the poll plan it filters with)
 * out of that module keeps the poll plan out of the login first-load chunk.
 */
function useAwaitingCloudWorkspaceEntries(): readonly PendingWorkspaceEntry[] {
  const registry = useSessionSelectionStore((state) => state.pendingWorkspaces);
  return useMemo(() => {
    const entries = pendingWorkspaceEntries(registry).filter(isAwaitingCloudWorkspaceEntry);
    return entries.length > 0 ? entries : EMPTY_AWAITING_ENTRIES;
  }, [registry]);
}

// Was a raw 3000ms literal. Snapped up to `cadence.standardMs` (5s): a
// parked cloud-workspace launch is a multi-second-to-minutes provisioning
// operation batched across every parked attempt per tick, so 2s of extra
// latency per tick is inconsequential, and the ADR ruling forbids snapping
// down (tightening) to `cadence.fastMs` (UX Latency + Transitions ADR §4.7,
// Rung 6, Q8).
const CLOUD_WORKSPACE_POLL_INTERVAL_MS = cadence.standardMs;
/**
 * Per tick, not in total: the loop rotates through the parked attempts, so a
 * burst of launches cannot fan out into one refresh per launch per tick.
 */
const CLOUD_WORKSPACE_POLL_BATCH_SIZE = 3;

const EMPTY_CLOUD_WORKSPACES: readonly CloudWorkspaceSummary[] = [];

function findCloudWorkspace(
  cloudWorkspaces: readonly CloudWorkspaceSummary[],
  workspaceId: string,
): CloudWorkspaceSummary | null {
  const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(workspaceId);
  if (!cloudWorkspaceId) {
    return null;
  }
  return cloudWorkspaces.find((workspace) => workspace.id === cloudWorkspaceId) ?? null;
}

/**
 * Drives every attempt parked at `awaiting-cloud-ready`, not just the selected
 * one. A cloud launch the user switched away from finishes behind them: it
 * provisions, materializes, and clears its own entry without moving selection
 * or the active session (PRO-230).
 *
 * Residency requirement: this must be mounted by `ProductLifecycleRoot`, beside
 * `useHomeDeferredLaunchRunner`, and nowhere inside the workspace shell. The
 * shell unmounts whenever nothing is selected — which is exactly where Home,
 * Workflows and Workspaces put the user, since `goToTopLevelRoute` and
 * `returnHome` null both selection ids. Mounted under the shell, every parked
 * attempt would stop being polled the moment the user sits on Home, while the
 * resident deferred-launch runner still promotes off the collections
 * self-refetch and sends the prompt against an entry nothing will finalize
 * (PRO-230 review finding 1).
 */
export function useCloudWorkspacePolling() {
  const awaitingEntries = useAwaitingCloudWorkspaceEntries();
  const { data: workspaceCollections } = useWorkspaces();
  const { refreshCloudWorkspace } = useCloudWorkspaceActions();
  const { selectWorkspace } = useWorkspaceSelection();
  const materializePendingWorkspaceSessions = usePendingWorkspaceSessionMaterialization();
  const clearPendingWorkspaceEntry = useSessionSelectionStore((state) => state.clearPendingWorkspaceEntry);
  const setWorkspaceArrivalEvent = useSessionSelectionStore((state) => state.setWorkspaceArrivalEvent);

  // The tick reads the newest attempt list and the newest cloud records rather
  // than closing over them, so a status change cannot restart the interval
  // mid-flight.
  const awaitingEntriesRef = useRef<readonly PendingWorkspaceEntry[]>(awaitingEntries);
  awaitingEntriesRef.current = awaitingEntries;
  const cloudWorkspacesRef = useRef<readonly CloudWorkspaceSummary[]>(EMPTY_CLOUD_WORKSPACES);
  cloudWorkspacesRef.current = workspaceCollections?.cloudWorkspaces ?? EMPTY_CLOUD_WORKSPACES;
  const pollCursorRef = useRef(0);

  const failAwaitingEntry = useCallback((
    entry: PendingWorkspaceEntry,
    workspaceId: string,
    errorMessage: string,
  ) => {
    patchAttempt(entry.attemptId, {
      stage: "failed",
      workspaceId,
      request: { kind: "select-existing", workspaceId },
      errorMessage,
    });
    logLatency("workspace.cloud_polling.failed", {
      workspaceId,
      pendingAttemptId: entry.attemptId,
      errorMessage,
    });
    // An unattended provisioning failure has no shell to render into, so it
    // lands on the attempt's own sidebar row plus one toast, exactly as a
    // create-time failure does.
    notifyUnattendedPendingWorkspaceFailure(entry, errorMessage);
  }, []);

  const finalizeAwaitingEntry = useCallback(async (
    attemptId: string,
    workspaceId: string,
  ) => {
    const entry = getPendingWorkspaceEntry(attemptId);
    if (!entry || entry.stage !== "awaiting-cloud-ready") {
      return;
    }
    // Attendance is read once, before the force-selection below moves
    // selection onto the real workspace and makes every later read look
    // attended.
    const attended = isAttemptAttended(attemptId);
    patchAttempt(attemptId, { workspaceId, errorMessage: null });
    logLatency("workspace.cloud_polling.ready_selection.start", {
      workspaceId,
      pendingAttemptId: attemptId,
      attended,
    });

    if (attended) {
      const initialActiveSessionId = resolveActiveProjectedSessionForPendingWorkspace(
        workspaceId,
        entry,
      );
      try {
        await selectWorkspace(workspaceId, {
          force: true,
          preservePending: true,
          ...(initialActiveSessionId ? { initialActiveSessionId } : {}),
        });
      } catch (error) {
        const current = getPendingWorkspaceEntry(attemptId);
        if (current && current.stage !== "failed") {
          failAwaitingEntry(
            current,
            workspaceId,
            error instanceof Error ? error.message : "Failed to connect the cloud workspace.",
          );
        }
        return;
      }
    }

    const current = getPendingWorkspaceEntry(attemptId);
    if (!current || current.stage !== "awaiting-cloud-ready") {
      return;
    }
    const projectedSessionMaterialization = materializePendingWorkspaceSessions(
      current,
      workspaceId,
      { eventPrefix: "workspace.cloud_polling", attended },
    );
    trackWorkspaceInteraction(workspaceId, new Date().toISOString());
    clearPendingWorkspaceEntry(attemptId);
    if (attended) {
      setWorkspaceArrivalEvent(buildWorkspaceArrivalEvent({
        workspaceId,
        source: current.source,
        setupScript: current.setupScript,
        baseBranchName: current.baseBranchName,
      }));
    }
    logLatency("workspace.cloud_polling.ready", {
      workspaceId,
      pendingAttemptId: attemptId,
      attended,
      totalElapsedMs: elapsedSince(current.createdAt),
      projectedSessionCount: projectedSessionMaterialization.projectedSessionCount,
      projectedSessionIds: projectedSessionMaterialization.projectedSessionIds,
    });
  }, [
    clearPendingWorkspaceEntry,
    failAwaitingEntry,
    materializePendingWorkspaceSessions,
    selectWorkspace,
    setWorkspaceArrivalEvent,
  ]);

  const pollAwaitingEntry = useCallback(async (attemptId: string) => {
    // Re-read by id: the attempt may have been dismissed, failed, or finalized
    // between the tick being scheduled and it running.
    const entry = getPendingWorkspaceEntry(attemptId);
    const workspaceId = entry?.workspaceId ?? null;
    if (!entry || !workspaceId) {
      return;
    }
    const cachedWorkspace = findCloudWorkspace(cloudWorkspacesRef.current, workspaceId);
    const action = resolveCloudWorkspacePollAction({ entry, cachedWorkspace });
    if (action === "skip") {
      return;
    }
    if (action === "fail-cached" && cachedWorkspace) {
      failAwaitingEntry(entry, workspaceId, resolveCloudWorkspaceFailureMessage(cachedWorkspace));
      return;
    }

    const pollStartedAt = startLatencyTimer();
    logLatency("workspace.cloud_polling.start", {
      workspaceId,
      pendingAttemptId: attemptId,
      status: resolveCloudWorkspaceStatus(cachedWorkspace),
      pendingElapsedMs: elapsedSince(entry.createdAt),
    });

    // Keep polling even if a refresh fails: the next tick retries.
    const workspace = await refreshCloudWorkspace(workspaceId).catch(() => null);
    if (!workspace) {
      return;
    }
    const outcome = resolveCloudWorkspacePollOutcome(workspace);
    logLatency("workspace.cloud_polling.refreshed", {
      workspaceId,
      pendingAttemptId: attemptId,
      outcome,
      pollElapsedMs: elapsedMs(pollStartedAt),
    });

    if (outcome === "failed") {
      const current = getPendingWorkspaceEntry(attemptId);
      if (current && current.stage === "awaiting-cloud-ready") {
        failAwaitingEntry(current, workspaceId, resolveCloudWorkspaceFailureMessage(workspace));
      }
      return;
    }
    if (outcome === "ready") {
      await finalizeAwaitingEntry(attemptId, workspaceId);
    }
  }, [failAwaitingEntry, finalizeAwaitingEntry, refreshCloudWorkspace]);

  // The tick calls the newest poll through a ref rather than depending on it.
  // `pollAwaitingEntry`'s identity chains through the collections cache that
  // every successful poll invalidates, so depending on it would restart the
  // interval on the churn the polling itself causes (PRO-230 review finding 2).
  const pollAwaitingEntryRef = useRef(pollAwaitingEntry);
  pollAwaitingEntryRef.current = pollAwaitingEntry;

  // Restarting on the attempt set alone keeps one interval alive across the
  // status churn the polling itself causes.
  const awaitingAttemptKey = awaitingEntries.map((entry) => entry.attemptId).join("|");
  const lastTickStartedAtRef = useRef(0);

  useEffect(() => {
    if (!awaitingAttemptKey) {
      return;
    }

    let cancelled = false;
    let timer: number | null = null;

    const runTick = async () => {
      lastTickStartedAtRef.current = Date.now();
      const { batch, nextCursor } = selectCloudWorkspacePollBatch(
        awaitingEntriesRef.current,
        pollCursorRef.current,
        CLOUD_WORKSPACE_POLL_BATCH_SIZE,
      );
      pollCursorRef.current = nextCursor;
      await Promise.all(batch.map((entry) => pollAwaitingEntryRef.current(entry.attemptId)));
      if (!cancelled) {
        timer = window.setTimeout(() => {
          void runTick();
        }, CLOUD_WORKSPACE_POLL_INTERVAL_MS);
      }
    };

    // A restart still happens whenever an attempt joins or leaves the set, so
    // the first tick after one is spaced off the previous tick rather than
    // firing immediately: the interval is the floor, restarts included.
    const remainingMs = Math.max(
      0,
      CLOUD_WORKSPACE_POLL_INTERVAL_MS - (Date.now() - lastTickStartedAtRef.current),
    );
    if (remainingMs === 0) {
      void runTick();
    } else {
      timer = window.setTimeout(() => {
        void runTick();
      }, remainingMs);
    }

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [awaitingAttemptKey]);
}
