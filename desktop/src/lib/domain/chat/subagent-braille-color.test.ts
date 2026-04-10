import { describe, expect, it } from "vitest";
import type { ToolCallItem, TranscriptState } from "@anyharness/sdk";
import {
  buildSubagentBrailleColorMap,
  resolveSubagentBrailleColor,
} from "@/lib/domain/chat/subagent-braille-color";

describe("buildSubagentBrailleColorMap", () => {
  it("assigns distinct colors to the first visible subagents in transcript order", () => {
    const transcript = transcriptState([
      toolCallItem("tool-1"),
      toolCallItem("tool-2"),
      toolCallItem("tool-3"),
    ]);

    const colorMap = buildSubagentBrailleColorMap(transcript);

    expect(new Set(colorMap.values()).size).toBe(3);
  });

  it("reuses the same color for repeated references to the same tool call", () => {
    const transcript = transcriptState([
      toolCallItem("tool-1", "item-1"),
      toolCallItem("tool-1", "item-1-repeat"),
    ]);

    const colorMap = buildSubagentBrailleColorMap(transcript);

    expect(colorMap.size).toBe(1);
    expect(colorMap.get("tool-1")).toBeDefined();
  });

  it("resolves a tool call color from the built map", () => {
    const item = toolCallItem("tool-9");
    const colorMap = buildSubagentBrailleColorMap(transcriptState([item]));

    expect(resolveSubagentBrailleColor(colorMap, item)).toBe(colorMap.get("tool-9"));
  });
});

function transcriptState(items: ToolCallItem[]): TranscriptState {
  return {
    sessionMeta: {
      sessionId: "session-1",
      title: null,
      updatedAt: null,
      nativeSessionId: null,
      sourceAgentKind: "claude",
    },
    turnOrder: ["turn-1"],
    turnsById: {
      "turn-1": {
        turnId: "turn-1",
        itemOrder: items.map((item) => item.itemId),
        startedAt: "2026-04-10T00:00:00Z",
        completedAt: null,
        stopReason: null,
        fileBadges: [],
      },
    },
    itemsById: Object.fromEntries(items.map((item) => [item.itemId, item])),
    openAssistantItemId: null,
    openThoughtItemId: null,
    pendingApproval: null,
    availableCommands: [],
    liveConfig: null,
    currentModeId: null,
    usageState: null,
    unknownEvents: [],
    isStreaming: false,
    lastSeq: 0,
    pendingPrompts: [],
  };
}

function toolCallItem(toolCallId: string, itemId = toolCallId): ToolCallItem {
  return {
    kind: "tool_call",
    itemId,
    turnId: "turn-1",
    status: "completed",
    sourceAgentKind: "claude",
    messageId: null,
    title: null,
    nativeToolName: "Agent",
    parentToolCallId: null,
    rawInput: { run_in_background: true },
    rawOutput: undefined,
    contentParts: [],
    timestamp: "2026-04-10T00:00:00Z",
    startedSeq: 1,
    lastUpdatedSeq: 1,
    completedSeq: 1,
    completedAt: "2026-04-10T00:00:00Z",
    toolCallId,
    toolKind: "other",
    semanticKind: "subagent",
    approvalState: "none",
  };
}
