import type { ToolCallItem } from "@anyharness/sdk";

export function toolCallItem(overrides: Partial<ToolCallItem>): ToolCallItem {
  return {
    kind: "tool_call",
    itemId: "tool-playground",
    turnId: "turn-subagent",
    status: "completed",
    sourceAgentKind: "codex",
    messageId: null,
    title: "Tool call",
    nativeToolName: "Tool",
    parentToolCallId: null,
    rawInput: undefined,
    rawOutput: undefined,
    contentParts: [],
    timestamp: "2026-04-12T00:00:00Z",
    startedSeq: 1,
    lastUpdatedSeq: 1,
    completedSeq: 2,
    completedAt: "2026-04-12T00:00:01Z",
    toolCallId: "tool-playground",
    toolKind: "other",
    semanticKind: "other",
    approvalState: "none",
    ...overrides,
  } as ToolCallItem;
}
