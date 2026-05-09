import type { PromptOutboxEntry } from "@/lib/domain/chat/outbox/prompt-outbox-model";

export interface PromptOutboxStateShape {
  entriesByPromptId: Record<string, PromptOutboxEntry>;
  promptIdsByClientSessionId: Record<string, string[]>;
}

export function upsertPromptOutboxEntry(
  state: PromptOutboxStateShape,
  entry: PromptOutboxEntry,
): PromptOutboxStateShape {
  const existing = state.entriesByPromptId[entry.clientPromptId] ?? null;
  const existingOrder = state.promptIdsByClientSessionId[entry.clientSessionId] ?? [];
  const nextOrder = existingOrder.includes(entry.clientPromptId)
    ? existingOrder
    : [...existingOrder, entry.clientPromptId];
  return {
    entriesByPromptId: {
      ...state.entriesByPromptId,
      [entry.clientPromptId]: existing && promptOutboxEntryEqual(existing, entry)
        ? existing
        : entry,
    },
    promptIdsByClientSessionId: {
      ...state.promptIdsByClientSessionId,
      [entry.clientSessionId]: nextOrder,
    },
  };
}

export function patchPromptOutboxEntry(
  state: PromptOutboxStateShape,
  clientPromptId: string,
  patch: Partial<PromptOutboxEntry>,
): PromptOutboxStateShape {
  const existing = state.entriesByPromptId[clientPromptId];
  if (!existing) {
    return state;
  }
  const next = {
    ...existing,
    ...patch,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
  };
  if (promptOutboxEntryEqual(existing, next)) {
    return state;
  }
  return {
    ...state,
    entriesByPromptId: {
      ...state.entriesByPromptId,
      [clientPromptId]: next,
    },
  };
}

export function removePromptOutboxEntry(
  state: PromptOutboxStateShape,
  clientPromptId: string,
): PromptOutboxStateShape {
  const existing = state.entriesByPromptId[clientPromptId];
  if (!existing) {
    return state;
  }
  const { [clientPromptId]: _removed, ...entriesByPromptId } = state.entriesByPromptId;
  const currentOrder = state.promptIdsByClientSessionId[existing.clientSessionId] ?? [];
  const nextOrder = currentOrder.filter((id) => id !== clientPromptId);
  return {
    entriesByPromptId,
    promptIdsByClientSessionId: {
      ...state.promptIdsByClientSessionId,
      [existing.clientSessionId]: nextOrder,
    },
  };
}

export function bindOutboxSessionMaterialization(
  state: PromptOutboxStateShape,
  clientSessionId: string,
  materializedSessionId: string,
): PromptOutboxStateShape {
  const promptIds = state.promptIdsByClientSessionId[clientSessionId] ?? [];
  if (promptIds.length === 0) {
    return state;
  }
  let changed = false;
  const entriesByPromptId = { ...state.entriesByPromptId };
  const updatedAt = new Date().toISOString();
  for (const promptId of promptIds) {
    const entry = entriesByPromptId[promptId];
    if (!entry || entry.materializedSessionId === materializedSessionId) {
      continue;
    }
    changed = true;
    entriesByPromptId[promptId] = {
      ...entry,
      materializedSessionId,
      updatedAt,
    };
  }
  return changed ? { ...state, entriesByPromptId } : state;
}

export function outboxEntriesForSession(
  state: PromptOutboxStateShape,
  clientSessionId: string | null | undefined,
): PromptOutboxEntry[] {
  if (!clientSessionId) {
    return [];
  }
  return (state.promptIdsByClientSessionId[clientSessionId] ?? [])
    .map((promptId) => state.entriesByPromptId[promptId])
    .filter((entry): entry is PromptOutboxEntry => !!entry);
}

function promptOutboxEntryEqual(a: PromptOutboxEntry, b: PromptOutboxEntry): boolean {
  return a === b
    || (
      a.clientPromptId === b.clientPromptId
      && a.retryOfPromptId === b.retryOfPromptId
      && a.clientSessionId === b.clientSessionId
      && a.materializedSessionId === b.materializedSessionId
      && a.workspaceId === b.workspaceId
      && a.text === b.text
      && a.blocks === b.blocks
      && a.attachmentSnapshots === b.attachmentSnapshots
      && a.contentParts === b.contentParts
      && a.promptProvenance === b.promptProvenance
      && a.queuedSeq === b.queuedSeq
      && a.placement === b.placement
      && a.deliveryState === b.deliveryState
      && a.latencyFlowId === b.latencyFlowId
      && a.errorMessage === b.errorMessage
      && a.createdAt === b.createdAt
      && a.updatedAt === b.updatedAt
      && a.dispatchedAt === b.dispatchedAt
      && a.acceptedAt === b.acceptedAt
      && a.echoedAt === b.echoedAt
    );
}
