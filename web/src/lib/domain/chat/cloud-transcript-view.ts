import type {
  SessionEventEnvelope,
  TranscriptItem,
  TranscriptState,
  ToolCallItem,
} from "@anyharness/sdk";
import type {
  CloudSessionEvent,
  CloudTranscriptItem,
} from "@proliferate/cloud-sdk";
import type { CloudChatTranscriptRowView } from "@proliferate/product-ui/chat/CloudChatTranscript";
import {
  formatCollapsedActionsSummary,
  summarizeCollapsedActions,
} from "@proliferate/product-model/chats/transcript/transcript-collapsed-actions";
import { reconstructTranscriptState } from "@proliferate/product-model/chats/transcript/envelope-to-state";
import {
  buildTranscriptVirtualRows,
  type TranscriptVirtualRow,
} from "@proliferate/product-model/chats/transcript/transcript-virtual-rows";
import { describeToolCallDisplay } from "@proliferate/product-model/chats/tools/tool-call-display";
import { getToolCallShellCommand } from "@proliferate/product-model/chats/transcript/transcript-tool-commands";
import {
  blockBelongsToCompletedHistory,
} from "@proliferate/product-model/chats/transcript/transcript-rendering";
import {
  turnHasAssistantRenderableTranscriptContent,
} from "@proliferate/product-model/chats/pending-prompts/pending-prompts";

const MAX_BODY_PREVIEW_LENGTH = 2_000;

export interface CloudTranscriptViewResult {
  rows: CloudChatTranscriptRowView[];
  source: "empty" | "events" | "projection";
  envelopeCount: number;
  missingEnvelopeCount: number;
}

export function buildCloudTranscriptView(input: {
  sessionId: string | null;
  events: readonly CloudSessionEvent[];
  fallbackItems: readonly CloudTranscriptItem[];
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
    if (rows.length > 0 && !projectionIsAhead(input.fallbackItems, input.events)) {
      return {
        rows,
        source: "events",
        envelopeCount: envelopes.length,
        missingEnvelopeCount,
      };
    }
  }

  if (input.fallbackItems.length > 0) {
    return {
      rows: buildRowsFromProjectedItems(input.fallbackItems),
      source: "projection",
      envelopeCount: envelopes.length,
      missingEnvelopeCount,
    };
  }

  return {
    rows: [],
    source: "empty",
    envelopeCount: envelopes.length,
    missingEnvelopeCount,
  };
}

function projectionIsAhead(
  items: readonly CloudTranscriptItem[],
  events: readonly CloudSessionEvent[],
): boolean {
  return latestProjectedItemSeq(items) > latestEventSeq(events);
}

function latestProjectedItemSeq(items: readonly CloudTranscriptItem[]): number {
  return items.reduce(
    (maxSeq, item) => Math.max(maxSeq, item.lastSeq, item.completedSeq ?? 0),
    0,
  );
}

function latestEventSeq(events: readonly CloudSessionEvent[]): number {
  return events.reduce((maxSeq, event) => Math.max(maxSeq, event.seq), 0);
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
  switch (item.kind) {
    case "user_message":
      return item.text.trim()
        ? {
          id,
          kind: "user",
          body: item.text,
          streaming: item.isStreaming,
        }
        : null;
    case "assistant_prose":
      return item.text.trim()
        ? {
          id,
          kind: "assistant",
          body: item.text,
          streaming: item.isStreaming,
        }
        : null;
    case "thought":
      return {
        id,
        kind: "thought",
        title: "Reasoning",
        body: previewText(item.text),
        status: item.isStreaming ? "streaming" : statusLabel(item.status),
      };
    case "tool_call":
      return toolCallItemToRow(item, id);
    case "proposed_plan":
      return {
        id,
        kind: "assistant",
        title: item.plan.title || "Plan",
        body: item.plan.bodyMarkdown,
      };
    case "error":
      return {
        id,
        kind: "error",
        title: item.code ?? "Error",
        body: item.message,
      };
    case "unknown":
      return {
        id,
        kind: "system",
        title: "Unknown event",
        detail: item.eventType,
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
  };
}

function buildRowsFromProjectedItems(
  items: readonly CloudTranscriptItem[],
): CloudChatTranscriptRowView[] {
  return [...items]
    .sort((left, right) => left.firstSeq - right.firstSeq)
    .map((item): CloudChatTranscriptRowView => ({
      id: `projection:${item.itemId}`,
      kind: projectedItemKind(item),
      title: item.title ?? item.kind ?? "Projected event",
      body: previewText(item.text ?? projectedPayloadText(item.payload)),
      status: item.status ?? undefined,
      detail: item.sourceAgentKind ?? undefined,
    }));
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
