import { describe, expect, it } from "vitest";
import { createTranscriptState, type TranscriptState, type TurnRecord } from "@anyharness/sdk";
import {
  lastTopLevelItemIsAssistantProseWithText,
  lastTopLevelItemIsStreamingAssistantProse,
  latestTransientStatusText,
  shouldAllowTurnTrailingStatus,
} from "@/lib/domain/chat/transcript-trailing-status";

describe("transcript trailing status", () => {
  it("suppresses trailing status only while tail assistant prose is streaming", () => {
    const { transcript, turn } = transcriptWithTurn([
      assistantItem("assistant", true),
    ]);

    expect(lastTopLevelItemIsAssistantProseWithText(turn, transcript)).toBe(true);
    expect(lastTopLevelItemIsStreamingAssistantProse(turn, transcript)).toBe(true);
    expect(shouldAllowTurnTrailingStatus({
      turn,
      transcript,
      isLatestTurnInProgress: true,
    })).toBe(false);

    transcript.itemsById.assistant = assistantItem("assistant", false);

    expect(lastTopLevelItemIsAssistantProseWithText(turn, transcript)).toBe(true);
    expect(lastTopLevelItemIsStreamingAssistantProse(turn, transcript)).toBe(false);
    expect(shouldAllowTurnTrailingStatus({
      turn,
      transcript,
      isLatestTurnInProgress: true,
    })).toBe(true);
  });

  it("does not allow trailing status for completed turns", () => {
    const { transcript, turn } = transcriptWithTurn([
      assistantItem("assistant", false),
    ]);

    expect(shouldAllowTurnTrailingStatus({
      turn,
      transcript,
      isLatestTurnInProgress: false,
    })).toBe(false);
  });

  it("ignores assistant prose nested inside a tool call", () => {
    const { transcript, turn } = transcriptWithTurn([
      toolItem("tool"),
      assistantItem("child", true, "tool"),
    ]);

    expect(lastTopLevelItemIsAssistantProseWithText(turn, transcript)).toBe(false);
    expect(lastTopLevelItemIsStreamingAssistantProse(turn, transcript)).toBe(false);
    expect(shouldAllowTurnTrailingStatus({
      turn,
      transcript,
      isLatestTurnInProgress: true,
    })).toBe(true);
  });

  it("selects the latest transient thought status", () => {
    const { transcript, turn } = transcriptWithTurn([
      transientThoughtItem("status-1", "Authenticating MCP"),
      assistantItem("assistant", false),
      transientThoughtItem("status-2", "Waiting for browser auth"),
    ]);

    expect(latestTransientStatusText(turn, transcript)).toBe("Waiting for browser auth");
  });
});

function transcriptWithTurn(
  items: TranscriptState["itemsById"][string][],
): { transcript: TranscriptState; turn: TurnRecord } {
  const transcript = createTranscriptState("session-1");
  const turn: TurnRecord = {
    turnId: "turn-1",
    itemOrder: items.map((item) => item.itemId),
    startedAt: "2026-04-13T12:00:01.000Z",
    completedAt: null,
    stopReason: null,
    fileBadges: [],
  };
  transcript.turnOrder = [turn.turnId];
  transcript.turnsById[turn.turnId] = turn;
  transcript.itemsById = Object.fromEntries(
    items.map((item) => [item.itemId, item]),
  ) as TranscriptState["itemsById"];
  return { transcript, turn };
}

function assistantItem(
  itemId: string,
  isStreaming: boolean,
  parentToolCallId: string | null = null,
): TranscriptState["itemsById"][string] {
  return {
    kind: "assistant_prose",
    itemId,
    turnId: "turn-1",
    status: isStreaming ? "in_progress" : "completed",
    sourceAgentKind: "codex",
    messageId: null,
    title: null,
    nativeToolName: null,
    parentToolCallId,
    contentParts: [],
    timestamp: "2026-04-13T12:00:01.000Z",
    startedSeq: 1,
    lastUpdatedSeq: 1,
    completedSeq: isStreaming ? null : 1,
    completedAt: isStreaming ? null : "2026-04-13T12:00:02.000Z",
    text: "Assistant text",
    isStreaming,
  };
}

function toolItem(itemId: string): TranscriptState["itemsById"][string] {
  return {
    kind: "tool_call",
    itemId,
    turnId: "turn-1",
    status: "in_progress",
    sourceAgentKind: "codex",
    messageId: null,
    title: "Tool call",
    nativeToolName: null,
    parentToolCallId: null,
    contentParts: [],
    timestamp: "2026-04-13T12:00:01.000Z",
    startedSeq: 1,
    lastUpdatedSeq: 1,
    completedSeq: null,
    completedAt: null,
    toolCallId: itemId,
    toolKind: "other",
    semanticKind: "other",
    approvalState: "none",
  };
}

function transientThoughtItem(
  itemId: string,
  text: string,
): TranscriptState["itemsById"][string] {
  return {
    kind: "thought",
    itemId,
    turnId: "turn-1",
    status: "in_progress",
    sourceAgentKind: "codex",
    isTransient: true,
    messageId: null,
    title: null,
    nativeToolName: null,
    parentToolCallId: null,
    contentParts: [{ type: "reasoning", text, visibility: "private" }],
    timestamp: "2026-04-13T12:00:01.000Z",
    startedSeq: 1,
    lastUpdatedSeq: 1,
    completedSeq: null,
    completedAt: null,
    text,
    isStreaming: true,
  };
}
