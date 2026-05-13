import { useCallback } from "react";
import {
  buildPendingWorkspaceUiKey,
  type PendingWorkspaceEntry,
} from "@/lib/domain/workspaces/creation/pending-entry";
import { useSessionCreationActions } from "@/hooks/sessions/use-session-creation-actions";
import {
  getWorkspaceSessionRecords,
  patchSessionRecord,
} from "@/stores/sessions/session-records";
import { logLatency } from "@/lib/infra/measurement/debug-latency";

interface PendingWorkspaceSessionMaterializationOptions {
  eventPrefix?: string;
}

export interface PendingWorkspaceSessionMaterializationResult {
  pendingWorkspaceUiKey: string;
  projectedSessionCount: number;
  projectedSessionIds: string[];
}

export function usePendingWorkspaceSessionMaterialization() {
  const { createEmptySessionWithResolvedConfig } = useSessionCreationActions();

  return useCallback((
    entry: PendingWorkspaceEntry,
    workspaceId: string,
    options?: PendingWorkspaceSessionMaterializationOptions,
  ): PendingWorkspaceSessionMaterializationResult => {
    const eventPrefix = options?.eventPrefix ?? "workspace.entry";
    const pendingWorkspaceUiKey = buildPendingWorkspaceUiKey(entry);
    const projectedSessions = Object.values(getWorkspaceSessionRecords(pendingWorkspaceUiKey))
      .filter((session) => !session.materializedSessionId);
    const projectedSessionIds = projectedSessions.map((session) => session.sessionId);

    logLatency(`${eventPrefix}.projected_sessions.detected`, {
      attemptId: entry.attemptId,
      source: entry.source,
      workspaceId,
      pendingWorkspaceUiKey,
      projectedSessionCount: projectedSessions.length,
      projectedSessionIds,
    });

    for (const session of projectedSessions) {
      patchSessionRecord(session.sessionId, { workspaceId });
      logLatency(`${eventPrefix}.projected_session.remapped`, {
        attemptId: entry.attemptId,
        workspaceId,
        pendingWorkspaceUiKey,
        sessionId: session.sessionId,
        agentKind: session.agentKind,
        modelId: session.modelId,
      });
    }

    for (const session of projectedSessions) {
      // Session intents remain the user-visible owner while this background
      // create binds the projected client session to a real runtime session.
      void createEmptySessionWithResolvedConfig({
        clientSessionId: session.sessionId,
        workspaceId,
        agentKind: session.agentKind,
        modelId: session.modelId ?? session.agentKind,
        modeId: session.modeId ?? undefined,
        reuseInFlightEmptySession: false,
        preserveProjectedSessionOnCreateFailure: true,
      }).then((clientSessionId) => {
        logLatency(`${eventPrefix}.projected_session_create_completed`, {
          attemptId: entry.attemptId,
          workspaceId,
          sessionId: session.sessionId,
          returnedClientSessionId: clientSessionId,
        });
      }).catch((error) => {
        const message = error instanceof Error
          ? error.message
          : "Failed to start projected chat session.";
        logLatency(`${eventPrefix}.projected_session_create_failed`, {
          attemptId: entry.attemptId,
          workspaceId,
          sessionId: session.sessionId,
          errorMessage: message,
        });
      });
    }

    return {
      pendingWorkspaceUiKey,
      projectedSessionCount: projectedSessions.length,
      projectedSessionIds,
    };
  }, [createEmptySessionWithResolvedConfig]);
}
