import { isSessionEmptyWithIntents } from "@/lib/domain/sessions/session-emptiness";
import {
  getSessionRecord,
  putSessionRecord,
  removeSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionIntentStore, getPromptOutboxEntriesForSession } from "@/stores/sessions/session-intent-store";
import { clearViewedSessionErrors } from "@/stores/preferences/workspace-ui-store";
import { useDismissSessionMutation } from "@anyharness/sdk-react";
import { AnyHarnessError } from "@anyharness/sdk";
import {
  commitSupersededSessionCreation,
  rollbackSupersededSessionCreation,
  supersedeInFlightSessionCreation,
} from "@/hooks/sessions/workflows/session-creation-supersession";
import type { ErrorContext } from "@proliferate/product-client/host/product-host";
import {
  clearStagedReplacedClientSessionAlias,
  clearStagedReplacedSessionTombstone,
  commitReplacedSessionTombstone,
  releaseReplacedSessionSuppression,
  retireStagedReplacedClientSessionAlias,
  retireStagedReplacedSessionTombstone,
  stageReplacedClientSessionAlias,
  stageReplacedSessionTombstone,
} from "@/hooks/sessions/workflows/session-replacement-tombstones";
import {
  runTrackedReplacementDismissal,
} from "@/hooks/sessions/workflows/session-replacement-dismissals";

const DISMISS_RETRY_DELAYS_MS = [0, 100, 500] as const;

export interface EmptySessionReplacementDeps {
  closeSessionSlotStream: (sessionId: string) => void;
  removeWorkspaceSessionRecord: (workspaceId: string, sessionId: string) => void;
  dismissSessionMutation: ReturnType<typeof useDismissSessionMutation>;
  /**
   * Narrow exception-capture dependency injected from the calling hook (which
   * reads the product telemetry facade). Keeps this plain workflow vendor-free.
   */
  captureException: (error: unknown, context?: ErrorContext) => void;
}

export interface EmptySessionReplacementTransaction {
  replacedSessionId: string;
  commit: () => Promise<"retired" | "retained">;
  rollback: () => void;
}

/**
 * Begins a replace-in-place transaction for an unused session. The old local
 * record is removed synchronously so the newly activated shell is the only tab,
 * but destructive cleanup and runtime dismissal wait for commit. Rollback puts
 * back the exact captured record and releases any paused materializer.
 */
export function beginEmptySessionReplacement(
  sessionId: string,
  workspaceId: string | null | undefined,
  deps: EmptySessionReplacementDeps,
): EmptySessionReplacementTransaction | null {
  const record = getSessionRecord(sessionId);
  if (!record) {
    return null;
  }

  // Check emptiness including queued prompt intents
  const outboxEntries = getPromptOutboxEntriesForSession(sessionId);
  if (!isSessionEmptyWithIntents(record, outboxEntries.length)) {
    return null;
  }

  // Capture everything needed for exact rollback before hiding the old shell.
  const materializedSessionId = record.materializedSessionId;
  const resolvedWorkspaceId = record.workspaceId ?? workspaceId ?? null;
  // Stage before removing the directory record. That removal is the render
  // signal that disables session-scoped observers while the replacement is
  // pending. Staged suppression is memory-only and cannot trigger background
  // dismissal until the replacement materializes successfully.
  if (materializedSessionId && resolvedWorkspaceId) {
    stageReplacedSessionTombstone(
      resolvedWorkspaceId,
      materializedSessionId,
      [sessionId],
    );
  }
  const stagedClientAlias = !materializedSessionId && resolvedWorkspaceId
    ? stageReplacedClientSessionAlias(resolvedWorkspaceId, sessionId)
    : false;
  supersedeInFlightSessionCreation(sessionId);

  // The replacement shell is already active. Hide only the old local record;
  // intents, errors, query cache, and runtime truth remain untouched until the
  // replacement materializes successfully.
  deps.closeSessionSlotStream(sessionId);
  removeSessionRecord(sessionId);

  const restoreCapturedSession = () => {
    if (materializedSessionId && resolvedWorkspaceId) {
      clearStagedReplacedSessionTombstone(resolvedWorkspaceId, materializedSessionId);
    }
    if (stagedClientAlias && resolvedWorkspaceId) {
      clearStagedReplacedClientSessionAlias(resolvedWorkspaceId, sessionId);
    }
    putSessionRecord({
      ...record,
      // The stream handle was closed when the shell was hidden. Restoring an
      // "open" bit would strand the rolled-back session on a dead handle.
      streamConnectionState: "disconnected",
    });
    rollbackSupersededSessionCreation(sessionId);
  };
  const finalizeRetirement = () => {
    useSessionIntentStore.getState().clearSession(sessionId);
    clearViewedSessionErrors([sessionId]);
    if (resolvedWorkspaceId) {
      deps.removeWorkspaceSessionRecord(
        resolvedWorkspaceId,
        materializedSessionId ?? sessionId,
      );
    }
    commitSupersededSessionCreation(sessionId);
    if (stagedClientAlias && resolvedWorkspaceId) {
      retireStagedReplacedClientSessionAlias(resolvedWorkspaceId, sessionId);
    }
  };

  let state: "pending" | "committing" | "committed" | "rolled_back" | "retained" = "pending";
  let commitPromise: Promise<"retired" | "retained"> | null = null;
  return {
    replacedSessionId: sessionId,
    commit: () => {
      if (commitPromise) {
        return commitPromise;
      }
      if (state !== "pending") {
        return Promise.resolve(state === "committed" ? "retired" : "retained");
      }
      state = "committing";
      commitPromise = (async () => {
        if (!materializedSessionId || !resolvedWorkspaceId) {
          finalizeRetirement();
          state = "committed";
          return "retired";
        }

        const durablySuppressed = commitReplacedSessionTombstone(
          resolvedWorkspaceId,
          materializedSessionId,
          [sessionId],
        );
        const dismiss = () => runTrackedReplacementDismissal({
          workspaceId: resolvedWorkspaceId,
          runtimeSessionId: materializedSessionId,
          run: () => dismissMaterializedSession(
            materializedSessionId,
            resolvedWorkspaceId,
            deps.dismissSessionMutation,
            deps.captureException,
          ),
        });
        if (!durablySuppressed) {
          try {
            await dismiss();
            retireStagedReplacedSessionTombstone(
              resolvedWorkspaceId,
              materializedSessionId,
            );
          } catch {
            releaseReplacedSessionSuppression(
              resolvedWorkspaceId,
              materializedSessionId,
            );
            restoreCapturedSession();
            state = "retained";
            return "retained";
          }
        }

        finalizeRetirement();
        state = "committed";
        if (durablySuppressed) {
          void dismiss().catch(() => undefined);
        }
        return "retired";
      })();
      return commitPromise;
    },
    rollback: () => {
      if (state !== "pending") {
        return;
      }
      state = "rolled_back";
      restoreCapturedSession();
    },
  };
}

async function dismissMaterializedSession(
  materializedSessionId: string,
  workspaceId: string,
  dismissMutation: ReturnType<typeof useDismissSessionMutation>,
  captureException: EmptySessionReplacementDeps["captureException"],
): Promise<void> {
  let lastError: unknown = null;
  for (const delayMs of DISMISS_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
    try {
      await dismissMutation.mutateAsync({
        workspaceId,
        sessionId: materializedSessionId,
      });
      // Keep the tombstone until a subsequent authoritative session list no
      // longer contains this id. A list request that started before dismissal
      // can otherwise refill the cache after local removal and resurrect the
      // retired shell as soon as this mutation resolves.
      return;
    } catch (error) {
      if (error instanceof AnyHarnessError && error.problem.status === 404) {
        // A 404 confirms runtime absence, but an older in-flight list response
        // may still be able to repopulate client cache. The next authoritative
        // list is the safe point to clear the persisted tombstone.
        return;
      }
      lastError = error;
    }
  }
  if (lastError) {
    captureException(lastError, {
      tags: {
        action: "dismiss_replaced_empty_session",
        domain: "sessions",
      },
    });
    throw lastError;
  }
}
