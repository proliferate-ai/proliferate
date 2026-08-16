import {
  createTranscriptState,
  type ContentPart,
  type ToolCallItem,
  type TranscriptState,
  type TurnRecord,
} from "@anyharness/sdk";
import { buildTurnPresentation, type TurnDisplayBlock } from "./transcript-presentation";
import { buildTranscriptRowModel, type TranscriptRow } from "./transcript-row-model";
export const PRO_292_TURN_ID = "e9298357-b2a2-411f-b9c4-7bde31ee4087";
export const PRO_292_TURN_STARTED_AT = "2026-08-15T22:09:57.836816Z";
export const PRO_292_TURN_COMPLETED_AT = "2026-08-15T22:17:00.016779Z";

export interface Pro292CompletedTurnFixture {
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
 * Reproduces the durable PRO-292 turn shape through production presentation
 * classification: 152 unique items (146 tools, five assistant messages, and
 * one user message), with four history runs separated by Agent Operations
 * mutation receipts. Row output is intentionally left to the production
 * transcript projection.
 */
export function createPro292CompletedTurnFixture(): Pro292CompletedTurnFixture {
  const transcript = createTranscriptState("pro-292-session");
  const turn: TurnRecord = {
    turnId: PRO_292_TURN_ID,
    itemOrder: [],
    startedAt: PRO_292_TURN_STARTED_AT,
    completedAt: PRO_292_TURN_COMPLETED_AT,
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
  let startedSeq = 8_454;

  const appendItem = (item: TranscriptState["itemsById"][string]) => {
    transcript.itemsById[item.itemId] = item;
    turn.itemOrder.push(item.itemId);
    itemIds.push(item.itemId);
    startedSeq += 1;
  };

  const userItemId = "pro-292-user";
  appendItem(userItem(userItemId, turn.turnId, startedSeq));

  const historyToolCounts = [36, 36, 36, 35];
  let historyToolIndex = 0;
  historyToolCounts.forEach((toolCount, runIndex) => {
    const assistantId = `pro-292-history-assistant-${runIndex + 1}`;
    appendItem(assistantItem(assistantId, turn.turnId, startedSeq));
    assistantItemIds.push(assistantId);
    completedHistoryItemIds.push(assistantId);

    for (let index = 0; index < toolCount; index += 1) {
      historyToolIndex += 1;
      const toolId = `pro-292-history-tool-${historyToolIndex}`;
      appendItem(toolItem(toolId, turn.turnId, startedSeq, "file_read"));
      toolItemIds.push(toolId);
      completedHistoryItemIds.push(toolId);
    }

    if (runIndex < historyToolCounts.length - 1) {
      const receiptId = `pro-292-mutation-receipt-${runIndex + 1}`;
      appendItem({
        ...toolItem(receiptId, turn.turnId, startedSeq, "other"),
        title: "Send message",
        nativeToolName: "mcp__proliferate_workspace__send_message",
        rawInput: {
          agentId: `pro-292-agent-${runIndex + 1}`,
          message: `Continue fixture run ${runIndex + 2}`,
        },
      });
      toolItemIds.push(receiptId);
      mutationReceiptItemIds.push(receiptId);
    }
  });

  const finalAssistantId = "pro-292-final-assistant";
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
export function buildPro292RowModelProof() {
  const fixture = createPro292CompletedTurnFixture();
  const serializedTurn = () => JSON.stringify({ turn: fixture.turn,
    items: fixture.itemIds.map((itemId) => fixture.transcript.itemsById[itemId]) });
  const beforeProjection = serializedTurn();
  const presentation = buildTurnPresentation(fixture.turn, fixture.transcript);
  const completedHistoryRootIds = new Set(presentation.completedHistoryRootIds);
  const belongsToCompletedHistory = (block: TurnDisplayBlock) =>
    displayBlockItemIds(block).every((itemId) => completedHistoryRootIds.has(itemId));
  const expectedHistoryBlocks = presentation.displayBlocks.filter(belongsToCompletedHistory);
  const expectedNonHistoryBlocks = presentation.displayBlocks
    .filter((block) => !belongsToCompletedHistory(block));
  const buildRows = (completedFixture: Pro292CompletedTurnFixture) =>
    buildTranscriptRowModel({
      activeSessionId: completedFixture.transcript.sessionMeta.sessionId,
      transcript: completedFixture.transcript, visibleOptimisticPrompt: null,
      latestTurnId: completedFixture.turn.turnId,
      latestTurnHasAssistantRenderableContent: true,
    });
  const turnRows = buildRows(fixture).filter((row): row is Extract<
    TranscriptRow, { kind: "turn" }> => row.kind === "turn");
  const completedHistoryRows = turnRows
    .filter((row) => row.blockKey === "completed-history");
  const rowKeys = turnRows.map((row) => row.key);
  const expectedRowKeys = [
    `turn:${PRO_292_TURN_ID}:block:${fixture.userItemId}`,
    `turn:${PRO_292_TURN_ID}:block:completed-history`,
    ...fixture.mutationReceiptItemIds.map((itemId) => `turn:${PRO_292_TURN_ID}:block:${itemId}`),
    `turn:${PRO_292_TURN_ID}:block:pro-292-final-assistant`,
  ];
  const projectedNonHistoryBlocks = turnRows
    .filter((row) => row.blockKey !== "completed-history")
    .flatMap((row) => row.renderPresentation.displayBlocks);
  const rebuiltKeys = buildRows(createPro292CompletedTurnFixture()).map((row) => row.key);
  return {
    counts: [fixture.itemIds.length, new Set(fixture.itemIds).size,
      fixture.toolItemIds.length, fixture.assistantItemIds.length,
      fixture.itemIds.filter((itemId) => fixture.transcript.itemsById[itemId]?.kind
        === "user_message").length, expectedHistoryBlocks.length],
    completedHistory: [completedHistoryRows.length,
      completedHistoryRows[0]?.renderPresentation.displayBlocks.length ?? 0],
    invariants: [
      fixture.turn.turnId === PRO_292_TURN_ID,
      serializedTurn() === beforeProjection,
      JSON.stringify(presentation.completedHistoryRootIds) === JSON.stringify(fixture.completedHistoryItemIds),
      JSON.stringify(completedHistoryRows[0]?.renderPresentation.displayBlocks) === JSON.stringify(expectedHistoryBlocks),
      JSON.stringify(projectedNonHistoryBlocks) === JSON.stringify(expectedNonHistoryBlocks),
      JSON.stringify(rowKeys) === JSON.stringify(expectedRowKeys),
      new Set(rowKeys).size === rowKeys.length,
      JSON.stringify(rebuiltKeys) === JSON.stringify(rowKeys),
    ],
  };
}

export function range<T>(count: number, prefix: string, build: (id: string, seq: number) => T): T[] {
  return Array.from({ length: count }, (_, idx) => build(`${prefix}-${idx + 1}`, idx + 1));
}

function displayBlockItemIds(block: TurnDisplayBlock): string[] {
  if (block.kind === "collapsed_actions" || block.kind === "inline_tools"
    || block.kind === "subagent_creations") {
    return block.itemIds;
  }
  return [block.itemId];
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
