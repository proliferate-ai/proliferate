import type {
  PromptOutboxEntry,
  SessionIntent,
  SessionSendPromptIntent,
} from "@/lib/domain/sessions/intents/session-intent-model";

export interface SessionIntentStateShape {
  entriesById: Record<string, SessionIntent>;
  intentIdsByClientSessionId: Record<string, string[]>;
}

export type PromptOutboxStateShape = SessionIntentStateShape;

export function upsertSessionIntent(
  state: SessionIntentStateShape,
  intent: SessionIntent,
): SessionIntentStateShape {
  const existing = state.entriesById[intent.intentId] ?? null;
  const existingOrder = state.intentIdsByClientSessionId[intent.clientSessionId] ?? [];
  const nextOrder = existingOrder.includes(intent.intentId)
    ? existingOrder
    : [...existingOrder, intent.intentId];
  return {
    entriesById: {
      ...state.entriesById,
      [intent.intentId]: existing && sessionIntentEqual(existing, intent)
        ? existing
        : intent,
    },
    intentIdsByClientSessionId: {
      ...state.intentIdsByClientSessionId,
      [intent.clientSessionId]: nextOrder,
    },
  };
}

export function patchSessionIntent(
  state: SessionIntentStateShape,
  intentId: string,
  patch: Partial<SessionIntent>,
): SessionIntentStateShape {
  const existing = state.entriesById[intentId];
  if (!existing) {
    return state;
  }
  const next = {
    ...existing,
    ...patch,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
  } as SessionIntent;
  if (sessionIntentEqual(existing, next)) {
    return state;
  }
  return {
    ...state,
    entriesById: {
      ...state.entriesById,
      [intentId]: next,
    },
  };
}

export function removeSessionIntent(
  state: SessionIntentStateShape,
  intentId: string,
): SessionIntentStateShape {
  const existing = state.entriesById[intentId];
  if (!existing) {
    return state;
  }
  const { [intentId]: _removed, ...entriesById } = state.entriesById;
  const currentOrder = state.intentIdsByClientSessionId[existing.clientSessionId] ?? [];
  const nextOrder = currentOrder.filter((id) => id !== intentId);
  return {
    entriesById,
    intentIdsByClientSessionId: {
      ...state.intentIdsByClientSessionId,
      [existing.clientSessionId]: nextOrder,
    },
  };
}

export function bindSessionIntentMaterialization(
  state: SessionIntentStateShape,
  clientSessionId: string,
  materializedSessionId: string,
): SessionIntentStateShape {
  const intentIds = state.intentIdsByClientSessionId[clientSessionId] ?? [];
  if (intentIds.length === 0) {
    return state;
  }
  let changed = false;
  const entriesById = { ...state.entriesById };
  const updatedAt = new Date().toISOString();
  for (const intentId of intentIds) {
    const intent = entriesById[intentId];
    if (!intent || intent.materializedSessionId === materializedSessionId) {
      continue;
    }
    changed = true;
    entriesById[intentId] = {
      ...intent,
      materializedSessionId,
      updatedAt,
    } as SessionIntent;
  }
  return changed ? { ...state, entriesById } : state;
}

export function sessionIntentsForSession(
  state: SessionIntentStateShape,
  clientSessionId: string | null | undefined,
): SessionIntent[] {
  if (!clientSessionId) {
    return [];
  }
  return (state.intentIdsByClientSessionId[clientSessionId] ?? [])
    .map((intentId) => state.entriesById[intentId])
    .filter((intent): intent is SessionIntent => !!intent);
}

export function promptIntentsForSession(
  state: SessionIntentStateShape,
  clientSessionId: string | null | undefined,
): SessionSendPromptIntent[] {
  return sessionIntentsForSession(state, clientSessionId)
    .filter((intent): intent is SessionSendPromptIntent => intent.kind === "send_prompt");
}

export const upsertPromptOutboxEntry = upsertSessionIntent;
export const patchPromptOutboxEntry = patchSessionIntent;
export const removePromptOutboxEntry = removeSessionIntent;
export const bindOutboxSessionMaterialization = bindSessionIntentMaterialization;
export const outboxEntriesForSession = promptIntentsForSession;

function sessionIntentEqual(a: SessionIntent, b: SessionIntent): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

export function getPromptEntryByPromptId(
  state: SessionIntentStateShape,
  clientPromptId: string | null | undefined,
): PromptOutboxEntry | null {
  if (!clientPromptId) {
    return null;
  }
  const intent = state.entriesById[clientPromptId];
  return intent?.kind === "send_prompt" ? intent : null;
}
