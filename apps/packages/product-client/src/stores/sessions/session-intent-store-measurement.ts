import type {
  SessionIntentStateShape,
} from "#product/domain/sessions/intents/session-intent-state";
import {
  isDebugMeasurementEnabled,
  now as measurementNow,
  recordStoreActionDebugActivity,
} from "#product/lib/infra/measurement/measurement-port";

export function startSessionIntentStoreActionTrace(): number | null {
  return isDebugMeasurementEnabled() ? measurementNow() : null;
}

export function recordSessionIntentStoreAction(
  action: string,
  before: SessionIntentStateShape,
  after: SessionIntentStateShape,
  createMetadata: () => Record<string, unknown>,
  startedAtMs: number | null,
): void {
  if (startedAtMs === null) {
    return;
  }
  const metadata = createMetadata();
  const clientSessionId = typeof metadata.clientSessionId === "string"
    ? metadata.clientSessionId
    : null;
  recordStoreActionDebugActivity({
    label: `session-intent-store.${action}`,
    startedAtMs,
    metadata: {
      ...metadata,
      afterCount: countSessionIntents(after, clientSessionId),
      beforeCount: countSessionIntents(before, clientSessionId),
      totalAfterCount: Object.keys(after.entriesById).length,
      totalBeforeCount: Object.keys(before.entriesById).length,
    },
  });
}

function countSessionIntents(
  state: SessionIntentStateShape,
  clientSessionId: string | null,
): number | null {
  if (!clientSessionId) {
    return null;
  }
  return state.intentIdsByClientSessionId[clientSessionId]?.length ?? 0;
}
