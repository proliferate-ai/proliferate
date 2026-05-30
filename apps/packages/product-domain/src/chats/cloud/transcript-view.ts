import {
  createTranscriptState,
  type ContentPart,
  SessionEventEnvelope,
  TranscriptItem,
  type TranscriptItemStatus,
  TranscriptState,
  ToolCallItem,
} from "@anyharness/sdk";
import type {
  CloudSessionEvent,
  CloudPendingInteraction,
  CloudTranscriptItem,
} from "@proliferate/cloud-sdk";
import {
  formatCollapsedActionsSummary,
  summarizeCollapsedActions,
} from "../transcript/transcript-collapsed-actions";
import { reconstructTranscriptState } from "../transcript/envelope-to-state";
import {
  buildTranscriptVirtualRows,
  type TranscriptVirtualRow,
} from "../transcript/transcript-virtual-rows";
import { describeToolCallDisplay } from "../tools/tool-call-display";
import { getToolCallShellCommand } from "../transcript/transcript-tool-commands";
import {
  blockBelongsToCompletedHistory,
} from "../transcript/transcript-rendering";
import {
  turnHasAssistantRenderableTranscriptContent,
} from "../pending-prompts/pending-prompts";

const MAX_BODY_PREVIEW_LENGTH = 2_000;

export type CloudChatTranscriptRowKind =
  | "assistant"
  | "error"
  | "system"
  | "thought"
  | "tool"
  | "tool_group"
  | "proposed_plan"
  | "user";

export interface CloudChatTranscriptRowView {
  id: string;
  kind: CloudChatTranscriptRowKind;
  title?: string | null;
  body?: string | null;
  detail?: string | null;
  status?: string | null;
  streaming?: boolean;
  children?: CloudChatTranscriptRowView[];
  firstSeq?: number | null;
  lastSeq?: number | null;
  sourceRequestId?: string | null;
  sourceCommandId?: string | null;
  sourceToolCallId?: string | null;
  planId?: string | null;
  planTitle?: string | null;
  planBodyMarkdown?: string | null;
  planDecisionState?: "pending" | "approved" | "rejected" | "superseded" | null;
  planNativeResolutionState?: "none" | "pending_link" | "pending_resolution" | "finalized" | "failed" | null;
  planDecisionVersion?: number | null;
  planErrorMessage?: string | null;
  planNativeContinuation?: boolean;
}

export interface CloudTranscriptViewResult {
  rows: CloudChatTranscriptRowView[];
  source: "empty" | "events" | "projection";
  envelopeCount: number;
  missingEnvelopeCount: number;
}

export type CloudTranscriptStateSource = "empty" | "events" | "projection";

export type CloudTranscriptStateFallbackReason =
  | "empty"
  | "missing_envelopes"
  | "no_renderable_event_rows"
  | "projection_ahead_of_events";

export interface CloudTranscriptStateResult {
  transcript: TranscriptState | null;
  source: CloudTranscriptStateSource;
  envelopeCount: number;
  missingEnvelopeCount: number;
  latestEnvelopeSeq: number;
  latestProjectedSeq: number;
  fallbackReason: CloudTranscriptStateFallbackReason | null;
}

export interface CloudOptimisticPromptReference {
  text: string;
  baseTranscriptSeq: number;
}

export function buildCloudTranscriptState(input: {
  sessionId: string | null;
  events: readonly CloudSessionEvent[];
  fallbackItems?: readonly CloudTranscriptItem[];
}): CloudTranscriptStateResult {
  const fallbackItems = input.fallbackItems ?? [];
  const latestProjectedSeq = latestProjectedItemSeq(fallbackItems);
  if (!input.sessionId) {
    return emptyCloudTranscriptState({
      latestProjectedSeq,
      fallbackReason: "empty",
    });
  }

  const envelopes = input.events
    .map((event) => event.envelope)
    .filter(isSessionEventEnvelope);
  const missingEnvelopeCount = input.events.length - envelopes.length;
  const latestEnvelopeSeq = latestEnvelopeSeqFromEvents(envelopes);

  if (envelopes.length === 0) {
    const projectionTranscript = fallbackItems.length > 0
      ? buildTranscriptStateFromProjectedItems(input.sessionId, fallbackItems)
      : null;
    return {
      transcript: projectionTranscript,
      source: fallbackItems.length > 0 ? "projection" : "empty",
      envelopeCount: 0,
      missingEnvelopeCount,
      latestEnvelopeSeq,
      latestProjectedSeq,
      fallbackReason: fallbackItems.length > 0 ? "missing_envelopes" : "empty",
    };
  }

  const transcript = reconstructTranscriptState(input.sessionId, envelopes);
  const rows = buildRowsFromTranscriptState(transcript);
  if (rows.length === 0) {
    const projectionTranscript = fallbackItems.length > 0
      ? buildTranscriptStateFromProjectedItems(input.sessionId, fallbackItems)
      : null;
    return {
      transcript: projectionTranscript,
      source: fallbackItems.length > 0 ? "projection" : "empty",
      envelopeCount: envelopes.length,
      missingEnvelopeCount,
      latestEnvelopeSeq,
      latestProjectedSeq,
      fallbackReason: "no_renderable_event_rows",
    };
  }
  if (!shouldUseEventRows(
    { events: input.events, fallbackItems },
    rows,
    missingEnvelopeCount,
  )) {
    const projectionTranscript = fallbackItems.length > 0
      ? buildTranscriptStateFromProjectedItems(input.sessionId, fallbackItems)
      : null;
    return {
      transcript: projectionTranscript,
      source: fallbackItems.length > 0 ? "projection" : "empty",
      envelopeCount: envelopes.length,
      missingEnvelopeCount,
      latestEnvelopeSeq,
      latestProjectedSeq,
      fallbackReason: latestProjectedSeq > latestTranscriptRowSeq(rows)
        ? "projection_ahead_of_events"
        : "missing_envelopes",
    };
  }

  return {
    transcript,
    source: "events",
    envelopeCount: envelopes.length,
    missingEnvelopeCount,
    latestEnvelopeSeq,
    latestProjectedSeq,
    fallbackReason: null,
  };
}

export function buildCloudTranscriptView(input: {
  sessionId: string | null;
  events: readonly CloudSessionEvent[];
  fallbackItems: readonly CloudTranscriptItem[];
  pendingInteractions?: readonly CloudPendingInteraction[];
}): CloudTranscriptViewResult {
  if (!input.sessionId) {
    return emptyCloudTranscriptView();
  }

  const state = buildCloudTranscriptState({
    sessionId: input.sessionId,
    events: input.events,
    fallbackItems: input.fallbackItems,
  });

  if (state.transcript) {
    const rows = applyInteractionCommandDetails(
      buildRowsFromTranscriptState(state.transcript),
      input.events,
    );
    return {
      rows: applyPendingInteractionRows(
        rows,
        input.pendingInteractions ?? [],
        input.fallbackItems,
      ),
      source: state.source,
      envelopeCount: state.envelopeCount,
      missingEnvelopeCount: state.missingEnvelopeCount,
    };
  }

  if (input.fallbackItems.length > 0) {
    return {
      rows: applyPendingInteractionRows(
        buildRowsFromProjectedItems(input.fallbackItems),
        input.pendingInteractions ?? [],
        input.fallbackItems,
      ),
      source: "projection",
      envelopeCount: state.envelopeCount,
      missingEnvelopeCount: state.missingEnvelopeCount,
    };
  }

  return {
    rows: applyPendingInteractionRows([], input.pendingInteractions ?? []),
    source: "empty",
    envelopeCount: state.envelopeCount,
    missingEnvelopeCount: state.missingEnvelopeCount,
  };
}

export function buildCloudTranscriptRowsFromTurnRow(input: {
  row: Extract<TranscriptVirtualRow, { kind: "turn" }>;
  transcript: TranscriptState;
}): CloudChatTranscriptRowView[] {
  return buildRowsFromTurnRow(input.row, input.transcript);
}

export function cloudPendingInteractionsRequireProjectedRows(
  pendingInteractions: readonly CloudPendingInteraction[],
): boolean {
  return pendingInteractions.some((interaction) =>
    interaction.status === "pending" && interaction.kind !== "send_prompt"
  );
}

function emptyCloudTranscriptState(input: {
  latestProjectedSeq: number;
  fallbackReason: CloudTranscriptStateFallbackReason;
}): CloudTranscriptStateResult {
  return {
    transcript: null,
    source: "empty",
    envelopeCount: 0,
    missingEnvelopeCount: 0,
    latestEnvelopeSeq: 0,
    latestProjectedSeq: input.latestProjectedSeq,
    fallbackReason: input.fallbackReason,
  };
}

function latestEnvelopeSeqFromEvents(
  envelopes: readonly SessionEventEnvelope[],
): number {
  return envelopes.reduce((maxSeq, envelope) => Math.max(maxSeq, envelope.seq), 0);
}

function shouldUseEventRows(
  input: {
    events: readonly CloudSessionEvent[];
    fallbackItems: readonly CloudTranscriptItem[];
  },
  rows: readonly CloudChatTranscriptRowView[],
  missingEnvelopeCount: number,
): boolean {
  if (latestProjectedItemSeq(input.fallbackItems) > latestTranscriptRowSeq(rows)) {
    return false;
  }
  if (missingEnvelopeCount === 0 || input.fallbackItems.length === 0) {
    return true;
  }
  return projectedItemsAreCoveredByRows(input.fallbackItems, rows);
}

function latestProjectedItemSeq(items: readonly CloudTranscriptItem[]): number {
  return items.reduce(
    (maxSeq, item) => Math.max(maxSeq, item.lastSeq, item.completedSeq ?? 0),
    0,
  );
}

function latestTranscriptRowSeq(rows: readonly CloudChatTranscriptRowView[]): number {
  let latestSeq = 0;
  for (const row of rows) {
    latestSeq = Math.max(latestSeq, row.lastSeq ?? row.firstSeq ?? 0);
    if (row.children) {
      latestSeq = Math.max(latestSeq, latestTranscriptRowSeq(row.children));
    }
  }
  return latestSeq;
}

function projectedItemsAreCoveredByRows(
  items: readonly CloudTranscriptItem[],
  rows: readonly CloudChatTranscriptRowView[],
): boolean {
  return items.every((item) => projectedItemIsCoveredByRows(item, rows));
}

function projectedItemIsCoveredByRows(
  item: CloudTranscriptItem,
  rows: readonly CloudChatTranscriptRowView[],
): boolean {
  return rows.some((row) => rowCoversProjectedItem(row, item));
}

function rowCoversProjectedItem(
  row: CloudChatTranscriptRowView,
  item: CloudTranscriptItem,
): boolean {
  const firstSeq = row.firstSeq ?? row.lastSeq ?? null;
  const lastSeq = row.lastSeq ?? row.firstSeq ?? null;
  const coversSelf = typeof firstSeq === "number"
    && typeof lastSeq === "number"
    && firstSeq <= item.firstSeq
    && lastSeq >= item.lastSeq;
  if (coversSelf) {
    return true;
  }
  return row.children?.some((child) => rowCoversProjectedItem(child, item)) ?? false;
}

export function cloudTranscriptHasUserPrompt(input: {
  prompt: CloudOptimisticPromptReference;
  transcriptItems: readonly CloudTranscriptItem[];
  transcriptRows: readonly CloudChatTranscriptRowView[];
  allowTextOnlyRowFallback?: boolean;
}): boolean {
  return input.transcriptItems.some((item) =>
    isPromptItemForOptimisticPrompt(item, input.prompt)
  )
    || input.transcriptRows.some((row) =>
      row.kind === "user"
      && rowIsAfterPromptBaseline(row, input.prompt)
      && textMatches(row.body, input.prompt.text)
    )
    || (
      input.allowTextOnlyRowFallback === true
      && input.transcriptItems.length === 0
      && input.transcriptRows.some((row) =>
        row.kind === "user" && textMatches(row.body, input.prompt.text)
      )
    );
}

export function cloudTranscriptHasAgentProgressAfterPrompt(input: {
  prompt: CloudOptimisticPromptReference;
  transcriptItems: readonly CloudTranscriptItem[];
  transcriptRows: readonly CloudChatTranscriptRowView[];
  allowTextOnlyRowFallback?: boolean;
}): boolean {
  const promptItem = [...input.transcriptItems]
    .filter((item) => isPromptItemForOptimisticPrompt(item, input.prompt))
    .sort((left, right) => right.lastSeq - left.lastSeq)[0];
  if (promptItem) {
    return input.transcriptItems.some((item) =>
      item.firstSeq > promptItem.lastSeq && !isPromptTranscriptKind(item.kind)
    )
      || input.transcriptRows.some((row) =>
        row.kind !== "user"
        && typeof row.firstSeq === "number"
        && row.firstSeq > promptItem.lastSeq
      );
  }

  const promptRowIndex = input.transcriptRows.findIndex((row) =>
    row.kind === "user"
    && rowIsAfterPromptBaseline(row, input.prompt)
    && textMatches(row.body, input.prompt.text)
  );
  const fallbackPromptRowIndex = input.allowTextOnlyRowFallback === true
    ? input.transcriptRows.findIndex((row) =>
      row.kind === "user" && textMatches(row.body, input.prompt.text)
    )
    : -1;
  const resolvedPromptRowIndex = promptRowIndex === -1 ? fallbackPromptRowIndex : promptRowIndex;
  if (resolvedPromptRowIndex === -1) {
    return false;
  }
  return input.transcriptRows
    .slice(resolvedPromptRowIndex + 1)
    .some((row) => row.kind !== "user" && rowIsAfterPromptBaseline(row, input.prompt));
}

export function latestCloudTranscriptSeq(
  items: readonly CloudTranscriptItem[],
  rows: readonly CloudChatTranscriptRowView[],
): number {
  return Math.max(latestProjectedItemSeq(items), latestTranscriptRowSeq(rows));
}

function emptyCloudTranscriptView(): CloudTranscriptViewResult {
  return {
    rows: [],
    source: "empty",
    envelopeCount: 0,
    missingEnvelopeCount: 0,
  };
}

function buildRowsFromTranscriptState(
  transcript: TranscriptState,
): CloudChatTranscriptRowView[] {
  const latestTurnId = transcript.turnOrder[transcript.turnOrder.length - 1] ?? null;
  const latestTurn = latestTurnId ? transcript.turnsById[latestTurnId] : null;
  const rowModel = buildTranscriptVirtualRows({
    activeSessionId: transcript.sessionMeta.sessionId,
    transcript,
    visibleOptimisticPrompt: null,
    visibleOutboxEntries: [],
    latestTurnId,
    latestTurnHasAssistantRenderableContent: latestTurn
      ? turnHasAssistantRenderableTranscriptContent(latestTurn, transcript)
      : false,
  });

  const rows: CloudChatTranscriptRowView[] = [];
  for (const row of rowModel) {
    if (row.kind !== "turn") {
      continue;
    }
    rows.push(...buildRowsFromTurnRow(row, transcript));
  }
  return rows;
}

function buildRowsFromTurnRow(
  row: Extract<TranscriptVirtualRow, { kind: "turn" }>,
  transcript: TranscriptState,
): CloudChatTranscriptRowView[] {
  const rows: CloudChatTranscriptRowView[] = [];
  const completedHistoryRootIds = new Set(row.renderPresentation.completedHistoryRootIds);
  let hasRenderedCompletedHistory = false;

  for (const block of row.renderPresentation.displayBlocks) {
    if (
      row.renderPresentation.completedHistorySummary
      && blockBelongsToCompletedHistory(block, completedHistoryRootIds)
    ) {
      if (!hasRenderedCompletedHistory) {
        const summary = row.renderPresentation.completedHistorySummary;
        const fragments = [
          formatCount(summary.messages, "message"),
          formatCount(summary.toolCalls, "tool call"),
          formatCount(summary.subagents, "delegated session"),
        ].filter((value): value is string => Boolean(value));
        const historyRows: CloudChatTranscriptRowView[] = [];
        for (const historyBlock of row.renderPresentation.displayBlocks) {
          if (blockBelongsToCompletedHistory(historyBlock, completedHistoryRootIds)) {
            appendDisplayBlockRows(historyBlock, row, transcript, historyRows);
          }
        }
        rows.push({
          id: `${row.key}:completed-history`,
          kind: "system",
          title: "Work history",
          detail: fragments.join(", "),
          children: historyRows,
        });
        hasRenderedCompletedHistory = true;
      }
      continue;
    }

    if (
      block.kind === "collapsed_actions"
      || block.kind === "inline_tools"
      || block.kind === "subagent_creations"
    ) {
      appendDisplayBlockRows(block, row, transcript, rows);
      continue;
    }

    appendDisplayBlockRows(block, row, transcript, rows);
  }

  return rows;
}

function buildTranscriptStateFromProjectedItems(
  sessionId: string,
  items: readonly CloudTranscriptItem[],
): TranscriptState {
  const transcript = createTranscriptState(sessionId);
  const sortedItems = [...items].sort((left, right) => left.firstSeq - right.firstSeq);
  const turnIds = new Set<string>();
  let latestTimestamp: string | null = null;
  let sourceAgentKind: string | null = null;

  for (const item of sortedItems) {
    const turnId = item.turnId ?? `projection-turn:${item.firstSeq}`;
    const timestamp = item.firstEventAt ?? item.lastEventAt ?? "1970-01-01T00:00:00.000Z";
    latestTimestamp = item.lastEventAt ?? item.firstEventAt ?? latestTimestamp;
    sourceAgentKind = sourceAgentKind ?? item.sourceAgentKind ?? null;

    if (!turnIds.has(turnId)) {
      turnIds.add(turnId);
      transcript.turnOrder.push(turnId);
      transcript.turnsById[turnId] = {
        turnId,
        itemOrder: [],
        startedAt: timestamp,
        completedAt: null,
        stopReason: null,
        fileBadges: [],
      };
    }

    const projected = projectedItemToTranscriptItem(item, turnId);
    if (!projected) {
      continue;
    }
    transcript.itemsById[projected.itemId] = projected;
    transcript.turnsById[turnId]?.itemOrder.push(projected.itemId);
    transcript.lastSeq = Math.max(
      transcript.lastSeq,
      item.lastSeq,
      item.completedSeq ?? 0,
    );
    if (transcriptItemStatus(projected) === "in_progress") {
      transcript.isStreaming = true;
    }
  }

  for (const turnId of transcript.turnOrder) {
    const turn = transcript.turnsById[turnId];
    if (!turn) {
      continue;
    }
    const turnItems = turn.itemOrder
      .map((itemId) => transcript.itemsById[itemId])
      .filter((item): item is TranscriptItem => Boolean(item));
    const latestTurnItem = turnItems[turnItems.length - 1] ?? null;
    const hasStreamingItem = turnItems.some((item) => transcriptItemStatus(item) === "in_progress");
    turn.completedAt = hasStreamingItem ? null : transcriptItemCompletedAt(latestTurnItem);
  }

  transcript.sessionMeta.updatedAt = latestTimestamp;
  transcript.sessionMeta.sourceAgentKind = sourceAgentKind;
  return transcript;
}

function projectedItemToTranscriptItem(
  item: CloudTranscriptItem,
  turnId: string,
): TranscriptItem | null {
  const payloadItem = projectedPayloadItem(item.payload);
  const contentParts = projectedContentParts(item, payloadItem);
  const text = item.text ?? projectedPayloadText(item.payload) ?? "";
  const base = {
    itemId: item.itemId,
    turnId,
    status: projectedTranscriptStatus(item.status),
    sourceAgentKind: item.sourceAgentKind ?? "unknown",
    isTransient: false,
    messageId: readString(payloadItem?.messageId),
    title: cleanedProjectedTitle(item.title, item.kind),
    nativeToolName: readString(payloadItem?.nativeToolName),
    parentToolCallId: readString(payloadItem?.parentToolCallId),
    rawInput: payloadItem?.rawInput,
    rawOutput: payloadItem?.rawOutput,
    contentParts,
    timestamp: item.firstEventAt ?? item.lastEventAt ?? "1970-01-01T00:00:00.000Z",
    startedSeq: item.firstSeq,
    lastUpdatedSeq: item.lastSeq,
    completedSeq: item.completedSeq ?? (item.status === "in_progress" ? null : item.lastSeq),
    completedAt: item.status === "in_progress" ? null : item.lastEventAt ?? item.firstEventAt ?? null,
  };

  switch (item.kind) {
    case "user_message":
    case "prompt":
      return {
        ...base,
        kind: "user_message",
        text,
        isStreaming: item.status === "in_progress",
        promptId: projectedItemPromptId(item),
        promptProvenance: null,
      };
    case "assistant_message":
    case "assistant_prose":
      return {
        ...base,
        kind: "assistant_prose",
        text,
        isStreaming: item.status === "in_progress",
      };
    case "reasoning":
    case "thought":
      return {
        ...base,
        kind: "thought",
        text,
        isStreaming: item.status === "in_progress",
      };
    case "tool":
    case "tool_call":
    case "tool_invocation":
      return {
        ...base,
        kind: "tool_call",
        toolCallId: projectedItemToolCallId(item),
        toolKind: readString(payloadItem?.toolKind) ?? (projectedItemLooksLikeShellTool(item) ? "execute" : "other"),
        semanticKind: projectedItemLooksLikeShellTool(item) ? "terminal" : "other",
        approvalState: "none",
      };
    case "plan": {
      const planPart = contentParts.find((part): part is Extract<ContentPart, { type: "plan" }> =>
        part.type === "plan"
      );
      return {
        ...base,
        kind: "plan",
        entries: planPart?.entries ?? [],
      };
    }
    case "proposed_plan": {
      const plan = contentParts.find(
        (part): part is Extract<ContentPart, { type: "proposed_plan" }> =>
          part.type === "proposed_plan",
      );
      if (!plan) {
        return {
          ...base,
          kind: "assistant_prose",
          text,
          isStreaming: item.status === "in_progress",
        };
      }
      return {
        ...base,
        kind: "proposed_plan",
        plan,
        decision: contentParts.find(
          (part): part is Extract<ContentPart, { type: "proposed_plan_decision" }> =>
            part.type === "proposed_plan_decision" && part.planId === plan.planId,
        ) ?? null,
      };
    }
    case "error":
    case "error_item":
      return {
        ...base,
        kind: "error",
        message: text || item.title || "Error",
        code: null,
        details: null,
      };
    default:
      return {
        kind: "unknown",
        itemId: item.itemId,
        turnId,
        eventType: item.kind ?? "projection_item",
        rawPayload: item.payload,
        timestamp: item.firstEventAt ?? item.lastEventAt ?? "1970-01-01T00:00:00.000Z",
        startedSeq: item.firstSeq,
      };
  }
}

function projectedContentParts(
  item: CloudTranscriptItem,
  payloadItem: Record<string, unknown> | null,
): ContentPart[] {
  const payloadParts = payloadItem?.contentParts;
  if (Array.isArray(payloadParts)) {
    return payloadParts.filter(isRecord) as ContentPart[];
  }
  const text = item.text ?? projectedPayloadText(item.payload) ?? "";
  if (!text) {
    return [];
  }
  if (item.kind === "reasoning" || item.kind === "thought") {
    return [{ type: "reasoning", text, visibility: "private" }];
  }
  if (item.kind === "tool" || item.kind === "tool_call" || item.kind === "tool_invocation") {
    return [{ type: "tool_result_text", text }] as ContentPart[];
  }
  return [{ type: "text", text }] as ContentPart[];
}

function projectedTranscriptStatus(status: string | null | undefined): TranscriptItemStatus {
  if (status === "failed") {
    return "failed";
  }
  if (status === "in_progress" || status === "running" || status === "streaming") {
    return "in_progress";
  }
  return "completed";
}

function appendDisplayBlockRows(
  block: Extract<TranscriptVirtualRow, { kind: "turn" }>["renderPresentation"]["displayBlocks"][number],
  row: Extract<TranscriptVirtualRow, { kind: "turn" }>,
  transcript: TranscriptState,
  rows: CloudChatTranscriptRowView[],
): void {
  if (block.kind === "collapsed_actions") {
    const summary = summarizeCollapsedActions(block.itemIds, transcript);
    rows.push({
      id: `${row.key}:${block.blockId}`,
      kind: "tool_group",
      title: formatCollapsedActionsSummary(summary),
      status: resolveGroupStatus(block.itemIds, transcript),
    });
    return;
  }

  if (block.kind === "inline_tools" || block.kind === "subagent_creations") {
    for (const itemId of block.itemIds) {
      appendItemRows(itemId, row, transcript, rows);
    }
    return;
  }

  appendItemRows(block.itemId, row, transcript, rows);
}

function appendItemRows(
  itemId: string,
  row: Extract<TranscriptVirtualRow, { kind: "turn" }>,
  transcript: TranscriptState,
  rows: CloudChatTranscriptRowView[],
): void {
  const item = transcript.itemsById[itemId];
  if (!item) {
    return;
  }
  const view = transcriptItemToRow(item, `${row.key}:${itemId}`);
  if (view) {
    rows.push(view);
  }
  for (const childId of row.renderPresentation.childrenByParentId.get(itemId) ?? []) {
    appendItemRows(childId, row, transcript, rows);
  }
}

function transcriptItemToRow(
  item: TranscriptItem,
  id: string,
): CloudChatTranscriptRowView | null {
  const seq = transcriptItemSeq(item);
  switch (item.kind) {
    case "user_message":
      return item.text.trim()
        ? {
          id,
          kind: "user",
          body: item.text,
          streaming: item.isStreaming,
          sourceRequestId: item.promptId ?? null,
          ...seq,
        }
        : null;
    case "assistant_prose":
      return item.text.trim()
        ? {
          id,
          kind: "assistant",
          body: item.text,
          streaming: item.isStreaming,
          ...seq,
        }
        : null;
    case "thought":
      return {
        id,
        kind: "thought",
        title: "Reasoning",
        body: previewText(item.text),
        status: item.isStreaming ? "streaming" : statusLabel(item.status),
        ...seq,
      };
    case "tool_call":
      return toolCallItemToRow(item, id);
    case "proposed_plan":
      return {
        id,
        kind: "proposed_plan",
        title: item.plan.title || "Plan",
        body: item.plan.bodyMarkdown,
        streaming: item.status === "in_progress",
        planId: item.plan.planId,
        planTitle: item.plan.title,
        planBodyMarkdown: item.plan.bodyMarkdown,
        planDecisionState: item.decision?.decisionState ?? null,
        planNativeResolutionState: item.decision?.nativeResolutionState ?? null,
        planDecisionVersion: item.decision?.decisionVersion ?? null,
        planErrorMessage: item.decision?.errorMessage ?? null,
        planNativeContinuation: Boolean(item.plan.sourceToolCallId),
        ...seq,
      };
    case "error":
      return {
        id,
        kind: "error",
        title: item.code ?? "Error",
        body: item.message,
        ...seq,
      };
    case "unknown":
      return {
        id,
        kind: "system",
        title: "Unknown event",
        detail: item.eventType,
        ...seq,
      };
    case "plan":
      return null;
  }
}

function toolCallItemToRow(
  item: ToolCallItem,
  id: string,
): CloudChatTranscriptRowView {
  const toolName = item.title
    ?? item.nativeToolName
    ?? (item.toolKind !== "other" ? item.toolKind : "Tool call");
  const display = describeToolCallDisplay(item, toolName);
  const command = getToolCallShellCommand(item);
  return {
    id,
    kind: "tool",
    title: display.label,
    detail: command ?? display.hint ?? item.nativeToolName ?? item.toolKind,
    body: previewText(toolOutputPreview(item)),
    status: statusLabel(item.status),
    sourceToolCallId: item.toolCallId ?? null,
    ...transcriptItemSeq(item),
  };
}

function buildRowsFromProjectedItems(
  items: readonly CloudTranscriptItem[],
): CloudChatTranscriptRowView[] {
  return [...items]
    .sort((left, right) => left.firstSeq - right.firstSeq)
    .map((item): CloudChatTranscriptRowView => {
      const kind = projectedItemKind(item);
      const plan = kind === "proposed_plan" ? projectedItemProposedPlan(item) : null;
      const decision = plan ? projectedItemProposedPlanDecision(item, plan.planId) : null;
      return {
        id: `projection:${item.itemId}`,
        kind,
        title: projectedItemTitle(item, kind),
        body: previewText(item.text ?? projectedPayloadText(item.payload)),
        status: projectedItemStatus(item),
        detail: projectedItemDetail(item, kind),
        firstSeq: item.firstSeq,
        lastSeq: item.lastSeq,
        sourceRequestId: kind === "user" ? projectedItemPromptId(item) : null,
        sourceToolCallId: kind === "tool" ? projectedItemToolCallId(item) : null,
        planId: plan?.planId ?? null,
        planTitle: plan?.title ?? null,
        planBodyMarkdown: plan?.bodyMarkdown ?? null,
        planDecisionState: decision?.decisionState ?? null,
        planNativeResolutionState: decision?.nativeResolutionState ?? null,
        planDecisionVersion: decision?.decisionVersion ?? null,
        planErrorMessage: decision?.errorMessage ?? null,
        planNativeContinuation: Boolean(plan?.sourceToolCallId),
      };
    });
}

function applyInteractionCommandDetails(
  rows: readonly CloudChatTranscriptRowView[],
  events: readonly CloudSessionEvent[],
): CloudChatTranscriptRowView[] {
  const commandsByToolCallId = interactionCommandTitlesByToolCallId(events);
  if (commandsByToolCallId.size === 0) {
    return [...rows];
  }
  return rows.map((row) => applyInteractionCommandDetailsToRow(row, commandsByToolCallId));
}

function applyInteractionCommandDetailsToRow(
  row: CloudChatTranscriptRowView,
  commandsByToolCallId: ReadonlyMap<string, string>,
): CloudChatTranscriptRowView {
  const children = row.children?.map((child) =>
    applyInteractionCommandDetailsToRow(child, commandsByToolCallId)
  );
  const command = row.sourceToolCallId
    ? commandsByToolCallId.get(row.sourceToolCallId)
    : null;
  if (!command) {
    return children ? { ...row, children } : row;
  }
  return {
    ...row,
    title: row.kind === "tool" ? "Command" : row.title,
    detail: command,
    children,
  };
}

function interactionCommandTitlesByToolCallId(
  events: readonly CloudSessionEvent[],
): Map<string, string> {
  const commands = new Map<string, string>();
  for (const event of events) {
    const envelope = event.envelope;
    if (!isSessionEventEnvelope(envelope)) {
      continue;
    }
    const eventPayload = envelope.event;
    if (!isRecord(eventPayload) || eventPayload.type !== "interaction_requested") {
      continue;
    }
    const title = normalizeProjectedShellTitle(readString(eventPayload.title));
    if (!title) {
      continue;
    }
    const source = isRecord(eventPayload.source)
      ? eventPayload.source as Record<string, unknown>
      : null;
    const toolCallId = readString(source?.toolCallId)
      ?? readString(source?.["tool_call_id"])
      ?? null;
    if (toolCallId) {
      commands.set(toolCallId, title);
    }
  }
  return commands;
}

function applyPendingInteractionRows(
  rows: readonly CloudChatTranscriptRowView[],
  pendingInteractions: readonly CloudPendingInteraction[],
  projectedItems: readonly CloudTranscriptItem[] = [],
): CloudChatTranscriptRowView[] {
  const rowsWithPermissions = applyPendingPermissionRows(rows, pendingInteractions);
  return appendPendingPromptRows(rowsWithPermissions, pendingInteractions, projectedItems);
}

interface PendingPermissionRowInfo {
  interaction: CloudPendingInteraction;
  title: string;
  description: string | null;
  toolCallId: string | null;
  itemId: string | null;
}

function applyPendingPermissionRows(
  rows: readonly CloudChatTranscriptRowView[],
  pendingInteractions: readonly CloudPendingInteraction[],
): CloudChatTranscriptRowView[] {
  const permissions = pendingInteractions
    .map(pendingPermissionRowInfo)
    .filter((info): info is PendingPermissionRowInfo => info !== null);
  if (permissions.length === 0) {
    return markStaleRunningToolRows(rows);
  }

  const unmatched = new Map(
    permissions.map((info) => [info.interaction.requestId, info]),
  );
  const annotatedRows = rows.map((row) => {
    const match = permissions.find((info) => pendingPermissionMatchesRow(info, row));
    if (!match) {
      return row;
    }
    unmatched.delete(match.interaction.requestId);
    return {
      ...row,
      detail: match.title || row.detail,
      body: row.body ?? match.description,
      status: pendingPermissionStatusLabel(match.interaction),
      sourceRequestId: match.interaction.requestId,
      sourceToolCallId: match.toolCallId ?? row.sourceToolCallId ?? null,
    };
  });

  const pendingRows = [...unmatched.values()]
    .sort((left, right) => left.interaction.requestedSeq - right.interaction.requestedSeq)
    .map((info): CloudChatTranscriptRowView => ({
      id: `pending-permission:${info.interaction.requestId}`,
      kind: "tool",
      title: "Command",
      body: info.description,
      detail: info.title,
      status: pendingPermissionStatusLabel(info.interaction),
      firstSeq: info.interaction.requestedSeq,
      lastSeq: info.interaction.requestedSeq,
      sourceRequestId: info.interaction.requestId,
      sourceToolCallId: info.toolCallId,
    }));

  const settledRows = markStaleRunningToolRows(annotatedRows);
  return pendingRows.length === 0 ? settledRows : [...settledRows, ...pendingRows];
}

function markStaleRunningToolRows(
  rows: readonly CloudChatTranscriptRowView[],
): CloudChatTranscriptRowView[] {
  return rows.map((row, index) => {
    if (!isRunningToolRow(row)) {
      return row;
    }
    const rowSeq = row.lastSeq ?? row.firstSeq;
    if (typeof rowSeq !== "number") {
      return row;
    }
    const laterTranscriptProgress = rows.slice(index + 1).some((laterRow) =>
      laterRow.kind !== "system"
      && typeof laterRow.firstSeq === "number"
      && laterRow.firstSeq > rowSeq
    );
    return laterTranscriptProgress ? { ...row, status: "Interrupted" } : row;
  });
}

function isRunningToolRow(row: CloudChatTranscriptRowView): boolean {
  if (row.kind !== "tool" && row.kind !== "tool_group") {
    return false;
  }
  const status = row.status?.toLowerCase();
  return status === "in progress" || status === "in_progress" || status === "running";
}

function pendingPermissionRowInfo(
  interaction: CloudPendingInteraction,
): PendingPermissionRowInfo | null {
  if (
    interaction.kind !== "permission"
    || (interaction.status !== "pending" && interaction.status !== "failed")
  ) {
    return null;
  }
  const payload = interaction.payload;
  const event = isRecord(payload?.event) ? payload.event : null;
  const source = event && isRecord(event.source) ? event.source : null;
  const title = interaction.title?.trim()
    || readString(event?.title)?.trim()
    || "Permission request";
  const description = interaction.description?.trim() || null;
  const toolCallId = readString(source?.toolCallId)
    ?? readString(payload?.itemId)
    ?? null;
  const itemId = readString(payload?.itemId) ?? toolCallId;
  return {
    interaction,
    title,
    description,
    toolCallId,
    itemId,
  };
}

function pendingPermissionMatchesRow(
  info: PendingPermissionRowInfo,
  row: CloudChatTranscriptRowView,
): boolean {
  if (row.kind !== "tool" && row.kind !== "tool_group") {
    return false;
  }
  if (info.toolCallId && row.sourceToolCallId === info.toolCallId) {
    return true;
  }
  if (info.itemId && row.id.includes(info.itemId)) {
    return true;
  }
  return false;
}

function pendingPermissionStatusLabel(interaction: CloudPendingInteraction): string {
  return interaction.status === "failed" ? "Approval failed" : "Needs approval";
}

function appendPendingPromptRows(
  rows: readonly CloudChatTranscriptRowView[],
  pendingInteractions: readonly CloudPendingInteraction[],
  projectedItems: readonly CloudTranscriptItem[] = [],
): CloudChatTranscriptRowView[] {
  const pendingRows = buildRowsFromPendingPromptInteractions(
    rows,
    pendingInteractions,
    projectedItems,
  );
  return pendingRows.length === 0 ? [...rows] : [...rows, ...pendingRows];
}

function buildRowsFromPendingPromptInteractions(
  existingRows: readonly CloudChatTranscriptRowView[],
  pendingInteractions: readonly CloudPendingInteraction[],
  projectedItems: readonly CloudTranscriptItem[],
): CloudChatTranscriptRowView[] {
  const rows: CloudChatTranscriptRowView[] = [];
  for (const interaction of pendingInteractions) {
    if (
      (interaction.status !== "pending" && interaction.status !== "failed")
      || interaction.kind !== "send_prompt"
    ) {
      continue;
    }
    const text = pendingPromptText(interaction);
    const commandId = pendingPromptCommandId(interaction);
    if (!text) {
      continue;
    }
    const promptItem = projectedPromptItemForPendingInteraction(
      projectedItems,
      interaction,
      text,
    );
    const promptRowIndex = findLastMatchingUserRowIndex(existingRows, interaction, text);
    const promptVisible = promptItem !== null
      || promptRowIndex !== -1;
    const agentProgressVisible = promptItem
      ? projectedAgentProgressAfterPrompt(projectedItems, promptItem)
      : promptRowIndex !== -1
        ? rowHasAgentProgressAfter(existingRows, promptRowIndex)
        : rowsHaveAgentProgressAfterSeq(existingRows, interaction.requestedSeq);
    const failed = interaction.status === "failed";
    if (!promptVisible) {
      rows.push({
        id: `pending-prompt:${interaction.requestId}:user`,
        kind: "user",
        body: text,
        status: failed ? "Failed" : "Queued",
        streaming: !failed,
        sourceRequestId: interaction.requestId,
        sourceCommandId: commandId,
      });
    }
    if (!failed && agentProgressVisible) {
      continue;
    }
    rows.push({
      id: `pending-prompt:${interaction.requestId}:assistant-waiting`,
      kind: failed ? "error" : "assistant",
      body: failed
        ? interaction.description
          ?? "Prompt could not be delivered."
        : null,
      detail: failed ? null : interaction.description ?? "Waiting for response.",
      streaming: !failed,
      sourceRequestId: interaction.requestId,
      sourceCommandId: commandId,
    });
  }
  return rows;
}

function pendingPromptText(interaction: CloudPendingInteraction): string | null {
  const payload = interaction.payload;
  if (!payload) {
    return null;
  }
  const text = readString(payload.text)
    ?? readString(payload.prompt)
    ?? readString(payload.message)
    ?? readString(payload.content);
  const trimmed = text?.trim();
  return trimmed ? trimmed : null;
}

function pendingPromptCommandId(interaction: CloudPendingInteraction): string | null {
  const payload = interaction.payload;
  if (!payload) {
    return null;
  }
  const commandId = payload.commandId;
  return typeof commandId === "string" && commandId.trim() ? commandId.trim() : null;
}

function projectedPromptItemForPendingInteraction(
  items: readonly CloudTranscriptItem[],
  interaction: CloudPendingInteraction,
  text: string,
): CloudTranscriptItem | null {
  return [...items]
    .filter((item) =>
      isPromptTranscriptKind(item.kind)
      && (
        projectedItemPromptId(item) === interaction.requestId
        || (
          item.firstSeq > interaction.requestedSeq
          && textMatches(item.text, text)
        )
      )
    )
    .sort((left, right) => right.lastSeq - left.lastSeq)[0] ?? null;
}

function projectedAgentProgressAfterPrompt(
  items: readonly CloudTranscriptItem[],
  promptItem: CloudTranscriptItem,
): boolean {
  return items.some((item) =>
    item.firstSeq > promptItem.lastSeq && !isPromptTranscriptKind(item.kind)
  );
}

function findLastMatchingUserRowIndex(
  rows: readonly CloudChatTranscriptRowView[],
  interaction: CloudPendingInteraction,
  text: string,
): number {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (
      row.kind === "user"
      && (
        row.sourceRequestId === interaction.requestId
        || (
          rowIsAfterSeq(row, interaction.requestedSeq)
          && textMatches(row.body, text)
        )
      )
    ) {
      return index;
    }
  }
  return -1;
}

function rowHasAgentProgressAfter(
  rows: readonly CloudChatTranscriptRowView[],
  promptRowIndex: number,
): boolean {
  const promptRow = rows[promptRowIndex];
  const promptSeq = promptRow.lastSeq ?? promptRow.firstSeq ?? null;
  return rows.slice(promptRowIndex + 1).some((row) =>
    row.kind !== "user"
    && row.kind !== "system"
    && (
      typeof promptSeq !== "number"
      || typeof row.firstSeq !== "number"
      || row.firstSeq > promptSeq
    )
  );
}

function rowsHaveAgentProgressAfterSeq(
  rows: readonly CloudChatTranscriptRowView[],
  seq: number,
): boolean {
  return rows.some((row) =>
    row.kind !== "user"
    && row.kind !== "system"
    && rowIsAfterSeq(row, seq)
  );
}

function isPromptTranscriptKind(kind: string | null | undefined): boolean {
  return kind === "user_message" || kind === "prompt";
}

function transcriptItemSeq(item: TranscriptItem): { firstSeq: number; lastSeq: number } {
  return {
    firstSeq: item.startedSeq,
    lastSeq: "lastUpdatedSeq" in item
      ? item.completedSeq ?? item.lastUpdatedSeq
      : item.startedSeq,
  };
}

function projectedItemKind(item: CloudTranscriptItem): CloudChatTranscriptRowView["kind"] {
  switch (item.kind) {
    case "user_message":
    case "prompt":
      return "user";
    case "assistant_message":
    case "assistant_prose":
      return "assistant";
    case "proposed_plan":
      return "proposed_plan";
    case "reasoning":
    case "thought":
      return "thought";
    case "tool":
    case "tool_call":
    case "tool_invocation":
      return "tool";
    case "error":
    case "error_item":
      return "error";
    default:
      return "system";
  }
}

function projectedItemTitle(
  item: CloudTranscriptItem,
  kind: CloudChatTranscriptRowView["kind"],
): string | null {
  if (kind === "user" || kind === "assistant") {
    return null;
  }
  if (kind === "tool" && projectedItemLooksLikeShellTool(item)) {
    return "Command";
  }
  const title = cleanedProjectedTitle(item.title, item.kind);
  if (title) {
    return title;
  }
  switch (kind) {
    case "thought":
      return "Reasoning";
    case "tool":
    case "tool_group":
      return "Tool call";
    case "error":
      return "Error";
    case "system":
    default:
      return null;
  }
}

function projectedItemStatus(item: CloudTranscriptItem): string | null {
  const status = item.status?.trim();
  if (!status || status === "completed") {
    return null;
  }
  return status;
}

function projectedItemDetail(
  item: CloudTranscriptItem,
  kind: CloudChatTranscriptRowView["kind"],
): string | null {
  if (kind === "tool") {
    return projectedItemShellCommand(item);
  }
  return null;
}

function cleanedProjectedTitle(
  title: string | null | undefined,
  itemKind: string | null | undefined,
): string | null {
  const value = title?.trim();
  if (!value || value === itemKind) {
    return null;
  }
  return value;
}

function toolOutputPreview(item: ToolCallItem): string | null {
  const chunks: string[] = [];
  for (const part of item.contentParts) {
    if (!isRecord(part)) {
      continue;
    }
    if (part.type === "terminal_output" && part.event === "output") {
      chunks.push(readString(part.data) ?? "");
    } else if (part.type === "tool_result_text") {
      chunks.push(readString(part.text) ?? "");
    }
  }
  const output = chunks.join("").trim();
  if (output) {
    return output;
  }
  if (typeof item.rawOutput === "string") {
    return item.rawOutput;
  }
  return null;
}

function projectedPayloadText(payload: CloudTranscriptItem["payload"]): string | null {
  if (!payload) {
    return null;
  }
  const text = readString(payload.text)
    ?? readString(payload.message)
    ?? readString(payload.content)
    ?? readString(payload.output);
  return text ?? null;
}

function projectedItemProposedPlan(
  item: CloudTranscriptItem,
): Extract<ContentPart, { type: "proposed_plan" }> | null {
  const payloadItem = projectedPayloadItem(item.payload);
  const parts = payloadItem?.contentParts;
  if (!Array.isArray(parts)) {
    return null;
  }
  return parts.find((part): part is Extract<ContentPart, { type: "proposed_plan" }> =>
    isRecord(part) && part.type === "proposed_plan"
  ) ?? null;
}

function projectedItemProposedPlanDecision(
  item: CloudTranscriptItem,
  planId: string,
): Extract<ContentPart, { type: "proposed_plan_decision" }> | null {
  const payloadItem = projectedPayloadItem(item.payload);
  const parts = payloadItem?.contentParts;
  if (!Array.isArray(parts)) {
    return null;
  }
  return parts.find((part): part is Extract<ContentPart, { type: "proposed_plan_decision" }> =>
    isRecord(part)
    && part.type === "proposed_plan_decision"
    && part.planId === planId
  ) ?? null;
}

function projectedItemShellCommand(item: CloudTranscriptItem): string | null {
  if (!projectedItemLooksLikeShellTool(item)) {
    return null;
  }
  const payloadItem = projectedPayloadItem(item.payload);
  const titles = [
    item.title,
    readString(payloadItem?.title),
    ...projectedToolCallContentParts(payloadItem).map((part) => readString(part.title)),
  ];
  for (const title of titles) {
    const command = normalizeProjectedShellTitle(title);
    if (command) {
      return command;
    }
  }
  return null;
}

function projectedItemLooksLikeShellTool(item: CloudTranscriptItem): boolean {
  const payloadItem = projectedPayloadItem(item.payload);
  const values = [
    item.title,
    readString(payloadItem?.nativeToolName),
    readString(payloadItem?.toolKind),
    ...projectedToolCallContentParts(payloadItem).flatMap((part) => [
      readString(part.nativeToolName),
      readString(part.toolKind),
    ]),
  ];
  return values.some((value) => {
    const normalized = value?.trim().toLowerCase();
    return normalized === "bash"
      || normalized === "shell"
      || normalized === "terminal"
      || normalized === "execute";
  });
}

function projectedPayloadItem(
  payload: CloudTranscriptItem["payload"],
): Record<string, unknown> | null {
  if (!payload) {
    return null;
  }
  const event = payload.event;
  if (!isRecord(event)) {
    return null;
  }
  return isRecord(event.item) ? event.item : null;
}

function projectedToolCallContentParts(
  payloadItem: Record<string, unknown> | null,
): Record<string, unknown>[] {
  const contentParts = payloadItem?.contentParts;
  if (!Array.isArray(contentParts)) {
    return [];
  }
  return contentParts.flatMap((part) => {
    const record = isRecord(part) ? part : null;
    return record?.type === "tool_call" ? [record] : [];
  });
}

function normalizeProjectedShellTitle(value: string | null | undefined): string | null {
  const title = value?.trim();
  if (!title) {
    return null;
  }
  const normalized = title.toLowerCase();
  if (
    normalized === "terminal"
    || normalized === "command"
    || normalized === "bash"
    || normalized === "shell"
    || normalized === "tool call"
  ) {
    return null;
  }
  return title;
}

function projectedItemPromptId(item: CloudTranscriptItem): string | null {
  const payload = item.payload;
  if (!payload) {
    return null;
  }
  const directPromptId = readString(payload.promptId);
  if (directPromptId) {
    return directPromptId;
  }
  const event = payload.event;
  if (!isRecord(event)) {
    return null;
  }
  const eventItem = event.item;
  if (!isRecord(eventItem)) {
    return null;
  }
  return readString(eventItem.promptId);
}

function projectedItemToolCallId(item: CloudTranscriptItem): string | null {
  const payload = item.payload;
  if (!payload) {
    return item.itemId;
  }
  const directToolCallId = readString(payload.toolCallId)
    ?? readString(payload.tool_call_id);
  if (directToolCallId) {
    return directToolCallId;
  }
  const event = payload.event;
  if (isRecord(event)) {
    const eventItem = event.item;
    if (isRecord(eventItem)) {
      const eventToolCallId = readString(eventItem.toolCallId)
        ?? readString(eventItem.tool_call_id);
      if (eventToolCallId) {
        return eventToolCallId;
      }
    }
    const source = event.source;
    if (isRecord(source)) {
      const sourceToolCallId = readString(source.toolCallId)
        ?? readString(source.tool_call_id);
      if (sourceToolCallId) {
        return sourceToolCallId;
      }
    }
  }
  return readString(payload.itemId) ?? item.itemId;
}

function resolveGroupStatus(
  itemIds: readonly string[],
  transcript: TranscriptState,
): string | undefined {
  return itemIds.some((itemId) => {
    const item = transcript.itemsById[itemId];
    return item?.kind === "tool_call" && item.status !== "completed" && item.status !== "failed";
  })
    ? "running"
    : "completed";
}

function statusLabel(status: string | null | undefined): string | undefined {
  if (!status) {
    return undefined;
  }
  return status.replace(/_/g, " ");
}

function transcriptItemStatus(item: TranscriptItem): TranscriptItemStatus | null {
  return item.kind === "unknown" ? null : item.status;
}

function transcriptItemCompletedAt(item: TranscriptItem | null): string | null {
  if (!item || item.kind === "unknown") {
    return null;
  }
  return item.completedAt;
}

function previewText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length <= MAX_BODY_PREVIEW_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_BODY_PREVIEW_LENGTH).trimEnd()}\n...`;
}

function formatCount(count: number, singular: string): string | null {
  if (count <= 0) {
    return null;
  }
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function isSessionEventEnvelope(value: unknown): value is SessionEventEnvelope {
  if (!isRecord(value) || !isRecord(value.event)) {
    return false;
  }
  return typeof value.sessionId === "string"
    && typeof value.seq === "number"
    && typeof value.event.type === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isPromptItemForOptimisticPrompt(
  item: CloudTranscriptItem,
  prompt: CloudOptimisticPromptReference,
): boolean {
  return item.firstSeq > prompt.baseTranscriptSeq
    && isPromptTranscriptKind(item.kind)
    && textMatches(item.text, prompt.text);
}

function rowIsAfterPromptBaseline(
  row: CloudChatTranscriptRowView,
  prompt: CloudOptimisticPromptReference,
): boolean {
  return typeof row.firstSeq === "number" && row.firstSeq > prompt.baseTranscriptSeq;
}

function rowIsAfterSeq(row: CloudChatTranscriptRowView, seq: number): boolean {
  return typeof row.firstSeq === "number" && row.firstSeq > seq;
}

function textMatches(value: string | null | undefined, expected: string): boolean {
  return normalizePromptText(value) === normalizePromptText(expected);
}

function normalizePromptText(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}
