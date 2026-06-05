import type { SessionEventEnvelope } from "@anyharness/sdk";
import type { DevSSEEventStatus } from "@/lib/infra/debug/dev-sse-event-record";

type DevTranscriptPhaseKind =
  | "turn"
  | "assistant_message"
  | "reasoning"
  | "tool_invocation"
  | "user_message"
  | "other_item"
  | "other_event";

type DevTranscriptPhaseRecord = {
  sessionId: string;
  recordedAt: string;
  status: DevSSEEventStatus;
  seq: number;
  eventTimestamp: string;
  eventType: string;
  turnId: string | null;
  itemId: string | null;
  phaseKind: DevTranscriptPhaseKind;
  phaseState: "started" | "delta" | "completed" | "ended" | "event" | "ignored";
  previousEventType: string | null;
  previousPhaseKind: DevTranscriptPhaseKind | null;
  msSincePreviousEvent: number | null;
  itemDurationMs: number | null;
  sourceAgentKind: string | null;
  itemKind: string | null;
  itemStatus: string | null;
  nativeToolName: string | null;
  title: string | null;
  isTransient: boolean | null;
};

type DevTranscriptPhaseItemState = {
  startedAt: string;
  kind: string | null;
  sourceAgentKind: string | null;
  nativeToolName: string | null;
  title: string | null;
  isTransient: boolean | null;
};

type DevTranscriptPhaseSessionState = {
  previousEventTimestamp: string | null;
  previousEventType: string | null;
  previousPhaseKind: DevTranscriptPhaseKind | null;
  lastSourceAgentKind: string | null;
  itemsById: Record<string, DevTranscriptPhaseItemState>;
};

export function logDevTranscriptPhaseEvent(
  sessionId: string,
  envelope: SessionEventEnvelope,
  status: DevSSEEventStatus,
): void {
  if (!import.meta.env.DEV) {
    return;
  }

  const debugGlobal = globalThis as typeof globalThis & {
    __ANYHARNESS_TRANSCRIPT_PHASES__?: DevTranscriptPhaseRecord[];
    __ANYHARNESS_TRANSCRIPT_PHASE_STATE__?: Record<string, DevTranscriptPhaseSessionState>;
    __ANYHARNESS_TRANSCRIPT_PHASE_CONSOLE__?: boolean;
  };
  const stateBySession = debugGlobal.__ANYHARNESS_TRANSCRIPT_PHASE_STATE__ ?? {};
  const state = stateBySession[sessionId] ?? createDevTranscriptPhaseSessionState();
  stateBySession[sessionId] = state;
  debugGlobal.__ANYHARNESS_TRANSCRIPT_PHASE_STATE__ = stateBySession;

  const metadata = describeDevTranscriptPhase(envelope, state);
  const mutatesTimeline = status === "applied";
  const record: DevTranscriptPhaseRecord = {
    sessionId,
    recordedAt: new Date().toISOString(),
    status,
    seq: envelope.seq,
    eventTimestamp: envelope.timestamp,
    eventType: envelope.event.type,
    turnId: envelope.turnId ?? null,
    itemId: envelope.itemId ?? null,
    phaseKind: metadata.phaseKind,
    phaseState: mutatesTimeline ? metadata.phaseState : "ignored",
    previousEventType: state.previousEventType,
    previousPhaseKind: state.previousPhaseKind,
    msSincePreviousEvent: mutatesTimeline
      ? diffIsoMs(envelope.timestamp, state.previousEventTimestamp)
      : null,
    itemDurationMs: mutatesTimeline ? metadata.itemDurationMs : null,
    sourceAgentKind: metadata.sourceAgentKind ?? state.lastSourceAgentKind,
    itemKind: metadata.itemKind,
    itemStatus: metadata.itemStatus,
    nativeToolName: metadata.nativeToolName,
    title: metadata.title,
    isTransient: metadata.isTransient,
  };

  const existing = debugGlobal.__ANYHARNESS_TRANSCRIPT_PHASES__ ?? [];
  debugGlobal.__ANYHARNESS_TRANSCRIPT_PHASES__ = [...existing.slice(-999), record];
  if (debugGlobal.__ANYHARNESS_TRANSCRIPT_PHASE_CONSOLE__ === true) {
    console.debug("[transcript-phase]", record);
  }

  if (mutatesTimeline) {
    updateDevTranscriptPhaseState(state, envelope, metadata);
  }
}

function createDevTranscriptPhaseSessionState(): DevTranscriptPhaseSessionState {
  return {
    previousEventTimestamp: null,
    previousEventType: null,
    previousPhaseKind: null,
    lastSourceAgentKind: null,
    itemsById: {},
  };
}

function describeDevTranscriptPhase(
  envelope: SessionEventEnvelope,
  state: DevTranscriptPhaseSessionState,
): Omit<
  DevTranscriptPhaseRecord,
  | "sessionId"
  | "recordedAt"
  | "status"
  | "seq"
  | "eventTimestamp"
  | "eventType"
  | "turnId"
  | "itemId"
  | "previousEventType"
  | "previousPhaseKind"
  | "msSincePreviousEvent"
> {
  const event = envelope.event;
  if (event.type === "turn_started") {
    return {
      phaseKind: "turn",
      phaseState: "started",
      itemDurationMs: null,
      sourceAgentKind: state.lastSourceAgentKind,
      itemKind: null,
      itemStatus: null,
      nativeToolName: null,
      title: null,
      isTransient: null,
    };
  }
  if (event.type === "turn_ended") {
    return {
      phaseKind: "turn",
      phaseState: "ended",
      itemDurationMs: null,
      sourceAgentKind: state.lastSourceAgentKind,
      itemKind: null,
      itemStatus: null,
      nativeToolName: null,
      title: null,
      isTransient: null,
    };
  }
  if (event.type === "session_started") {
    return {
      phaseKind: "other_event",
      phaseState: "event",
      itemDurationMs: null,
      sourceAgentKind: event.sourceAgentKind,
      itemKind: null,
      itemStatus: null,
      nativeToolName: null,
      title: null,
      isTransient: null,
    };
  }
  if (event.type === "item_started" || event.type === "item_completed") {
    const item = event.item;
    const previousItem = envelope.itemId ? state.itemsById[envelope.itemId] : null;
    return {
      phaseKind: phaseKindForItemKind(item.kind),
      phaseState: event.type === "item_started" ? "started" : "completed",
      itemDurationMs: event.type === "item_completed"
        ? diffIsoMs(envelope.timestamp, previousItem?.startedAt ?? null)
        : null,
      sourceAgentKind: item.sourceAgentKind,
      itemKind: item.kind,
      itemStatus: item.status,
      nativeToolName: item.nativeToolName ?? previousItem?.nativeToolName ?? null,
      title: item.title ?? previousItem?.title ?? null,
      isTransient: item.isTransient ?? previousItem?.isTransient ?? null,
    };
  }
  if (event.type === "item_delta") {
    const previousItem = envelope.itemId ? state.itemsById[envelope.itemId] : null;
    return {
      phaseKind: phaseKindForItemKind(previousItem?.kind ?? null),
      phaseState: "delta",
      itemDurationMs: null,
      sourceAgentKind: previousItem?.sourceAgentKind ?? state.lastSourceAgentKind,
      itemKind: previousItem?.kind ?? null,
      itemStatus: event.delta.status ?? null,
      nativeToolName: event.delta.nativeToolName ?? previousItem?.nativeToolName ?? null,
      title: event.delta.title ?? previousItem?.title ?? null,
      isTransient: event.delta.isTransient ?? previousItem?.isTransient ?? null,
    };
  }
  return {
    phaseKind: "other_event",
    phaseState: "event",
    itemDurationMs: null,
    sourceAgentKind: state.lastSourceAgentKind,
    itemKind: null,
    itemStatus: null,
    nativeToolName: null,
    title: null,
    isTransient: null,
  };
}

function updateDevTranscriptPhaseState(
  state: DevTranscriptPhaseSessionState,
  envelope: SessionEventEnvelope,
  metadata: Pick<DevTranscriptPhaseRecord, "phaseKind" | "sourceAgentKind">,
): void {
  const event = envelope.event;
  if (metadata.sourceAgentKind) {
    state.lastSourceAgentKind = metadata.sourceAgentKind;
  }
  if (event.type === "item_started" && envelope.itemId) {
    state.itemsById[envelope.itemId] = {
      startedAt: envelope.timestamp,
      kind: event.item.kind,
      sourceAgentKind: event.item.sourceAgentKind,
      nativeToolName: event.item.nativeToolName ?? null,
      title: event.item.title ?? null,
      isTransient: event.item.isTransient ?? null,
    };
  } else if (event.type === "item_delta" && envelope.itemId) {
    const existing = state.itemsById[envelope.itemId];
    if (existing) {
      existing.nativeToolName = event.delta.nativeToolName ?? existing.nativeToolName;
      existing.title = event.delta.title ?? existing.title;
      existing.isTransient = event.delta.isTransient ?? existing.isTransient;
    }
  } else if (event.type === "item_completed" && envelope.itemId) {
    delete state.itemsById[envelope.itemId];
  }
  state.previousEventTimestamp = envelope.timestamp;
  state.previousEventType = envelope.event.type;
  state.previousPhaseKind = metadata.phaseKind;
}

function phaseKindForItemKind(kind: string | null): DevTranscriptPhaseKind {
  switch (kind) {
    case "assistant_message":
      return "assistant_message";
    case "reasoning":
      return "reasoning";
    case "tool_invocation":
      return "tool_invocation";
    case "user_message":
      return "user_message";
    case null:
      return "other_event";
    default:
      return "other_item";
  }
}

function diffIsoMs(later: string, earlier: string | null): number | null {
  if (!earlier) {
    return null;
  }
  const laterMs = Date.parse(later);
  const earlierMs = Date.parse(earlier);
  if (!Number.isFinite(laterMs) || !Number.isFinite(earlierMs)) {
    return null;
  }
  return Math.max(0, Math.round(laterMs - earlierMs));
}
