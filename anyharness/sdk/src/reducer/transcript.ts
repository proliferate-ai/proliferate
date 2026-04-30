import type {
  ContentPart,
  FileChangeContentPart,
  FileReadContentPart,
  InteractionOutcome,
  InteractionRequestedEvent,
  ItemCompletedEvent,
  ItemDeltaEvent,
  SessionEventEnvelope,
  TranscriptItemPayload,
} from "../types/events.js";
import type {
  AssistantProseItem,
  ErrorItem,
  PendingMcpElicitationInteraction,
  PendingInteraction,
  PendingApproval,
  PendingUserInputInteraction,
  PlanItem,
  ProposedPlanItem,
  ThoughtItem,
  ToolCallSemanticKind,
  ToolCallItem,
  TranscriptItem,
  TranscriptState,
  TurnRecord,
  UnknownItem,
  UserMessageItem,
} from "../types/reducer.js";

type KnownTranscriptItem =
  | UserMessageItem
  | AssistantProseItem
  | ThoughtItem
  | ToolCallItem
  | PlanItem
  | ProposedPlanItem
  | ErrorItem;

export function createTranscriptState(sessionId: string): TranscriptState {
  return {
    sessionMeta: {
      sessionId,
      title: null,
      updatedAt: null,
      nativeSessionId: null,
      sourceAgentKind: null,
    },
    turnOrder: [],
    turnsById: {},
    itemsById: {},
    openAssistantItemId: null,
    openThoughtItemId: null,
    pendingInteractions: [],
    availableCommands: [],
    liveConfig: null,
    currentModeId: null,
    usageState: null,
    unknownEvents: [],
    isStreaming: false,
    lastSeq: 0,
    pendingPrompts: [],
    linkCompletionsByCompletionId: {},
    latestLinkCompletionBySessionLinkId: {},
  };
}

export interface ReduceOptions {
  replayMode?: boolean;
}

export function reduceEvents(
  events: SessionEventEnvelope[],
  sessionId: string,
  options?: ReduceOptions,
): TranscriptState {
  let state = createTranscriptState(sessionId);
  for (const env of events) {
    state = reduceEvent(state, env, options);
  }
  return state;
}

export function reduceEvent(
  state: TranscriptState,
  envelope: SessionEventEnvelope,
  _options?: ReduceOptions,
): TranscriptState {
  const s = { ...state };
  s.lastSeq = Math.max(s.lastSeq, envelope.seq);

  const evt = envelope.event;
  const turnId = envelope.turnId ?? "__implicit__";
  const itemId = envelope.itemId ?? `seq-${envelope.seq}`;
  const ts = envelope.timestamp;

  switch (evt.type) {
    case "session_started":
      s.sessionMeta = {
        ...s.sessionMeta,
        nativeSessionId: evt.nativeSessionId,
        sourceAgentKind: evt.sourceAgentKind,
      };
      break;

    case "session_ended":
      clearPendingInteractions(s, "none");
      s.isStreaming = false;
      break;

    case "turn_started": {
      ensureTurn(s, turnId, ts);
      s.isStreaming = true;
      break;
    }

    case "turn_ended": {
      ensureTurn(s, turnId, ts);
      closeStreamingItems(s);
      const turn = s.turnsById[turnId];
      if (turn) {
        turn.completedAt = ts;
        turn.stopReason = evt.stopReason;
        turn.fileBadges = collectFileBadges(s, turnId);
      }
      s.isStreaming = false;
      break;
    }

    case "item_started": {
      ensureTurn(s, turnId, ts);
      const item = createItemFromPayload(itemId, turnId, evt.item, ts, envelope.seq);
      s.itemsById[itemId] = item;
      addItemToTurn(s, turnId, itemId);
      openStreamingItem(s, itemId, item);
      s.isStreaming = s.isStreaming || item.status === "in_progress";
      break;
    }

    case "item_delta": {
      const existing = s.itemsById[itemId];
      if (!existing || existing.kind === "unknown") {
        recordUnknown(s, envelope, itemId, ts, turnId);
        break;
      }
      const updated = { ...existing };
      applyItemDelta(updated, evt, ts, envelope.seq);
      s.itemsById = { ...s.itemsById, [itemId]: updated };
      syncStreamingPointers(s, itemId, updated);
      break;
    }

    case "item_completed": {
      ensureTurn(s, turnId, ts);
      const existing = s.itemsById[itemId];
      const item = existing && existing.kind !== "unknown"
        ? applyCompletion(existing, evt, ts, envelope.seq)
        : createCompletedItem(itemId, turnId, evt, ts, envelope.seq);
      s.itemsById[itemId] = item;
      addItemToTurn(s, turnId, itemId);
      closeStreamingPointer(s, itemId);
      break;
    }

    case "available_commands_update":
      s.availableCommands = evt.availableCommands;
      break;

    case "current_mode_update":
      s.currentModeId = evt.currentModeId;
      break;

    case "config_option_update":
      s.liveConfig = evt.liveConfig;
      s.currentModeId =
        evt.liveConfig.normalizedControls.mode?.currentValue ?? s.currentModeId;
      break;

    case "session_state_update":
      break;

    case "session_info_update":
      s.sessionMeta = {
        ...s.sessionMeta,
        title: evt.title ?? s.sessionMeta.title,
        updatedAt: evt.updatedAt ?? s.sessionMeta.updatedAt,
      };
      break;

    case "subagent_turn_completed":
    case "session_link_turn_completed": {
      const relation = evt.type === "subagent_turn_completed"
        ? "subagent"
        : evt.relation;
      s.linkCompletionsByCompletionId = {
        ...s.linkCompletionsByCompletionId,
        [evt.completionId]: {
          relation,
          completionId: evt.completionId,
          sessionLinkId: evt.sessionLinkId,
          parentSessionId: evt.parentSessionId,
          childSessionId: evt.childSessionId,
          childTurnId: evt.childTurnId,
          childLastEventSeq: evt.childLastEventSeq,
          outcome: evt.outcome,
          label: evt.label ?? null,
          seq: envelope.seq,
          timestamp: envelope.timestamp,
        },
      };
      s.latestLinkCompletionBySessionLinkId = {
        ...s.latestLinkCompletionBySessionLinkId,
        [evt.sessionLinkId]: evt.completionId,
      };
      break;
    }

    case "review_run_updated":
      break;

    case "usage_update":
      s.usageState = {
        used: evt.used,
        size: evt.size,
        cost: evt.cost ?? null,
      };
      break;

    case "pending_prompt_added":
      s.pendingPrompts = [
        ...s.pendingPrompts,
        {
          seq: evt.seq,
          promptId: evt.promptId ?? null,
          text: evt.text,
          contentParts: normalizeContentParts(evt.contentParts ?? []),
          queuedAt: evt.queuedAt,
          promptProvenance: evt.promptProvenance ?? null,
        },
      ];
      break;

    case "pending_prompt_updated":
      s.pendingPrompts = s.pendingPrompts.map((entry) =>
        entry.seq === evt.seq
          ? {
            ...entry,
            text: evt.text,
            contentParts: normalizeContentParts(evt.contentParts ?? []),
            promptProvenance: evt.promptProvenance ?? entry.promptProvenance,
          }
          : entry,
      );
      break;

    case "pending_prompt_removed":
      s.pendingPrompts = s.pendingPrompts.filter(
        (entry) => entry.seq !== evt.seq,
      );
      break;

    case "interaction_requested":
      applyInteractionRequested(s, evt);
      break;

    case "interaction_resolved":
      applyInteractionResolved(s, evt.requestId, evt.outcome);
      break;

    case "error": {
      ensureTurn(s, turnId, ts);
      closeStreamingItems(s);
      clearPendingInteractions(s, "none");
      const item: ErrorItem = {
        kind: "error",
        itemId,
        turnId,
        status: "failed",
        sourceAgentKind: s.sessionMeta.sourceAgentKind ?? "unknown",
        title: null,
        nativeToolName: null,
        parentToolCallId: null,
        rawInput: undefined,
        rawOutput: undefined,
        contentParts: [],
        timestamp: ts,
        messageId: null,
        startedSeq: envelope.seq,
        lastUpdatedSeq: envelope.seq,
        completedSeq: envelope.seq,
        completedAt: ts,
        message: evt.message,
        code: evt.code ?? null,
        details: evt.details ?? null,
      };
      s.itemsById[itemId] = item;
      addItemToTurn(s, turnId, itemId);
      s.isStreaming = false;
      break;
    }

    default:
      recordUnknown(s, envelope, itemId, ts, envelope.turnId ?? null);
      break;
  }

  return s;
}

function createCompletedItem(
  itemId: string,
  turnId: string,
  evt: ItemCompletedEvent,
  ts: string,
  seq: number,
): KnownTranscriptItem {
  const item = createItemFromPayload(itemId, turnId, evt.item, ts, seq);
  markCompleted(item, ts, seq);
  return item;
}

function applyCompletion(
  item: KnownTranscriptItem,
  evt: ItemCompletedEvent,
  ts: string,
  seq: number,
): KnownTranscriptItem {
  applyPayload(item, evt.item, ts, seq);
  markCompleted(item, ts, seq);
  return item;
}

function markCompleted(item: KnownTranscriptItem, ts: string, seq: number): void {
  item.status = item.status === "failed" ? "failed" : "completed";
  item.completedAt = ts;
  item.lastUpdatedSeq = seq;
  item.completedSeq = seq;
  if (item.kind === "user_message" || item.kind === "assistant_prose" || item.kind === "thought") {
    item.isStreaming = false;
  }
}

function applyItemDelta(item: KnownTranscriptItem, evt: ItemDeltaEvent, ts: string, seq: number): void {
  const delta = evt.delta;
  item.lastUpdatedSeq = seq;
  if (delta.status) {
    item.status = delta.status;
    if (item.kind === "user_message" || item.kind === "assistant_prose" || item.kind === "thought") {
      item.isStreaming = delta.status === "in_progress";
    }
  }
  if (delta.title !== undefined && delta.title !== null) {
    item.title = delta.title;
  }
  if (delta.nativeToolName !== undefined && delta.nativeToolName !== null) {
    item.nativeToolName = delta.nativeToolName;
  }
  if (delta.parentToolCallId !== undefined) {
    item.parentToolCallId = delta.parentToolCallId ?? null;
  }
  if (delta.rawInput !== undefined) {
    item.rawInput = delta.rawInput;
  }
  if (delta.rawOutput !== undefined) {
    item.rawOutput = delta.rawOutput;
  }
  if (delta.isTransient !== undefined && delta.isTransient !== null) {
    item.isTransient = delta.isTransient;
  }
  if (delta.appendText) {
    if (item.kind === "user_message" || item.kind === "assistant_prose") {
      item.text += delta.appendText;
      item.isStreaming = true;
      appendToTextContentPart(item, delta.appendText);
    }
  }
  if (delta.appendReasoning && item.kind === "thought") {
    item.text += delta.appendReasoning;
    item.isStreaming = true;
    appendToReasoningContentPart(item, delta.appendReasoning);
  }
  if (delta.replaceContentParts) {
    item.contentParts = mergeContentParts(item.contentParts, delta.replaceContentParts);
  }
  if (delta.appendContentParts) {
    item.contentParts = [
      ...item.contentParts,
      ...normalizeContentParts(delta.appendContentParts),
    ];
  }
  rederiveItem(item);
  if (item.status !== "in_progress" && item.completedAt == null) {
    item.completedAt = ts;
    item.completedSeq = seq;
  }
}

function createItemFromPayload(
  itemId: string,
  turnId: string,
  payload: TranscriptItemPayload,
  ts: string,
  seq: number,
): KnownTranscriptItem {
  const base = {
    itemId,
    turnId,
    status: payload.status,
    sourceAgentKind: payload.sourceAgentKind,
    isTransient: payload.isTransient ?? false,
    messageId: payload.messageId ?? null,
    title: payload.title ?? null,
    nativeToolName: payload.nativeToolName ?? null,
    parentToolCallId: payload.parentToolCallId ?? null,
    rawInput: payload.rawInput,
    rawOutput: payload.rawOutput,
    contentParts: normalizeContentParts(payload.contentParts ?? []),
    timestamp: ts,
    startedSeq: seq,
    lastUpdatedSeq: seq,
    completedSeq: payload.status === "in_progress" ? null : seq,
    completedAt: payload.status === "in_progress" ? null : ts,
  };

  switch (payload.kind) {
    case "user_message":
      return {
        kind: "user_message",
        ...base,
        text: extractText(base.contentParts),
        isStreaming: payload.status === "in_progress",
        promptProvenance: payload.promptProvenance ?? null,
      };

    case "assistant_message":
      return {
        kind: "assistant_prose",
        ...base,
        text: extractText(base.contentParts),
        isStreaming: payload.status === "in_progress",
      };

    case "reasoning":
      return {
        kind: "thought",
        ...base,
        text: extractReasoning(base.contentParts),
        isStreaming: payload.status === "in_progress",
      };

    case "tool_invocation": {
      const toolCallPart = findToolCallPart(base.contentParts);
      return {
        kind: "tool_call",
        ...base,
        title: base.title ?? toolCallPart?.title ?? payload.nativeToolName ?? "Tool call",
        toolCallId: payload.toolCallId ?? toolCallPart?.toolCallId ?? null,
        toolKind: toolCallPart?.toolKind ?? "other",
        semanticKind: deriveToolCallSemanticKind(
          base.contentParts,
          payload.nativeToolName ?? null,
          toolCallPart?.toolKind ?? "other",
          base.title,
        ),
        approvalState: "none",
      };
    }

    case "plan":
      return {
        kind: "plan",
        ...base,
        entries: extractPlanEntries(base.contentParts),
      };

    case "proposed_plan": {
      const plan = extractProposedPlan(base.contentParts);
      if (!plan) {
        return {
          kind: "error",
          ...base,
          message: "Malformed proposed plan",
          code: "MALFORMED_PROPOSED_PLAN",
          details: null,
        };
      }
      return {
        kind: "proposed_plan",
        ...base,
        plan,
        decision: extractLatestProposedPlanDecision(base.contentParts),
      };
    }

    case "error_item":
      return {
        kind: "error",
        ...base,
        message: extractText(base.contentParts) || base.title || "Error",
        code: null,
        details: null,
      };
  }
}

function applyPayload(item: KnownTranscriptItem, payload: TranscriptItemPayload, ts: string, seq: number): void {
  item.status = payload.status;
  item.sourceAgentKind = payload.sourceAgentKind;
  item.isTransient = payload.isTransient ?? item.isTransient;
  item.messageId = payload.messageId ?? item.messageId;
  item.title = payload.title ?? item.title;
  item.nativeToolName = payload.nativeToolName ?? item.nativeToolName;
  item.parentToolCallId = payload.parentToolCallId ?? item.parentToolCallId;
  item.rawInput = payload.rawInput ?? item.rawInput;
  item.rawOutput = payload.rawOutput ?? item.rawOutput;
  item.contentParts = mergeContentParts(item.contentParts, payload.contentParts ?? []);
  if (item.kind === "user_message" && payload.promptProvenance !== undefined) {
    item.promptProvenance = payload.promptProvenance ?? null;
  }
  item.lastUpdatedSeq = seq;
  item.completedAt = payload.status === "in_progress" ? null : ts;
  item.completedSeq = payload.status === "in_progress" ? null : seq;
  if (item.kind === "user_message" || item.kind === "assistant_prose" || item.kind === "thought") {
    item.isStreaming = payload.status === "in_progress";
  }
  rederiveItem(item);
}

function rederiveItem(item: KnownTranscriptItem): void {
  switch (item.kind) {
    case "user_message":
    case "assistant_prose":
      item.text = extractText(item.contentParts) || item.text;
      break;

    case "thought":
      item.text = extractReasoning(item.contentParts) || item.text;
      break;

    case "tool_call": {
      const toolCallPart = findToolCallPart(item.contentParts);
      item.toolCallId = item.toolCallId ?? toolCallPart?.toolCallId ?? null;
      item.toolKind = toolCallPart?.toolKind ?? item.toolKind;
      item.title = item.title ?? toolCallPart?.title ?? item.nativeToolName ?? "Tool call";
      item.semanticKind = deriveToolCallSemanticKind(
        item.contentParts,
        item.nativeToolName,
        item.toolKind,
        item.title,
      );
      break;
    }

    case "plan":
      item.entries = extractPlanEntries(item.contentParts);
      break;

    case "proposed_plan":
      item.decision = extractLatestProposedPlanDecision(item.contentParts);
      break;

    case "error":
      item.message = extractText(item.contentParts) || item.message;
      break;
  }
}

export function selectPendingApprovalInteraction(
  transcript: TranscriptState,
): PendingApproval | null {
  return transcript.pendingInteractions.find((interaction): interaction is PendingApproval =>
    interaction.kind === "permission" && !isPlanOwnedInteraction(transcript, interaction)
  )
    ?? null;
}

export function selectPendingUserInputInteraction(
  transcript: TranscriptState,
): PendingUserInputInteraction | null {
  return transcript.pendingInteractions.find((interaction) => interaction.kind === "user_input")
    ?? null;
}

export function selectPendingMcpElicitationInteraction(
  transcript: TranscriptState,
): PendingMcpElicitationInteraction | null {
  return transcript.pendingInteractions.find((interaction) => interaction.kind === "mcp_elicitation")
    ?? null;
}

export function selectPrimaryPendingInteraction(
  transcript: TranscriptState,
): PendingInteraction | null {
  return transcript.pendingInteractions.find((interaction) =>
    !isPlanOwnedInteraction(transcript, interaction)
  ) ?? null;
}

function applyInteractionRequested(s: TranscriptState, evt: InteractionRequestedEvent): void {
  const toolCallId = evt.source.toolCallId ?? null;
  const basePendingInteraction = {
    requestId: evt.requestId,
    toolCallId,
    toolKind: evt.source.toolKind ?? null,
    toolStatus: evt.source.toolStatus ?? null,
    linkedPlanId: evt.source.linkedPlanId ?? null,
    title: evt.title,
    description: evt.description ?? null,
  };

  let pendingInteraction: PendingInteraction;
  if (evt.kind === "permission" && evt.payload.type === "permission") {
    if (toolCallId) {
      const item = findToolItemByToolCallId(s, toolCallId);
      if (item) item.approvalState = "pending";
    }
    pendingInteraction = {
      ...basePendingInteraction,
      kind: "permission",
      options: evt.payload.options ?? [],
      context: evt.payload.context ?? null,
    };
  } else if (evt.kind === "user_input" && evt.payload.type === "user_input") {
    pendingInteraction = {
      ...basePendingInteraction,
      kind: "user_input",
      questions: evt.payload.questions ?? [],
    };
  } else if (evt.kind === "mcp_elicitation" && evt.payload.type === "mcp_elicitation") {
    pendingInteraction = {
      ...basePendingInteraction,
      kind: "mcp_elicitation",
      mcpElicitation: {
        serverName: evt.payload.serverName,
        mode: evt.payload.mode,
      },
    };
  } else {
    return;
  }

  s.pendingInteractions = [
    ...s.pendingInteractions.filter((entry) => entry.requestId !== evt.requestId),
    pendingInteraction,
  ];
}

function applyInteractionResolved(
  s: TranscriptState,
  requestId: string,
  outcome: InteractionOutcome,
): void {
  const pendingInteraction = s.pendingInteractions.find((entry) => entry.requestId === requestId);
  if (!pendingInteraction) return;

  clearPendingInteraction(s, requestId, approvalStateForOutcome(pendingInteraction, outcome));
}

function clearPendingInteraction(
  s: TranscriptState,
  requestId: string,
  toolApprovalState: ToolCallItem["approvalState"],
): void {
  const pendingInteraction = s.pendingInteractions.find((entry) => entry.requestId === requestId);
  if (pendingInteraction?.toolCallId) {
    const item = findToolItemByToolCallId(s, pendingInteraction.toolCallId);
    if (item) {
      item.approvalState = toolApprovalState;
    }
  }
  s.pendingInteractions = s.pendingInteractions.filter((entry) => entry.requestId !== requestId);
}

function clearPendingInteractions(
  s: TranscriptState,
  toolApprovalState: ToolCallItem["approvalState"],
): void {
  for (const pendingInteraction of s.pendingInteractions) {
    if (pendingInteraction.toolCallId) {
      const item = findToolItemByToolCallId(s, pendingInteraction.toolCallId);
      if (item) {
        item.approvalState = toolApprovalState;
      }
    }
  }
  s.pendingInteractions = [];
}

function approvalStateForOutcome(
  pendingInteraction: PendingInteraction,
  outcome: InteractionOutcome,
): ToolCallItem["approvalState"] {
  if (outcome.outcome !== "selected") {
    return "none";
  }
  if (pendingInteraction.kind !== "permission") {
    return "none";
  }

  const option = pendingInteraction.options.find((entry) => entry.optionId === outcome.optionId);
  switch (option?.kind) {
    case "reject_once":
    case "reject_always":
      return "rejected";
    case "allow_once":
    case "allow_always":
    default:
      return "approved";
  }
}

function findToolItemByToolCallId(
  s: TranscriptState,
  toolCallId: string,
): ToolCallItem | null {
  for (const item of Object.values(s.itemsById)) {
    if (item.kind === "tool_call" && item.toolCallId === toolCallId) return item;
  }
  return null;
}

function ensureTurn(s: TranscriptState, turnId: string, ts: string): TurnRecord {
  if (!s.turnsById[turnId]) {
    s.turnsById[turnId] = {
      turnId,
      itemOrder: [],
      startedAt: ts,
      completedAt: null,
      stopReason: null,
      fileBadges: [],
    };
    s.turnOrder = [...s.turnOrder, turnId];
  }
  return s.turnsById[turnId];
}

function addItemToTurn(s: TranscriptState, turnId: string, itemId: string): void {
  const turn = s.turnsById[turnId];
  if (!turn) return;
  if (!turn.itemOrder.includes(itemId)) {
    turn.itemOrder = [...turn.itemOrder, itemId];
  }
}

function openStreamingItem(s: TranscriptState, itemId: string, item: TranscriptItem): void {
  if (item.kind === "assistant_prose" && item.isStreaming) {
    closeAssistantPointer(s);
    s.openAssistantItemId = itemId;
  }
  if (item.kind === "thought" && item.isStreaming) {
    closeThoughtPointer(s);
    s.openThoughtItemId = itemId;
  }
}

function syncStreamingPointers(s: TranscriptState, itemId: string, item: TranscriptItem): void {
  if (item.kind === "assistant_prose") {
    if (item.isStreaming) s.openAssistantItemId = itemId;
    else if (s.openAssistantItemId === itemId) s.openAssistantItemId = null;
  }
  if (item.kind === "thought") {
    if (item.isStreaming) s.openThoughtItemId = itemId;
    else if (s.openThoughtItemId === itemId) s.openThoughtItemId = null;
  }
}

function closeStreamingPointer(s: TranscriptState, itemId: string): void {
  if (s.openAssistantItemId === itemId) s.openAssistantItemId = null;
  if (s.openThoughtItemId === itemId) s.openThoughtItemId = null;
  const item = s.itemsById[itemId];
  if (!item) return;
  if (item.kind === "user_message" || item.kind === "assistant_prose" || item.kind === "thought") {
    item.isStreaming = false;
  }
}

function closeStreamingItems(s: TranscriptState): void {
  closeAssistantPointer(s);
  closeThoughtPointer(s);
}

function closeAssistantPointer(s: TranscriptState): void {
  if (!s.openAssistantItemId) return;
  const item = s.itemsById[s.openAssistantItemId];
  if (item?.kind === "assistant_prose") item.isStreaming = false;
  s.openAssistantItemId = null;
}

function closeThoughtPointer(s: TranscriptState): void {
  if (!s.openThoughtItemId) return;
  const item = s.itemsById[s.openThoughtItemId];
  if (item?.kind === "thought") item.isStreaming = false;
  s.openThoughtItemId = null;
}

function recordUnknown(
  s: TranscriptState,
  envelope: SessionEventEnvelope,
  itemId: string,
  ts: string,
  turnId: string | null,
): void {
  const item: UnknownItem = {
    kind: "unknown",
    itemId,
    turnId,
    eventType: envelope.event.type,
    rawPayload: envelope.event,
    timestamp: ts,
    startedSeq: envelope.seq,
  };
  s.itemsById[itemId] = item;
  if (turnId) {
    ensureTurn(s, turnId, ts);
    addItemToTurn(s, turnId, itemId);
  }
  s.unknownEvents = [...s.unknownEvents, envelope];
}

function extractText(parts: ContentPart[]): string {
  return parts
    .filter((part): part is Extract<ContentPart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function normalizeContentParts(parts: ContentPart[]): ContentPart[] {
  return parts.map(normalizeContentPart);
}

function normalizeContentPart(part: ContentPart): ContentPart {
  const raw = part as ContentPart & Record<string, unknown>;

  switch (part.type) {
    case "text":
      return { type: "text", text: coerceString(raw.text) };

    case "image":
      return {
        type: "image",
        attachmentId: coerceString(raw.attachmentId ?? raw.attachment_id),
        mimeType: coerceString(raw.mimeType ?? raw.mime_type),
        name: coerceNullableString(raw.name),
        uri: coerceNullableString(raw.uri),
        size: coerceNullableNumber(raw.size),
      };

    case "resource":
      return {
        type: "resource",
        attachmentId: coerceNullableString(raw.attachmentId ?? raw.attachment_id),
        uri: coerceString(raw.uri),
        name: coerceNullableString(raw.name),
        mimeType: coerceNullableString(raw.mimeType ?? raw.mime_type),
        size: coerceNullableNumber(raw.size),
        preview: coerceNullableString(raw.preview),
      };

    case "resource_link":
      return {
        type: "resource_link",
        uri: coerceString(raw.uri),
        name: coerceString(raw.name),
        mimeType: coerceNullableString(raw.mimeType ?? raw.mime_type),
        title: coerceNullableString(raw.title),
        description: coerceNullableString(raw.description),
        size: coerceNullableNumber(raw.size),
      };

    case "reasoning":
      return {
        type: "reasoning",
        text: coerceString(raw.text),
        visibility: "private",
      };

    case "tool_call":
      return {
        type: "tool_call",
        toolCallId: coerceString(raw.toolCallId ?? raw.tool_call_id),
        title: coerceString(raw.title) || "Tool call",
        toolKind: coerceNullableString(raw.toolKind ?? raw.tool_kind),
        nativeToolName: coerceNullableString(raw.nativeToolName ?? raw.native_tool_name),
      };

    case "terminal_output":
      return {
        type: "terminal_output",
        terminalId: coerceString(raw.terminalId ?? raw.terminal_id),
        event: coerceTerminalEvent(raw.event),
        data: coerceNullableString(raw.data),
        exitCode: coerceNullableNumber(raw.exitCode ?? raw.exit_code),
        signal: coerceNullableString(raw.signal),
      };

    case "file_read":
      return {
        type: "file_read",
        path: coerceString(raw.path),
        workspacePath: coerceNullableString(raw.workspacePath ?? raw.workspace_path),
        basename: coerceNullableString(raw.basename),
        line: coerceNullableNumber(raw.line),
        scope: coerceFileReadScope(raw.scope),
        startLine: coerceNullableNumber(raw.startLine ?? raw.start_line),
        endLine: coerceNullableNumber(raw.endLine ?? raw.end_line),
        preview: coerceNullableString(raw.preview),
      };

    case "file_change":
      return {
        type: "file_change",
        operation: coerceFileChangeOperation(raw.operation),
        path: coerceString(raw.path),
        workspacePath: coerceNullableString(raw.workspacePath ?? raw.workspace_path),
        basename: coerceNullableString(raw.basename),
        newPath: coerceNullableString(raw.newPath ?? raw.new_path),
        newWorkspacePath: coerceNullableString(raw.newWorkspacePath ?? raw.new_workspace_path),
        newBasename: coerceNullableString(raw.newBasename ?? raw.new_basename),
        openTarget: coerceFileOpenTarget(raw.openTarget ?? raw.open_target),
        additions: coerceNullableNumber(raw.additions),
        deletions: coerceNullableNumber(raw.deletions),
        patch: coerceNullableString(raw.patch),
        preview: coerceNullableString(raw.preview),
        nativeToolName: coerceNullableString(raw.nativeToolName ?? raw.native_tool_name),
      };

    case "plan":
      return {
        type: "plan",
        entries: Array.isArray(raw.entries) ? (raw.entries as typeof part.entries) : [],
      };

    case "proposed_plan":
      return {
        type: "proposed_plan",
        planId: coerceString(raw.planId ?? raw.plan_id),
        title: coerceString(raw.title) || "Plan",
        bodyMarkdown: coerceString(raw.bodyMarkdown ?? raw.body_markdown),
        snapshotHash: coerceString(raw.snapshotHash ?? raw.snapshot_hash),
        sourceSessionId: coerceString(raw.sourceSessionId ?? raw.source_session_id),
        sourceTurnId: coerceNullableString(raw.sourceTurnId ?? raw.source_turn_id),
        sourceItemId: coerceNullableString(raw.sourceItemId ?? raw.source_item_id),
        sourceKind: coerceString(raw.sourceKind ?? raw.source_kind),
        sourceToolCallId: coerceNullableString(raw.sourceToolCallId ?? raw.source_tool_call_id),
      };

    case "plan_reference":
      return {
        type: "plan_reference",
        planId: coerceString(raw.planId ?? raw.plan_id),
        title: coerceString(raw.title) || "Plan",
        bodyMarkdown: coerceString(raw.bodyMarkdown ?? raw.body_markdown),
        snapshotHash: coerceString(raw.snapshotHash ?? raw.snapshot_hash),
        sourceSessionId: coerceString(raw.sourceSessionId ?? raw.source_session_id),
        sourceTurnId: coerceNullableString(raw.sourceTurnId ?? raw.source_turn_id),
        sourceItemId: coerceNullableString(raw.sourceItemId ?? raw.source_item_id),
        sourceKind: coerceString(raw.sourceKind ?? raw.source_kind),
        sourceToolCallId: coerceNullableString(raw.sourceToolCallId ?? raw.source_tool_call_id),
      };

    case "proposed_plan_decision":
      return {
        type: "proposed_plan_decision",
        planId: coerceString(raw.planId ?? raw.plan_id),
        decisionState: coerceProposedPlanDecisionState(raw.decisionState ?? raw.decision_state),
        nativeResolutionState: coerceProposedPlanNativeResolutionState(
          raw.nativeResolutionState ?? raw.native_resolution_state,
        ),
        decisionVersion: coerceNullableNumber(raw.decisionVersion ?? raw.decision_version) ?? 1,
        errorMessage: coerceNullableString(raw.errorMessage ?? raw.error_message),
      };

    case "tool_input_text":
      return {
        type: "tool_input_text",
        text: coerceString(raw.text),
      };

    case "tool_result_text":
      return {
        type: "tool_result_text",
        text: coerceString(raw.text),
      };
  }
}

function mergeContentParts(existing: ContentPart[], incoming: ContentPart[]): ContentPart[] {
  const current = normalizeContentParts(existing);
  const next = normalizeContentParts(incoming);
  if (next.length === 0) return current;

  const merged: ContentPart[] = [];
  const toolCall = findToolCallPart(next) ?? findToolCallPart(current);
  if (toolCall) merged.push(toolCall);

  const leadingSnapshotTypes = [
    "text",
    "image",
    "resource",
    "resource_link",
    "plan_reference",
    "reasoning",
    "file_read",
  ] as const;
  const trailingSnapshotTypes = [
    "plan",
    "proposed_plan",
    "proposed_plan_decision",
    "tool_input_text",
    "tool_result_text",
  ] as const;

  for (const type of leadingSnapshotTypes) {
    const nextParts = next.filter((part) => part.type === type);
    const currentParts = current.filter((part) => part.type === type);
    merged.push(...(nextParts.length > 0 ? nextParts : currentParts));
  }

  merged.push(...mergeFileChangeParts(current, next));

  for (const type of trailingSnapshotTypes) {
    const nextParts = next.filter((part) => part.type === type);
    const currentParts = current.filter((part) => part.type === type);
    merged.push(...(nextParts.length > 0 ? nextParts : currentParts));
  }

  merged.push(
    ...dedupeParts([
      ...current.filter((part) => part.type === "terminal_output"),
      ...next.filter((part) => part.type === "terminal_output"),
    ]),
  );

  return dedupeParts(merged);
}

function dedupeParts(parts: ContentPart[]): ContentPart[] {
  const seen = new Set<string>();
  return parts.filter((part) => {
    const key = JSON.stringify(part);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeFileChangeParts(
  current: ContentPart[],
  next: ContentPart[],
): FileChangeContentPart[] {
  const currentFileChanges = current.filter(isFileChangePart);
  const nextFileChanges = next.filter(isFileChangePart);

  if (nextFileChanges.length === 0) {
    return currentFileChanges;
  }

  const remainingCurrent = [...currentFileChanges];
  const merged: FileChangeContentPart[] = [];

  for (const nextPart of nextFileChanges) {
    const identity = fileChangeIdentity(nextPart);
    const currentIndex = remainingCurrent.findIndex(
      (part) => fileChangeIdentity(part) === identity,
    );

    if (currentIndex === -1) {
      merged.push(nextPart);
      continue;
    }

    const [previousPart] = remainingCurrent.splice(currentIndex, 1);
    merged.push(mergeFileChangePart(previousPart, nextPart));
  }

  return [...merged, ...remainingCurrent];
}

function fileChangeIdentity(part: FileChangeContentPart): string {
  const currentPath = part.workspacePath ?? part.path;
  const nextPath = part.newWorkspacePath ?? part.newPath ?? "";
  return `${currentPath}\u0000${nextPath}`;
}

function mergeFileChangePart(
  previous: FileChangeContentPart,
  next: FileChangeContentPart,
): FileChangeContentPart {
  const patch = next.patch ?? previous.patch ?? null;
  const openTarget = patch
    ? "diff"
    : next.openTarget === "diff" || previous.openTarget === "diff"
      ? "diff"
      : next.openTarget ?? previous.openTarget ?? null;

  return {
    type: "file_change",
    operation: next.operation,
    path: chooseString(next.path, previous.path),
    workspacePath: chooseNullableString(next.workspacePath, previous.workspacePath),
    basename: chooseNullableString(next.basename, previous.basename),
    newPath: chooseNullableString(next.newPath, previous.newPath),
    newWorkspacePath: chooseNullableString(
      next.newWorkspacePath,
      previous.newWorkspacePath,
    ),
    newBasename: chooseNullableString(next.newBasename, previous.newBasename),
    openTarget,
    additions: next.additions ?? previous.additions ?? null,
    deletions: next.deletions ?? previous.deletions ?? null,
    patch,
    preview: chooseNullableString(next.preview, previous.preview),
    nativeToolName: chooseNullableString(
      next.nativeToolName,
      previous.nativeToolName,
    ),
  };
}

function chooseString(next: string, previous: string): string {
  return next.trim().length > 0 ? next : previous;
}

function chooseNullableString(
  next: string | null | undefined,
  previous: string | null | undefined,
): string | null {
  if (typeof next === "string" && next.trim().length > 0) {
    return next;
  }
  return previous ?? null;
}

function coerceString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function coerceNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function coerceNullableNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function coerceTerminalEvent(value: unknown): "start" | "output" | "exit" {
  return value === "start" || value === "output" || value === "exit"
    ? value
    : "output";
}

function coerceFileChangeOperation(
  value: unknown,
): FileChangeContentPart["operation"] {
  return value === "create" || value === "edit" || value === "delete" || value === "move"
    ? value
    : "edit";
}

function coerceFileReadScope(value: unknown): FileReadContentPart["scope"] {
  return value === "full" || value === "line" || value === "range" || value === "unknown"
    ? value
    : null;
}

function coerceFileOpenTarget(value: unknown): FileChangeContentPart["openTarget"] {
  return value === "file" || value === "diff" ? value : null;
}

function coerceProposedPlanDecisionState(value: unknown) {
  return value === "approved" || value === "rejected" || value === "superseded"
    ? value
    : "pending";
}

function coerceProposedPlanNativeResolutionState(value: unknown) {
  return value === "pending_link"
    || value === "pending_resolution"
    || value === "finalized"
    || value === "failed"
    ? value
    : "none";
}

function extractReasoning(parts: ContentPart[]): string {
  return parts
    .filter((part): part is Extract<ContentPart, { type: "reasoning" }> => part.type === "reasoning")
    .map((part) => part.text)
    .join("");
}

function appendToTextContentPart(item: KnownTranscriptItem, text: string): void {
  const last = item.contentParts[item.contentParts.length - 1];
  if (last && last.type === "text") {
    last.text += text;
  } else {
    item.contentParts.push({ type: "text", text });
  }
}

function appendToReasoningContentPart(item: KnownTranscriptItem, text: string): void {
  const last = item.contentParts[item.contentParts.length - 1];
  if (last && last.type === "reasoning") {
    last.text += text;
  } else {
    item.contentParts.push({ type: "reasoning", text, visibility: "private" });
  }
}

function extractPlanEntries(parts: ContentPart[]) {
  const part = parts.find((entry): entry is Extract<ContentPart, { type: "plan" }> => entry.type === "plan");
  return part?.entries ?? [];
}

function extractProposedPlan(parts: ContentPart[]) {
  return parts.find((part): part is Extract<ContentPart, { type: "proposed_plan" }> =>
    part.type === "proposed_plan"
  ) ?? null;
}

function extractLatestProposedPlanDecision(parts: ContentPart[]) {
  const decisions = parts.filter((
    part,
  ): part is Extract<ContentPart, { type: "proposed_plan_decision" }> =>
    part.type === "proposed_plan_decision"
  );
  return decisions.reduce<Extract<ContentPart, { type: "proposed_plan_decision" }> | null>(
    (latest, decision) =>
      !latest || decision.decisionVersion >= latest.decisionVersion ? decision : latest,
    null,
  );
}

function isPlanOwnedInteraction(
  transcript: TranscriptState,
  interaction: PendingInteraction,
): boolean {
  if (interaction.linkedPlanId) {
    return true;
  }
  if (!interaction.toolCallId) {
    return false;
  }
  return Object.values(transcript.itemsById).some((item) =>
    item.kind === "proposed_plan"
    && item.plan.sourceToolCallId === interaction.toolCallId
    && item.decision?.decisionState === "pending"
  );
}

function findToolCallPart(parts: ContentPart[]) {
  return parts.find((part): part is Extract<ContentPart, { type: "tool_call" }> => part.type === "tool_call");
}

function deriveToolCallSemanticKind(
  parts: ContentPart[],
  nativeToolName: string | null,
  toolKind: string,
  title: string | null,
): ToolCallSemanticKind {
  const normalizedToolKind = toolKind.toLowerCase();
  const normalizedNativeToolName = (nativeToolName ?? "").toLowerCase();
  const normalizedTitle = (title ?? "").toLowerCase();
  const normalizedEffectiveToolName = normalizeToolNameForSemanticKind(
    nativeToolName,
    title,
  );

  if (normalizedEffectiveToolName === "mcp__cowork__create_artifact") {
    return "cowork_artifact_create";
  }
  if (normalizedEffectiveToolName === "mcp__cowork__update_artifact") {
    return "cowork_artifact_update";
  }
  if (
    normalizedEffectiveToolName === "mcp__cowork__get_coding_workspace_launch_options"
    || normalizedEffectiveToolName === "mcp__cowork__create_coding_workspace"
    || normalizedEffectiveToolName === "mcp__cowork__list_coding_workspaces"
    || normalizedEffectiveToolName === "mcp__cowork__get_coding_session_launch_options"
    || normalizedEffectiveToolName === "mcp__cowork__create_coding_session"
    || normalizedEffectiveToolName === "mcp__cowork__send_coding_message"
    || normalizedEffectiveToolName === "mcp__cowork__schedule_coding_wake"
    || normalizedEffectiveToolName === "mcp__cowork__get_coding_status"
    || normalizedEffectiveToolName === "mcp__cowork__read_coding_events"
  ) {
    return "cowork_coding";
  }
  if (normalizedEffectiveToolName === "mcp__subagents__create_subagent") {
    return "subagent";
  }

  if (nativeToolName === "Agent" || normalizedToolKind === "think") {
    return "subagent";
  }
  if (
    nativeToolName === "CodexHook"
    || nativeToolName === "ClaudeHook"
    || normalizedToolKind === "hook"
  ) {
    return "hook";
  }
  if (parts.some((part) => part.type === "file_change")) {
    return "file_change";
  }
  if (parts.some((part) => part.type === "file_read")) {
    return "file_read";
  }
  if (
    parts.some((part) => part.type === "terminal_output")
    || nativeToolName === "Bash"
    || normalizedToolKind === "execute"
  ) {
    return "terminal";
  }
  if (
    normalizedToolKind === "search"
    || normalizedToolKind === "grep"
    || normalizedToolKind === "glob"
    || normalizedToolKind === "list"
    || normalizedNativeToolName === "grep"
    || normalizedNativeToolName === "glob"
    || normalizedNativeToolName === "ls"
    || normalizedTitle.startsWith("list ")
    || normalizedTitle.startsWith("search ")
  ) {
    return "search";
  }
  if (
    normalizedToolKind === "fetch"
    || normalizedToolKind === "web_fetch"
    || normalizedNativeToolName.includes("fetch")
  ) {
    return "fetch";
  }
  if (
    normalizedToolKind === "mode"
    || normalizedToolKind === "mode_switch"
    || normalizedNativeToolName.includes("mode")
  ) {
    return "mode_switch";
  }
  return "other";
}

function normalizeToolNameForSemanticKind(
  nativeToolName: string | null,
  title: string | null,
): string {
  const normalizedNativeToolName = (nativeToolName ?? "").trim().toLowerCase();
  if (normalizedNativeToolName.length > 0) {
    return normalizedNativeToolName;
  }

  return (title ?? "").trim().toLowerCase();
}

function collectFileBadges(s: TranscriptState, turnId: string) {
  const turn = s.turnsById[turnId];
  if (!turn) return [];
  const badges = new Map<string, { path: string; additions: number; deletions: number }>();
  for (const itemId of turn.itemOrder) {
    const item = s.itemsById[itemId];
    if (!item || item.kind !== "tool_call") continue;
    for (const part of item.contentParts) {
      if (part.type !== "file_change") continue;
      const badgePath = part.newWorkspacePath ?? part.workspacePath ?? part.newPath ?? part.path;
      const existing = badges.get(badgePath) ?? { path: badgePath, additions: 0, deletions: 0 };
      existing.additions += part.additions ?? 0;
      existing.deletions += part.deletions ?? 0;
      badges.set(badgePath, existing);
    }
  }
  return [...badges.values()];
}

export function isFileReadPart(part: ContentPart): part is FileReadContentPart {
  return part.type === "file_read";
}

export function isFileChangePart(part: ContentPart): part is FileChangeContentPart {
  return part.type === "file_change";
}
