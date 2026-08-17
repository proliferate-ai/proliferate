import {
  createTranscriptState,
  type ContentPart,
  type ToolCallItem,
  type TranscriptState,
  type TurnRecord,
} from "@anyharness/sdk";

export const LARGE_INTERRUPTED_TURN_ID = "large-interrupted-turn";
export const LARGE_INTERRUPTED_TURN_STARTED_AT = "2026-04-04T00:00:00Z";
export const LARGE_INTERRUPTED_TURN_COMPLETED_AT = "2026-04-04T00:07:02Z";

export interface LargeInterruptedCompletedTurnFixture {
  transcript: TranscriptState;
  turn: TurnRecord;
  itemIds: string[];
  toolItemIds: string[];
  assistantItemIds: string[];
  userItemId: string;
  completedHistoryItemIds: string[];
  mutationReceiptItemIds: string[];
}

/**
 * Preserves the production invariants for a large completed turn: 152 unique
 * items (146 tools, five assistant messages, and one user message), with four
 * history runs separated by Agent Operations mutation receipts. Row output
 * remains owned by the production projection.
 */
export function createLargeInterruptedCompletedTurnFixture(
): LargeInterruptedCompletedTurnFixture {
  const transcript = createTranscriptState("large-interrupted-session");
  const turn: TurnRecord = {
    turnId: LARGE_INTERRUPTED_TURN_ID,
    itemOrder: [],
    startedAt: LARGE_INTERRUPTED_TURN_STARTED_AT,
    completedAt: LARGE_INTERRUPTED_TURN_COMPLETED_AT,
    stopReason: "end_turn",
    fileBadges: [],
  };
  transcript.turnOrder.push(turn.turnId);
  transcript.turnsById[turn.turnId] = turn;

  const itemIds: string[] = [];
  const toolItemIds: string[] = [];
  const assistantItemIds: string[] = [];
  const completedHistoryItemIds: string[] = [];
  const mutationReceiptItemIds: string[] = [];
  let startedSeq = 1;

  const appendItem = (item: TranscriptState["itemsById"][string]) => {
    transcript.itemsById[item.itemId] = item;
    turn.itemOrder.push(item.itemId);
    itemIds.push(item.itemId);
    startedSeq += 1;
  };

  const userItemId = "large-interrupted-user";
  appendItem(userItem(userItemId, turn.turnId, startedSeq));

  const historyToolCounts = [36, 36, 36, 35];
  let historyToolIndex = 0;
  historyToolCounts.forEach((toolCount, runIndex) => {
    const assistantId = `large-interrupted-history-assistant-${runIndex + 1}`;
    appendItem(assistantItem(assistantId, turn.turnId, startedSeq));
    assistantItemIds.push(assistantId);
    completedHistoryItemIds.push(assistantId);

    for (let index = 0; index < toolCount; index += 1) {
      historyToolIndex += 1;
      const toolId = `large-interrupted-history-tool-${historyToolIndex}`;
      appendItem(toolItem(toolId, turn.turnId, startedSeq, "file_read"));
      toolItemIds.push(toolId);
      completedHistoryItemIds.push(toolId);
    }

    if (runIndex < historyToolCounts.length - 1) {
      const receiptId = `large-interrupted-mutation-receipt-${runIndex + 1}`;
      appendItem({
        ...toolItem(receiptId, turn.turnId, startedSeq, "other"),
        title: "Send message",
        nativeToolName: "mcp__proliferate_workspace__send_message",
        rawInput: {
          agentId: `large-interrupted-agent-${runIndex + 1}`,
          message: `Continue fixture run ${runIndex + 2}`,
        },
      });
      toolItemIds.push(receiptId);
      mutationReceiptItemIds.push(receiptId);
    }
  });

  const finalAssistantId = "large-interrupted-final-assistant";
  appendItem(assistantItem(finalAssistantId, turn.turnId, startedSeq));
  assistantItemIds.push(finalAssistantId);

  return {
    transcript,
    turn,
    itemIds,
    toolItemIds,
    assistantItemIds,
    userItemId,
    completedHistoryItemIds,
    mutationReceiptItemIds,
  };
}

export function range<T>(count: number, prefix: string, build: (id: string, seq: number) => T): T[] {
  return Array.from({ length: count }, (_, idx) => build(`${prefix}-${idx + 1}`, idx + 1));
}

export function turnRecord(itemOrder: string[], completedAt: string | null = null): TurnRecord {
  return {
    turnId: "turn-1",
    itemOrder,
    startedAt: "2026-04-04T00:00:00Z",
    completedAt,
    stopReason: completedAt ? "end_turn" : null,
    fileBadges: [],
  };
}

export function assistantItem(
  itemId: string,
  turnId: string,
  startedSeq: number,
  parentToolCallId: string | null = null,
) {
  return {
    kind: "assistant_prose" as const,
    itemId,
    turnId,
    status: "completed" as const,
    sourceAgentKind: "claude",
    messageId: null,
    title: null,
    nativeToolName: null,
    parentToolCallId,
    contentParts: [],
    timestamp: "2026-04-04T00:00:00Z",
    startedSeq,
    lastUpdatedSeq: startedSeq,
    completedSeq: startedSeq,
    completedAt: "2026-04-04T00:00:00Z",
    text: itemId,
    isStreaming: false,
  };
}

export function userItem(itemId: string, turnId: string, startedSeq: number) {
  return {
    kind: "user_message" as const,
    itemId,
    turnId,
    status: "completed" as const,
    sourceAgentKind: "claude",
    messageId: null,
    title: null,
    nativeToolName: null,
    parentToolCallId: null,
    contentParts: [],
    timestamp: "2026-04-04T00:00:00Z",
    startedSeq,
    lastUpdatedSeq: startedSeq,
    completedSeq: startedSeq,
    completedAt: "2026-04-04T00:00:00Z",
    text: itemId,
    isStreaming: false,
  };
}

export function toolItem(
  itemId: string,
  turnId: string,
  startedSeq: number,
  semanticKind: ToolCallItem["semanticKind"] = "other",
  status: ToolCallItem["status"] = "completed",
): ToolCallItem {
  return {
    kind: "tool_call",
    itemId,
    turnId,
    status,
    sourceAgentKind: "claude",
    messageId: null,
    title: "Tool call",
    nativeToolName: semanticKind === "terminal" ? "Bash" : null,
    parentToolCallId: null,
    contentParts: contentPartsFor(semanticKind, itemId),
    timestamp: "2026-04-04T00:00:00Z",
    startedSeq,
    lastUpdatedSeq: startedSeq,
    completedSeq: status === "in_progress" ? null : startedSeq,
    completedAt: status === "in_progress" ? null : "2026-04-04T00:00:00Z",
    toolCallId: itemId,
    toolKind: semanticKind === "terminal" ? "execute" : "other",
    semanticKind,
    approvalState: "none",
  };
}

export function terminalItem(
  itemId: string,
  turnId: string,
  startedSeq: number,
  command?: string,
  status: ToolCallItem["status"] = "completed",
): ToolCallItem {
  const item = {
    ...toolItem(itemId, turnId, startedSeq, "terminal", status),
  };
  if (command !== undefined) {
    item.rawInput = { command };
  }
  return item;
}

export function terminalCmdItem(
  itemId: string,
  turnId: string,
  startedSeq: number,
  cmd: string,
  status: ToolCallItem["status"] = "completed",
): ToolCallItem {
  return {
    ...toolItem(itemId, turnId, startedSeq, "terminal", status),
    rawInput: { cmd },
  };
}

export function parsedCommandItem(
  itemId: string,
  turnId: string,
  startedSeq: number,
  parsedCommands: Array<{
    type: string;
    cmd: string;
    name?: string;
    path?: string;
    query?: string;
  }>,
  status: ToolCallItem["status"] = "in_progress",
): ToolCallItem {
  return {
    ...toolItem(itemId, turnId, startedSeq, "terminal", status),
    contentParts: [{
      type: "tool_call",
      toolCallId: itemId,
      title: "Bash",
      toolKind: "execute",
      nativeToolName: "Bash",
    }],
    rawInput: {
      command: ["/bin/zsh", "-lc", "ops=(); for op in \"${ops[@]}\"; do eval \"$op\"; done"],
      parsed_cmd: parsedCommands,
    },
  };
}

export function bareNativeToolItem(
  itemId: string,
  turnId: string,
  startedSeq: number,
  nativeToolName: string,
  toolKind: string,
  status: ToolCallItem["status"] = "completed",
): ToolCallItem {
  return {
    ...toolItem(itemId, turnId, startedSeq, "other", status),
    title: nativeToolName === "Read" ? "Read File" : nativeToolName,
    nativeToolName,
    toolKind,
    semanticKind: "other",
    contentParts: [{
      type: "tool_call",
      toolCallId: itemId,
      title: nativeToolName === "Read" ? "Read File" : nativeToolName,
      toolKind,
      nativeToolName,
    }],
  };
}

function contentPartsFor(
  semanticKind: ToolCallItem["semanticKind"],
  itemId: string,
): ContentPart[] {
  if (semanticKind === "file_read") {
    return [{ type: "file_read", path: `${itemId}.ts`, basename: `${itemId}.ts`, workspacePath: `${itemId}.ts`, scope: "full" }];
  }
  if (semanticKind === "file_change") {
    return [{
      type: "file_change",
      operation: "edit",
      path: `${itemId}.ts`,
      basename: `${itemId}.ts`,
      workspacePath: `${itemId}.ts`,
      additions: 1,
      deletions: 1,
      patch: null,
      preview: null,
      openTarget: null,
    }];
  }
  if (semanticKind === "terminal") {
    return [{ type: "terminal_output", terminalId: itemId, event: "output", data: "ok" }];
  }
  return [];
}

export function thoughtItem(
  itemId: string,
  turnId: string,
  startedSeq: number,
  isTransient: boolean,
) {
  return {
    kind: "thought" as const,
    itemId,
    turnId,
    status: "in_progress" as const,
    sourceAgentKind: "codex",
    isTransient,
    messageId: null,
    title: null,
    nativeToolName: null,
    parentToolCallId: null,
    contentParts: [{ type: "reasoning" as const, text: itemId, visibility: "private" as const }],
    timestamp: "2026-04-04T00:00:00Z",
    startedSeq,
    lastUpdatedSeq: startedSeq,
    completedSeq: null,
    completedAt: null,
    text: itemId,
    isStreaming: true,
  };
}
