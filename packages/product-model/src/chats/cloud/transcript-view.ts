import type {
  SessionEventEnvelope,
  TranscriptItem,
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
  | "user";

export interface CloudChatTranscriptRowView {
  id: string;
  kind: CloudChatTranscriptRowKind;
  title?: string | null;
  body?: string | null;
  detail?: string | null;
  status?: string | null;
  streaming?: boolean;
  firstSeq?: number | null;
  lastSeq?: number | null;
  sourceRequestId?: string | null;
  sourceCommandId?: string | null;
}

export interface CloudTranscriptViewResult {
  rows: CloudChatTranscriptRowView[];
  source: "empty" | "events" | "projection";
  envelopeCount: number;
  missingEnvelopeCount: number;
}

export interface CloudOptimisticPromptReference {
  text: string;
  baseTranscriptSeq: number;
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

  const envelopes = input.events
    .map((event) => event.envelope)
    .filter(isSessionEventEnvelope);
  const missingEnvelopeCount = input.events.length - envelopes.length;

  if (envelopes.length > 0) {
    const transcript = reconstructTranscriptState(
      input.sessionId,
      envelopes as SessionEventEnvelope[],
    );
    const rows = buildRowsFromTranscriptState(transcript);
    if (rows.length > 0 && shouldUseEventRows(input, rows, missingEnvelopeCount)) {
      const rowsWithPending = appendPendingPromptRows(
        rows,
        input.pendingInteractions ?? [],
        input.fallbackItems,
      );
      return {
        rows: rowsWithPending,
        source: "events",
        envelopeCount: envelopes.length,
        missingEnvelopeCount,
      };
    }
  }

  if (input.fallbackItems.length > 0) {
    return {
      rows: appendPendingPromptRows(
        buildRowsFromProjectedItems(input.fallbackItems),
        input.pendingInteractions ?? [],
        input.fallbackItems,
      ),
      source: "projection",
      envelopeCount: envelopes.length,
      missingEnvelopeCount,
    };
  }

  return {
    rows: appendPendingPromptRows([], input.pendingInteractions ?? []),
    source: "empty",
    envelopeCount: envelopes.length,
    missingEnvelopeCount,
  };
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
  return latestTranscriptRowSeq(rows) >= latestProjectedItemSeq(input.fallbackItems);
}

function latestProjectedItemSeq(items: readonly CloudTranscriptItem[]): number {
  return items.reduce(
    (maxSeq, item) => Math.max(maxSeq, item.lastSeq, item.completedSeq ?? 0),
    0,
  );
}

function latestTranscriptRowSeq(rows: readonly CloudChatTranscriptRowView[]): number {
  return rows.reduce((maxSeq, row) => Math.max(maxSeq, row.lastSeq ?? row.firstSeq ?? 0), 0);
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
        rows.push({
          id: `${row.key}:completed-history`,
          kind: "system",
          title: "Work history",
          detail: fragments.join(", "),
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
      if (block.kind === "collapsed_actions") {
        const summary = summarizeCollapsedActions(block.itemIds, transcript);
        rows.push({
          id: `${row.key}:${block.blockId}`,
          kind: "tool_group",
          title: formatCollapsedActionsSummary(summary),
          detail: formatCount(block.itemIds.length, "action") ?? undefined,
          status: resolveGroupStatus(block.itemIds, transcript),
        });
        continue;
      }
      for (const itemId of block.itemIds) {
        appendItemRows(itemId, row, transcript, rows);
      }
      continue;
    }

    appendItemRows(block.itemId, row, transcript, rows);
  }

  return rows;
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
        kind: "assistant",
        title: item.plan.title || "Plan",
        body: item.plan.bodyMarkdown,
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
  const toolName = item.title ?? item.nativeToolName ?? item.toolKind ?? "Tool call";
  const display = describeToolCallDisplay(item, toolName);
  const command = getToolCallShellCommand(item);
  return {
    id,
    kind: "tool",
    title: display.label,
    detail: command ?? display.hint ?? item.nativeToolName ?? item.toolKind,
    body: previewText(toolOutputPreview(item)),
    status: statusLabel(item.status),
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
      return {
        id: `projection:${item.itemId}`,
        kind,
        title: item.title ?? item.kind ?? "Projected event",
        body: previewText(item.text ?? projectedPayloadText(item.payload)),
        status: item.status ?? undefined,
        detail: item.sourceAgentKind ?? undefined,
        firstSeq: item.firstSeq,
        lastSeq: item.lastSeq,
        sourceRequestId: kind === "user" ? projectedItemPromptId(item) : null,
      };
    });
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
        && rowHasAgentProgressAfter(existingRows, promptRowIndex);
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
      body: interaction.description ?? (failed
        ? "Prompt could not be delivered."
        : "Waiting for response."),
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
