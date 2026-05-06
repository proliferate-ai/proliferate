import type {
  ContentPart,
  PendingPromptEntry,
  PromptInputBlock,
  PromptProvenance,
  SessionEventEnvelope,
  TranscriptState,
} from "@anyharness/sdk";

export type PromptOutboxDeliveryState =
  | "waiting_for_session"
  | "preparing"
  | "dispatching"
  | "accepted_running"
  | "accepted_queued"
  | "unknown_after_dispatch"
  | "failed_before_dispatch"
  | "cancelled"
  | "echoed_tombstone";

export type PromptOutboxPlacement = "transcript" | "queue";

export interface PromptOutboxEntry {
  clientPromptId: string;
  retryOfPromptId: string | null;
  clientSessionId: string;
  materializedSessionId: string | null;
  workspaceId: string | null;
  text: string;
  blocks: PromptInputBlock[];
  contentParts: ContentPart[];
  promptProvenance: PromptProvenance | null;
  queuedSeq: number | null;
  placement: PromptOutboxPlacement;
  deliveryState: PromptOutboxDeliveryState;
  latencyFlowId: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  dispatchedAt: string | null;
  acceptedAt: string | null;
  echoedAt: string | null;
}

export interface PromptOutboxCreateInput {
  clientPromptId: string;
  retryOfPromptId?: string | null;
  clientSessionId: string;
  materializedSessionId?: string | null;
  workspaceId?: string | null;
  text: string;
  blocks: readonly PromptInputBlock[];
  contentParts?: readonly ContentPart[];
  promptProvenance?: PromptProvenance | null;
  placement?: PromptOutboxPlacement;
  latencyFlowId?: string | null;
  now?: string;
}

export interface PromptOutboxStateShape {
  entriesByPromptId: Record<string, PromptOutboxEntry>;
  promptIdsByClientSessionId: Record<string, string[]>;
}

export function createPromptOutboxEntry(input: PromptOutboxCreateInput): PromptOutboxEntry {
  const now = input.now ?? new Date().toISOString();
  return {
    clientPromptId: input.clientPromptId,
    retryOfPromptId: input.retryOfPromptId ?? null,
    clientSessionId: input.clientSessionId,
    materializedSessionId: input.materializedSessionId ?? null,
    workspaceId: input.workspaceId ?? null,
    text: input.text,
    blocks: input.blocks.map(clonePromptInputBlock),
    contentParts: input.contentParts
      ? input.contentParts.map(cloneContentPart)
      : promptBlocksToContentParts(input.blocks),
    promptProvenance: input.promptProvenance ?? null,
    queuedSeq: null,
    placement: input.placement ?? "transcript",
    deliveryState: "waiting_for_session",
    latencyFlowId: input.latencyFlowId ?? null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    dispatchedAt: null,
    acceptedAt: null,
    echoedAt: null,
  };
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

export function selectNextDispatchableOutboxEntry(
  state: PromptOutboxStateShape,
  clientSessionId: string,
): PromptOutboxEntry | null {
  const promptIds = state.promptIdsByClientSessionId[clientSessionId] ?? [];
  for (const promptId of promptIds) {
    const entry = state.entriesByPromptId[promptId];
    if (!entry) {
      continue;
    }
    if (entry.deliveryState === "waiting_for_session") {
      return entry;
    }
    if (entry.deliveryState === "preparing" || entry.deliveryState === "dispatching") {
      return null;
    }
  }
  return null;
}

export function renderableOutboxEntriesForTranscript(
  entries: readonly PromptOutboxEntry[],
  transcript: TranscriptState,
): PromptOutboxEntry[] {
  if (entries.length === 0) {
    return [];
  }
  const promptIdsToFind = new Set(entries.map((entry) => entry.clientPromptId));
  const echoedPromptIds = collectTranscriptPromptIds(transcript, promptIdsToFind);
  const renderableEntries: PromptOutboxEntry[] = [];
  let hasEarlierBlockingPrompt = false;
  for (const entry of entries) {
    const isEchoed = echoedPromptIds.has(entry.clientPromptId);
    const isFailedBeforeDispatch = entry.deliveryState === "failed_before_dispatch";
    const isTerminal = isOutboxEntryTerminal(entry);
    if (isFailedBeforeDispatch && !isEchoed) {
      renderableEntries.push(entry);
      continue;
    }
    if (
      !hasEarlierBlockingPrompt
      && entry.placement === "transcript"
      && !isTerminal
      && !isEchoed
    ) {
      renderableEntries.push(entry);
    }
    if (!isTerminal && !isEchoed && isOutboxEntryBlockingNewTranscriptPrompt(entry)) {
      hasEarlierBlockingPrompt = true;
    }
  }
  return renderableEntries;
}

export function queuedOutboxEntriesForSession(
  entries: readonly PromptOutboxEntry[],
): PromptOutboxEntry[] {
  return entries.filter((entry) =>
    entry.placement === "queue"
    && (
      entry.deliveryState === "waiting_for_session"
      || entry.deliveryState === "preparing"
      || entry.deliveryState === "dispatching"
      || entry.deliveryState === "accepted_queued"
      || entry.deliveryState === "unknown_after_dispatch"
    )
  );
}

export function resolvePromptOutboxPlacement(input: {
  isSessionBusy: boolean;
  isSessionMaterialized?: boolean;
  existingEntries: readonly PromptOutboxEntry[];
}): PromptOutboxPlacement {
  if (input.isSessionBusy && input.isSessionMaterialized !== false) {
    return "queue";
  }
  return input.existingEntries.some(isOutboxEntryBlockingNewTranscriptPrompt)
    ? "queue"
    : "transcript";
}

export function outboxEntryToPendingPromptEntry(entry: PromptOutboxEntry): PendingPromptEntry {
  return {
    seq: entry.queuedSeq ?? syntheticQueueSeq(entry.clientPromptId),
    promptId: entry.clientPromptId,
    text: entry.text,
    contentParts: entry.contentParts,
    queuedAt: entry.createdAt,
    promptProvenance: entry.promptProvenance,
  };
}

export function reconcileOutboxFromEnvelopes(
  state: PromptOutboxStateShape,
  clientSessionId: string,
  envelopes: readonly SessionEventEnvelope[],
): PromptOutboxStateShape {
  let nextState = state;
  for (const envelope of envelopes) {
    const event = envelope.event;
    if (event.type === "pending_prompt_added") {
      const clientPromptId = event.promptId ?? null;
      if (clientPromptId) {
        nextState = patchPromptOutboxEntry(nextState, clientPromptId, {
          clientPromptId,
          clientSessionId,
          queuedSeq: event.seq,
          placement: "queue",
          deliveryState: "accepted_queued",
          acceptedAt: envelope.timestamp,
          errorMessage: null,
        });
      }
      continue;
    }
    if (event.type === "pending_prompt_updated") {
      const clientPromptId = event.promptId ?? null;
      if (clientPromptId) {
        nextState = patchPromptOutboxEntry(nextState, clientPromptId, {
          text: event.text,
          contentParts: event.contentParts ?? [],
          queuedSeq: event.seq,
          placement: "queue",
          deliveryState: "accepted_queued",
          acceptedAt: envelope.timestamp,
        });
      }
      continue;
    }
    if (event.type === "pending_prompt_removed") {
      const clientPromptId = event.promptId ?? null;
      if (clientPromptId) {
        nextState = patchPromptOutboxEntry(nextState, clientPromptId, {
          deliveryState: event.reason === "executed" ? "echoed_tombstone" : "cancelled",
          echoedAt: event.reason === "executed" ? envelope.timestamp : null,
        });
      }
      continue;
    }
    if (event.type === "item_completed" || event.type === "item_started") {
      const clientPromptId = event.item.kind === "user_message"
        ? event.item.promptId ?? null
        : null;
      if (clientPromptId) {
        nextState = patchPromptOutboxEntry(nextState, clientPromptId, {
          deliveryState: "echoed_tombstone",
          echoedAt: envelope.timestamp,
          errorMessage: null,
        });
      }
    }
  }
  return nextState;
}

export function pruneEchoedOutboxTombstones(
  state: PromptOutboxStateShape,
  nowMs = Date.now(),
  ttlMs = 5_000,
): PromptOutboxStateShape {
  let nextState = state;
  for (const entry of Object.values(state.entriesByPromptId)) {
    if (entry.deliveryState !== "echoed_tombstone" || !entry.echoedAt) {
      continue;
    }
    const echoedAtMs = Date.parse(entry.echoedAt);
    if (Number.isFinite(echoedAtMs) && nowMs - echoedAtMs >= ttlMs) {
      nextState = removePromptOutboxEntry(nextState, entry.clientPromptId);
    }
  }
  return nextState;
}

export function pruneEchoedOutboxTombstonesForTranscript(
  state: PromptOutboxStateShape,
  transcript: TranscriptState,
  nowMs = Date.now(),
  ttlMs = 5_000,
): PromptOutboxStateShape {
  const inProgressPromptIds = collectInProgressTurnPromptIds(transcript);
  let nextState = state;
  for (const entry of Object.values(state.entriesByPromptId)) {
    if (
      entry.deliveryState !== "echoed_tombstone"
      || !entry.echoedAt
      || inProgressPromptIds.has(entry.clientPromptId)
    ) {
      continue;
    }
    const echoedAtMs = Date.parse(entry.echoedAt);
    if (Number.isFinite(echoedAtMs) && nowMs - echoedAtMs >= ttlMs) {
      nextState = removePromptOutboxEntry(nextState, entry.clientPromptId);
    }
  }
  return nextState;
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

export function isOutboxEntryTerminal(entry: PromptOutboxEntry): boolean {
  return entry.deliveryState === "cancelled" || entry.deliveryState === "echoed_tombstone";
}

function isOutboxEntryBlockingNewTranscriptPrompt(entry: PromptOutboxEntry): boolean {
  switch (entry.deliveryState) {
    case "waiting_for_session":
    case "preparing":
    case "dispatching":
    case "accepted_running":
    case "accepted_queued":
    case "unknown_after_dispatch":
      return true;
    case "failed_before_dispatch":
    case "cancelled":
    case "echoed_tombstone":
      return false;
  }
}

function collectTranscriptPromptIds(
  transcript: TranscriptState,
  promptIdsToFind?: ReadonlySet<string>,
): Set<string> {
  const promptIds = new Set<string>();
  if (promptIdsToFind?.size === 0) {
    return promptIds;
  }
  for (const item of Object.values(transcript.itemsById)) {
    if (
      item.kind === "user_message"
      && item.promptId
      && (!promptIdsToFind || promptIdsToFind.has(item.promptId))
    ) {
      promptIds.add(item.promptId);
      if (promptIdsToFind && promptIds.size >= promptIdsToFind.size) {
        break;
      }
    }
  }
  return promptIds;
}

function collectInProgressTurnPromptIds(transcript: TranscriptState): Set<string> {
  const promptIds = new Set<string>();
  for (const turn of Object.values(transcript.turnsById)) {
    if (turn.completedAt) {
      continue;
    }
    for (const itemId of turn.itemOrder) {
      const item = transcript.itemsById[itemId];
      if (item?.kind === "user_message" && item.promptId) {
        promptIds.add(item.promptId);
      }
    }
  }
  return promptIds;
}

function promptBlocksToContentParts(blocks: readonly PromptInputBlock[]): ContentPart[] {
  return blocks.flatMap((block): ContentPart[] => {
    switch (block.type) {
      case "text":
        return block.text.trim() ? [{ type: "text", text: block.text }] : [];
      case "image":
        return [];
      case "resource":
        return [{
          type: "resource",
          uri: block.uri,
          name: block.name,
          mimeType: block.mimeType,
          size: block.size,
          source: block.source,
        }];
      case "plan_reference":
        return [];
      default:
        return [];
    }
  });
}

function clonePromptInputBlock(block: PromptInputBlock): PromptInputBlock {
  return { ...block };
}

function cloneContentPart(part: ContentPart): ContentPart {
  return { ...part };
}

function syntheticQueueSeq(clientPromptId: string): number {
  let hash = 0;
  for (let index = 0; index < clientPromptId.length; index += 1) {
    hash = ((hash << 5) - hash + clientPromptId.charCodeAt(index)) | 0;
  }
  return -Math.abs(hash || 1);
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
