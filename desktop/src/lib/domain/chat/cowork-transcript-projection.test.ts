import { describe, expect, it } from "vitest";
import {
  createTranscriptState,
  type AssistantProseItem,
  type ErrorItem,
  type ToolCallItem,
  type UserMessageItem,
} from "@anyharness/sdk";
import { projectCoworkTranscript } from "@/lib/domain/chat/cowork-transcript-projection";

describe("projectCoworkTranscript", () => {
  it("keeps user messages, assistant prose, artifact tool calls, and errors", () => {
    const transcript = createTranscriptState("session-1");
    transcript.turnOrder = ["turn-1"];
    transcript.turnsById["turn-1"] = {
      turnId: "turn-1",
      itemOrder: ["user", "bash", "artifact", "assistant", "error"],
      startedAt: "2026-04-11T00:00:00Z",
      completedAt: "2026-04-11T00:00:10Z",
      stopReason: "end_turn",
      fileBadges: [{ path: "a.ts", additions: 1, deletions: 0 }],
    };
    transcript.itemsById = {
      user: userItem("user"),
      bash: toolItem("bash", {
        nativeToolName: "Bash",
        toolKind: "execute",
      }),
      artifact: toolItem("artifact", {
        nativeToolName: "proliferate.create_artifact",
        rawOutput: {
          structuredContent: {
            action: "created",
            artifact: {
              id: "artifact-1",
              title: "Artifact 1",
              renderer: "markdown",
              entry: "README.md",
            },
          },
        },
      }),
      assistant: assistantItem("assistant"),
      error: errorItem("error"),
    };

    const projected = projectCoworkTranscript(transcript);

    expect(projected.turnOrder).toEqual(["turn-1"]);
    expect(projected.turnsById["turn-1"]?.itemOrder).toEqual([
      "user",
      "artifact",
      "assistant",
      "error",
    ]);
    expect(projected.turnsById["turn-1"]?.fileBadges).toEqual([]);
    expect(projected.itemsById["bash"]).toBeUndefined();
    expect(projected.itemsById["artifact"]).toBeDefined();
    expect(projected.pendingApproval).toBeNull();
  });

  it("drops turns that only contain hidden churn", () => {
    const transcript = createTranscriptState("session-1");
    transcript.turnOrder = ["turn-1"];
    transcript.turnsById["turn-1"] = {
      turnId: "turn-1",
      itemOrder: ["bash"],
      startedAt: "2026-04-11T00:00:00Z",
      completedAt: "2026-04-11T00:00:10Z",
      stopReason: "end_turn",
      fileBadges: [],
    };
    transcript.itemsById = {
      bash: toolItem("bash", {
        nativeToolName: "Bash",
        toolKind: "execute",
      }),
    };

    const projected = projectCoworkTranscript(transcript);

    expect(projected.turnOrder).toEqual([]);
    expect(projected.turnsById).toEqual({});
  });
});

function userItem(itemId: string): UserMessageItem {
  return {
    kind: "user_message",
    itemId,
    turnId: "turn-1",
    status: "completed",
    sourceAgentKind: "claude",
    messageId: null,
    title: null,
    nativeToolName: null,
    parentToolCallId: null,
    contentParts: [],
    timestamp: "2026-04-11T00:00:00Z",
    startedSeq: 1,
    lastUpdatedSeq: 1,
    completedSeq: 1,
    completedAt: "2026-04-11T00:00:00Z",
    text: "user",
    isStreaming: false,
  };
}

function assistantItem(itemId: string): AssistantProseItem {
  return {
    kind: "assistant_prose",
    itemId,
    turnId: "turn-1",
    status: "completed",
    sourceAgentKind: "claude",
    messageId: null,
    title: null,
    nativeToolName: null,
    parentToolCallId: null,
    contentParts: [],
    timestamp: "2026-04-11T00:00:00Z",
    startedSeq: 4,
    lastUpdatedSeq: 4,
    completedSeq: 4,
    completedAt: "2026-04-11T00:00:00Z",
    text: "assistant",
    isStreaming: false,
  };
}

function errorItem(itemId: string): ErrorItem {
  return {
    kind: "error",
    itemId,
    turnId: "turn-1",
    status: "failed",
    sourceAgentKind: "claude",
    messageId: null,
    title: null,
    nativeToolName: null,
    parentToolCallId: null,
    contentParts: [],
    timestamp: "2026-04-11T00:00:00Z",
    startedSeq: 5,
    lastUpdatedSeq: 5,
    completedSeq: 5,
    completedAt: "2026-04-11T00:00:00Z",
    message: "boom",
    code: "failed",
  };
}

function toolItem(
  itemId: string,
  overrides: Partial<ToolCallItem>,
): ToolCallItem {
  return {
    kind: "tool_call",
    itemId,
    turnId: "turn-1",
    status: "completed",
    sourceAgentKind: "claude",
    messageId: null,
    title: "Tool call",
    nativeToolName: null,
    parentToolCallId: null,
    contentParts: [],
    timestamp: "2026-04-11T00:00:00Z",
    startedSeq: 2,
    lastUpdatedSeq: 2,
    completedSeq: 2,
    completedAt: "2026-04-11T00:00:00Z",
    toolCallId: itemId,
    toolKind: "other",
    semanticKind: "other",
    approvalState: "none",
    ...overrides,
  };
}
