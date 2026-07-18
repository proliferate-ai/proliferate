import { batchSessionStoreWrites } from "#product/lib/infra/scheduling/react-batching";
import {
  getSessionRecord,
  patchSessionRecord,
  putSessionRecord,
  removeSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionIntentStore } from "#product/stores/sessions/session-intent-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import type { SessionRuntimeRecord } from "#product/stores/sessions/session-types";

export function materializeSessionRecord(
  clientSessionId: string,
  materializedSessionId: string,
  record: SessionRuntimeRecord,
): void {
  batchSessionStoreWrites(() => {
    patchSessionRecord(clientSessionId, {
      ...record,
      sessionId: clientSessionId,
      materializedSessionId,
    });
  });
}

/**
 * A recovered empty-session create is the one materialization path that begins
 * in a fresh renderer with a durable client alias. Once its caller-selected
 * runtime id is acknowledged, that alias has no remaining ownership: promote
 * the directory, transcript, queued intents, and active selection together so
 * the renderer converges to the same identity a normal reload would expose.
 */
export function promoteMaterializedSessionIdentity(clientSessionId: string): string {
  const record = getSessionRecord(clientSessionId);
  const materializedSessionId = record?.materializedSessionId ?? null;
  if (!record || !materializedSessionId || materializedSessionId === clientSessionId) {
    return clientSessionId;
  }
  const authoritativeRecord = getSessionRecord(materializedSessionId);

  batchSessionStoreWrites(() => {
    removeSessionRecord(clientSessionId);
    putSessionRecord(
      authoritativeRecord ?? {
        ...record,
        sessionId: materializedSessionId,
        materializedSessionId,
        transcript: {
          ...record.transcript,
          sessionMeta: {
            ...record.transcript.sessionMeta,
            sessionId: materializedSessionId,
          },
        },
      },
    );
    useSessionIntentStore.getState().reassignClientSession(
      clientSessionId,
      materializedSessionId,
    );
    const selection = useSessionSelectionStore.getState();
    if (selection.activeSessionId === clientSessionId) {
      selection.setActiveSessionId(materializedSessionId);
    }
  });
  return materializedSessionId;
}

export function removeSessionRecordAndClearSelection(sessionId: string): void {
  batchSessionStoreWrites(() => {
    removeSessionRecord(sessionId);
    const selection = useSessionSelectionStore.getState();
    if (selection.activeSessionId === sessionId) {
      selection.setActiveSessionId(null);
    }
  });
}
