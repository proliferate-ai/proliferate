import type { ContentPart, ToolCallItem, TurnRecord } from "@anyharness/sdk";

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
