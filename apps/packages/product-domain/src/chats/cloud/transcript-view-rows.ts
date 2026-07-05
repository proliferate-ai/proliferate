import type {
  ToolCallItem,
  TranscriptItem,
  TranscriptState,
} from "@anyharness/sdk";
import {
  formatCollapsedActionsSummary,
  summarizeCollapsedActions,
} from "../transcript/transcript-collapsed-actions";
import {
  buildTranscriptVirtualRows,
  type TranscriptVirtualRow,
} from "../transcript/transcript-virtual-rows";
import { describeToolCallDisplay } from "../tools/tool-call-display";
import { getToolCallShellCommand } from "../transcript/transcript-tool-commands";
import { blockBelongsToCompletedHistory } from "../transcript/transcript-rendering";
import { turnHasAssistantRenderableTranscriptContent } from "../pending-prompts/pending-prompts";
import type { CloudChatTranscriptRowView } from "./transcript-view-model";
import {
  formatCount,
  previewText,
  statusLabel,
  transcriptItemSeq,
} from "./transcript-view-utils";

export function buildRowsFromTranscriptState(
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

export function buildRowsFromTurnRow(
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
            appendDisplayBlockRows(historyBlock, row, transcript, historyRows, {
              preserveCollapsedGroups: true,
            });
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

    appendDisplayBlockRows(block, row, transcript, rows);
  }

  return rows;
}

function appendDisplayBlockRows(
  block: Extract<TranscriptVirtualRow, { kind: "turn" }>["renderPresentation"]["displayBlocks"][number],
  row: Extract<TranscriptVirtualRow, { kind: "turn" }>,
  transcript: TranscriptState,
  rows: CloudChatTranscriptRowView[],
  options: { preserveCollapsedGroups?: boolean } = {},
): void {
  if (block.kind === "collapsed_actions") {
    if (!options.preserveCollapsedGroups && block.itemIds.length === 1) {
      appendItemRows(block.itemIds[0] ?? "", row, transcript, rows);
      return;
    }
    const summary = summarizeCollapsedActions(block.itemIds, transcript);
    const status = resolveGroupStatus(block.itemIds, transcript);
    rows.push({
      id: `${row.key}:${block.blockId}`,
      kind: "tool_group",
      title: formatCollapsedActionsSummary(summary, { active: status === "running" }),
      status,
    });
    return;
  }

  if (
    block.kind === "inline_tools"
    || block.kind === "subagent_creations"
    || block.kind === "subagent_activity"
  ) {
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

function toolOutputPreview(item: ToolCallItem): string | null {
  const chunks: string[] = [];
  for (const part of item.contentParts) {
    if (typeof part !== "object" || part === null) {
      continue;
    }
    if (part.type === "terminal_output" && part.event === "output") {
      chunks.push(typeof part.data === "string" ? part.data : "");
    } else if (part.type === "tool_result_text") {
      chunks.push(typeof part.text === "string" ? part.text : "");
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
