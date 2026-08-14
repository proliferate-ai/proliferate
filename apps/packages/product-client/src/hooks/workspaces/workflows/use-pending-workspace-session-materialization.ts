import { useCallback } from "react";
import {
  buildPendingWorkspaceUiKey,
  type PendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import { useSessionCreationActions } from "#product/hooks/sessions/workflows/use-session-creation-actions";
import {
  getWorkspaceSessionRecords,
  patchSessionRecord,
} from "#product/stores/sessions/session-records";
import type { SessionRuntimeRecord } from "#product/stores/sessions/session-types";
import type {
  CreateEmptySessionWithResolvedConfigOptions,
} from "#product/hooks/sessions/workflows/session-creation-types";
import { logLatency } from "#product/lib/infra/measurement/measurement-port";
import {
  isProjectedSessionMaterializationCandidate,
} from "#product/lib/domain/sessions/creation/projected-session-materialization";
import {
  isAttemptAttended,
} from "#product/hooks/workspaces/workflows/pending-workspace-attempt-access";

interface PendingWorkspaceSessionMaterializationOptions {
  eventPrefix?: string;
  /**
   * The attendance decision already made for this attempt. Finalization reads
   * attendance once, before it force-selects the real workspace; passing that
   * value here keeps one decision governing the whole finalize + materialize
   * sequence instead of re-reading it after the await (PRO-230).
   */
  attended?: boolean;
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
  activateOnCreate?: boolean;
  createEmptySessionWithResolvedConfig: CreateEmptySessionWithResolvedConfig;
  eventPrefix: string;
  session: SessionRuntimeRecord;
  targetWorkspaceUiKey?: string | null;
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
    activateOnCreate: input.activateOnCreate,
    targetWorkspaceUiKey: input.targetWorkspaceUiKey,
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

    // An unattended attempt still materializes; it just must not steal the
    // active session or write shell intent against the workspace the user is
    // actually looking at. Callers that already decided attendance before an
    // await pass it in, so the decision cannot flip mid-sequence.
    const attended = options?.attended ?? isAttemptAttended(entry.attemptId);
    let materializationStartCount = 0;
    for (const session of projectedSessions) {
      // Session intents remain the user-visible owner while this background
      // create binds the projected client session to a real runtime session.
      if (materializeProjectedSession({
        attemptId: entry.attemptId,
        activateOnCreate: attended,
        createEmptySessionWithResolvedConfig,
        eventPrefix,
        session,
        targetWorkspaceUiKey: attended ? null : workspaceId,
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
      .filter(isProjectedSessionMaterializationCandidate);
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
