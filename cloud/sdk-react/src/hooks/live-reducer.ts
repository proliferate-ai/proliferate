import type {
  CloudCommandStatusPatch,
  CloudSessionEvent,
  CloudSessionEventsResponse,
  CloudSessionLiveEvent,
  CloudSessionProjectionPatch,
  CloudSessionSnapshot,
  CloudTargetLiveEvent,
  CloudTargetPatch,
  CloudWorkspaceLiveEvent,
  CloudWorkspaceProjectionPatch,
  CloudWorkspaceSnapshot,
} from "@proliferate/cloud-sdk";

export function isCloudHeartbeat(event: unknown): event is { kind: "heartbeat" } {
  return eventKind(event) === "heartbeat";
}

export function isCloudCommandStatusPatch(event: unknown): event is CloudCommandStatusPatch {
  return eventKind(event) === "command_status";
}

export function isCloudSessionSnapshot(event: CloudSessionLiveEvent): event is CloudSessionSnapshot {
  return isRecord(event) && "session" in event && "transcriptItems" in event;
}

export function isCloudWorkspaceSnapshot(
  event: CloudWorkspaceLiveEvent,
): event is CloudWorkspaceSnapshot {
  return isRecord(event) && "workspace" in event && "sessions" in event;
}

export function isCloudTargetSnapshot(
  event: CloudTargetLiveEvent,
): event is Extract<CloudTargetLiveEvent, { target: unknown }> {
  return isRecord(event) && "target" in event && eventKind(event) === undefined;
}

export function isCloudSessionProjectionPatch(
  event: CloudSessionLiveEvent,
): event is CloudSessionProjectionPatch {
  return eventKind(event) === "projection_patch";
}

export function isCloudWorkspaceProjectionPatch(
  event: CloudWorkspaceLiveEvent,
): event is CloudWorkspaceProjectionPatch {
  return eventKind(event) === "workspace_projection_patch";
}

export function isCloudTargetPatch(event: CloudTargetLiveEvent): event is CloudTargetPatch {
  return eventKind(event) === "target_projection_patch";
}

export function reduceSessionSnapshot(
  snapshot: CloudSessionSnapshot | undefined,
  event: CloudSessionProjectionPatch,
): CloudSessionSnapshot | undefined {
  if (!snapshot) {
    return undefined;
  }
  const patch = event.patch;
  return {
    ...snapshot,
    session: patch.session,
    transcriptItems: upsertByKey(
      snapshot.transcriptItems,
      patch.transcriptItem ?? null,
      (item) => item.itemId,
    ),
    pendingInteractions: updatePendingInteractions(
      snapshot.pendingInteractions,
      patch.pendingInteraction ?? null,
    ),
  };
}

export function sessionEventFromProjectionPatch(
  event: CloudSessionProjectionPatch,
): CloudSessionEvent {
  const patch = event.patch;
  return {
    targetId: patch.targetId,
    sessionId: patch.sessionId,
    seq: patch.seq,
    eventType: patch.eventType,
    sourceKind: "live_patch",
    turnId: patch.envelope?.turnId ?? null,
    itemId: patch.envelope?.itemId ?? null,
    occurredAt: patch.envelope?.timestamp ?? patch.session.lastEventAt ?? null,
    payload: null,
    envelope: patch.envelope ?? null,
  };
}

export function upsertSessionEventResponse(
  response: CloudSessionEventsResponse | undefined,
  event: CloudSessionEvent,
): CloudSessionEventsResponse {
  const events = upsertByKey(response?.events ?? [], event, (item) => String(item.seq))
    .sort((left, right) => left.seq - right.seq);
  return {
    events,
    nextCursor: Math.max(response?.nextCursor ?? 0, event.seq),
  };
}

export function reduceWorkspaceSnapshot(
  snapshot: CloudWorkspaceSnapshot | undefined,
  event: CloudWorkspaceProjectionPatch,
): CloudWorkspaceSnapshot | undefined {
  if (!snapshot) {
    return undefined;
  }
  const patch = event.patch;
  return {
    ...snapshot,
    sessions: upsertByKey(snapshot.sessions, patch.session, (session) => session.sessionId),
  };
}

function upsertByKey<T>(
  items: readonly T[],
  nextItem: T | null,
  keyFor: (item: T) => string,
): T[] {
  if (nextItem === null) {
    return [...items];
  }
  const nextKey = keyFor(nextItem);
  let replaced = false;
  const nextItems = items.map((item) => {
    if (keyFor(item) !== nextKey) {
      return item;
    }
    replaced = true;
    return nextItem;
  });
  return replaced ? nextItems : [...nextItems, nextItem];
}

function updatePendingInteractions<
  T extends { requestId: string; status?: string | null },
>(
  items: readonly T[],
  nextItem: T | null,
): T[] {
  if (nextItem === null) {
    return [...items];
  }
  if (nextItem.status !== "pending" && nextItem.status !== "failed") {
    return items.filter((item) => item.requestId !== nextItem.requestId);
  }
  return upsertByKey(items, nextItem, (item) => item.requestId);
}

function eventKind(event: unknown): string | undefined {
  if (!isRecord(event)) {
    return undefined;
  }
  const kind = event.kind;
  return typeof kind === "string" ? kind : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
