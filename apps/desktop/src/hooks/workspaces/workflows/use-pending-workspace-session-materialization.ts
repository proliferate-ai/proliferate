import { useCallback } from "react";
import {
  buildPendingWorkspaceUiKey,
  type PendingWorkspaceEntry,
} from "@/lib/domain/workspaces/creation/pending-entry";
import { useSessionCreationActions } from "@/hooks/sessions/workflows/use-session-creation-actions";
import {
  getWorkspaceSessionRecords,
  patchSessionRecord,
} from "@/stores/sessions/session-records";
import type { SessionRuntimeRecord } from "@/stores/sessions/session-types";
import type {
  CreateEmptySessionWithResolvedConfigOptions,
} from "@/hooks/sessions/workflows/session-creation-types";
import { logLatency } from "@/lib/infra/measurement/debug-latency";

interface PendingWorkspaceSessionMaterializationOptions {
  eventPrefix?: string;
}

export interface PendingWorkspaceSessionMaterializationResult {
  pendingWorkspaceUiKey: string;
  projectedSessionCount: number;
  projectedSessionIds: string[];
}

type CreateEmptySessionWithResolvedConfig = (
  options: CreateEmptySessionWithResolvedConfigOptions,
) => Promise<string>;

const inFlightProjectedSessionMaterializations = new Set<string>();

function projectedSessionMaterializationKey(workspaceId: string, sessionId: string): string {
  return `${workspaceId}:${sessionId}`;
}

function materializeProjectedSession(input: {
  attemptId?: string | null;
  createEmptySessionWithResolvedConfig: CreateEmptySessionWithResolvedConfig;
  eventPrefix: string;
  session: SessionRuntimeRecord;
  workspaceId: string;
}): boolean {
  if (input.session.materializedSessionId) {
    return false;
  }

  const key = projectedSessionMaterializationKey(input.workspaceId, input.session.sessionId);
  if (inFlightProjectedSessionMaterializations.has(key)) {
    return false;
  }

  inFlightProjectedSessionMaterializations.add(key);
  void input.createEmptySessionWithResolvedConfig({
    clientSessionId: input.session.sessionId,
    workspaceId: input.workspaceId,
    agentKind: input.session.agentKind,
    modelId: input.session.requestedModelId ?? input.session.modelId ?? input.session.agentKind,
    modeId: input.session.modeId ?? undefined,
    reuseInFlightEmptySession: false,
    preserveProjectedSessionOnCreateFailure: true,
  }).then((clientSessionId) => {
    logLatency(`${input.eventPrefix}.projected_session_create_completed`, {
      attemptId: input.attemptId ?? null,
      workspaceId: input.workspaceId,
      sessionId: input.session.sessionId,
      returnedClientSessionId: clientSessionId,
    });
  }).catch((error) => {
    const message = error instanceof Error
      ? error.message
      : "Failed to start projected chat session.";
    logLatency(`${input.eventPrefix}.projected_session_create_failed`, {
      attemptId: input.attemptId ?? null,
      workspaceId: input.workspaceId,
      sessionId: input.session.sessionId,
      errorMessage: message,
    });
  }).finally(() => {
    inFlightProjectedSessionMaterializations.delete(key);
  });
  return true;
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
        requestedModelId: session.requestedModelId,
      });
    }

    let materializationStartCount = 0;
    for (const session of projectedSessions) {
      // Session intents remain the user-visible owner while this background
      // create binds the projected client session to a real runtime session.
      if (materializeProjectedSession({
        attemptId: entry.attemptId,
        createEmptySessionWithResolvedConfig,
        eventPrefix,
        session,
        workspaceId,
      })) {
        materializationStartCount += 1;
      }
    }

    logLatency(`${eventPrefix}.projected_session_create_scheduled`, {
      attemptId: entry.attemptId,
      workspaceId,
      projectedSessionCount: projectedSessions.length,
      materializationStartCount,
    });

    return {
      pendingWorkspaceUiKey,
      projectedSessionCount: projectedSessions.length,
      projectedSessionIds,
    };
  }, [createEmptySessionWithResolvedConfig]);
}

export function useReadyWorkspaceProjectedSessionMaterialization() {
  const { createEmptySessionWithResolvedConfig } = useSessionCreationActions();

  return useCallback((
    workspaceId: string,
    options?: PendingWorkspaceSessionMaterializationOptions,
  ): PendingWorkspaceSessionMaterializationResult => {
    const eventPrefix = options?.eventPrefix ?? "workspace.ready_projected_session";
    const projectedSessions = Object.values(getWorkspaceSessionRecords(workspaceId))
      .filter((session) =>
        !session.materializedSessionId
        && session.sessionRelationship.kind === "pending"
      );
    const projectedSessionIds = projectedSessions.map((session) => session.sessionId);

    let materializationStartCount = 0;
    for (const session of projectedSessions) {
      if (materializeProjectedSession({
        createEmptySessionWithResolvedConfig,
        eventPrefix,
        session,
        workspaceId,
      })) {
        materializationStartCount += 1;
      }
    }

    logLatency(`${eventPrefix}.projected_sessions.detected`, {
      workspaceId,
      projectedSessionCount: projectedSessions.length,
      projectedSessionIds,
      materializationStartCount,
    });

    return {
      pendingWorkspaceUiKey: workspaceId,
      projectedSessionCount: projectedSessions.length,
      projectedSessionIds,
    };
  }, [createEmptySessionWithResolvedConfig]);
}
