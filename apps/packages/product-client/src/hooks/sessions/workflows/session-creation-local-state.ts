import { batchSessionStoreWrites } from "#product/lib/infra/scheduling/react-batching";
import { replaceSessionIdInOpenShellState } from "#product/hooks/sessions/workflows/session-replacement-shell-preferences";
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
  const materializedAlias = clientSessionId === materializedSessionId
    ? null
    : getSessionRecord(materializedSessionId);
  batchSessionStoreWrites(() => {
    const nextRecord = preserveHydratedAliasTranscript(
      record,
      materializedAlias,
      clientSessionId,
    );
    patchSessionRecord(clientSessionId, {
      ...nextRecord,
      sessionId: clientSessionId,
      materializedSessionId,
    });
    if (!materializedAlias || !getSessionRecord(clientSessionId)) {
      return;
    }

    useSessionIntentStore.getState().reassignClientSession(
      materializedSessionId,
      clientSessionId,
    );
    const selection = useSessionSelectionStore.getState();
    if (selection.activeSessionId === materializedSessionId) {
      selection.setActiveSessionId(clientSessionId);
    }
    replaceSessionIdInOpenShellState({
      replacedSessionId: materializedSessionId,
      replacementSessionId: clientSessionId,
    });
    removeSessionRecord(materializedSessionId);
  });
}

function preserveHydratedAliasTranscript(
  record: SessionRuntimeRecord,
  materializedAlias: SessionRuntimeRecord | null,
  clientSessionId: string,
): SessionRuntimeRecord {
  if (!materializedAlias?.transcriptHydrated) {
    return record;
  }
  return {
    ...record,
    events: materializedAlias.events,
    transcript: {
      ...materializedAlias.transcript,
      sessionMeta: {
        ...materializedAlias.transcript.sessionMeta,
        sessionId: clientSessionId,
      },
    },
    optimisticPrompt: materializedAlias.optimisticPrompt ?? record.optimisticPrompt,
    transcriptHydrated: true,
  };
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
