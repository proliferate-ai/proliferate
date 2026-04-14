import { describe, expect, it } from "vitest";
import { createTranscriptState } from "@anyharness/sdk";
import type { TurnRecord } from "@anyharness/sdk";
import { buildTurnPresentation } from "@/lib/domain/chat/transcript-presentation";

describe("buildTurnPresentation", () => {
  it("orders items by startedSeq before insertion order", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      earlier: assistantItem("earlier", "turn-1", 1),
      later: assistantItem("later", "turn-1", 2),
    };
    const turn: TurnRecord = {
      turnId: "turn-1",
      itemOrder: ["later", "earlier"],
      startedAt: "2026-04-04T00:00:00Z",
      completedAt: null,
      stopReason: null,
      fileBadges: [],
    };

    const presentation = buildTurnPresentation(turn, transcript);

    expect(presentation.rootIds).toEqual(["earlier", "later"]);
  });

  it("attaches children to the correct tool parent and collapses earlier work", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      user: userItem("user", "turn-1", 1),
      tool: toolItem("tool", "turn-1", 2),
      child: assistantItem("child", "turn-1", 3, "tool"),
      final: assistantItem("final", "turn-1", 4),
    };
    const turn: TurnRecord = {
      turnId: "turn-1",
      itemOrder: ["user", "tool", "child", "final"],
      startedAt: "2026-04-04T00:00:00Z",
      completedAt: "2026-04-04T00:00:10Z",
      stopReason: "end_turn",
      fileBadges: [],
    };

    const presentation = buildTurnPresentation(turn, transcript);

    expect(presentation.rootIds).toEqual(["user", "tool", "final"]);
    expect(presentation.childrenByParentId.get("tool")).toEqual(["child"]);
    expect(presentation.finalAssistantItemId).toBe("final");
    expect([...presentation.collapsedRootIds]).toEqual(["tool"]);
    expect(presentation.collapsedSummary).toEqual({
      messages: 1,
      toolCalls: 1,
      subagents: 0,
    });
  });

  it("excludes transient thoughts from transcript presentation", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      status: thoughtItem("status", "turn-1", 1, true),
      assistant: assistantItem("assistant", "turn-1", 2),
    };
    const turn: TurnRecord = {
      turnId: "turn-1",
      itemOrder: ["status", "assistant"],
      startedAt: "2026-04-04T00:00:00Z",
      completedAt: null,
      stopReason: null,
      fileBadges: [],
    };

    const presentation = buildTurnPresentation(turn, transcript);

    expect(presentation.rootIds).toEqual(["assistant"]);
  });
});

function assistantItem(
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

function userItem(itemId: string, turnId: string, startedSeq: number) {
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

function toolItem(itemId: string, turnId: string, startedSeq: number) {
  return {
    kind: "tool_call" as const,
    itemId,
    turnId,
    status: "completed" as const,
    sourceAgentKind: "claude",
    messageId: null,
    title: "Tool call",
    nativeToolName: null,
    parentToolCallId: null,
    contentParts: [],
    timestamp: "2026-04-04T00:00:00Z",
    startedSeq,
    lastUpdatedSeq: startedSeq,
    completedSeq: startedSeq,
    completedAt: "2026-04-04T00:00:00Z",
    toolCallId: itemId,
    toolKind: "other",
    semanticKind: "other" as const,
    approvalState: "none" as const,
  };
}

function thoughtItem(
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
