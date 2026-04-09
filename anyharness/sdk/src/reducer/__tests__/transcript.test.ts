import { describe, expect, it } from "vitest";
import {
  createTranscriptState,
  reduceEvent,
  reduceEvents,
} from "../../index.js";
import type { SessionEventEnvelope, ThoughtItem, ToolCallItem } from "../../index.js";

describe("transcript reducer", () => {
  it("reduces assistant streaming lifecycle into one completed prose item", () => {
    const state = reduceEvents(
      [
        turnStarted(1),
        assistantStarted(2, "assistant-1", "Hel"),
        assistantDelta(3, "assistant-1", "lo"),
        assistantCompleted(4, "assistant-1", "Hello"),
      ],
      "session-1",
    );

    const item = state.itemsById["assistant-1"];
    expect(item.kind).toBe("assistant_prose");
    if (item.kind !== "assistant_prose") {
      throw new Error("expected assistant prose item");
    }
    expect(item.text).toBe("Hello");
    expect(item.isStreaming).toBe(false);
    expect(state.openAssistantItemId).toBeNull();
  });

  it("closes orphaned assistant and reasoning streams when a turn ends", () => {
    const state = reduceEvents(
      [
        turnStarted(1),
        assistantStarted(2, "assistant-1", "Still typing"),
        reasoningStarted(3, "reasoning-1", "Thinking"),
        turnEnded(4),
      ],
      "session-1",
    );

    expect(state.openAssistantItemId).toBeNull();
    expect(state.openThoughtItemId).toBeNull();
    expect(state.isStreaming).toBe(false);
    const assistantItem = state.itemsById["assistant-1"];
    expect(assistantItem.kind).toBe("assistant_prose");
    if (assistantItem.kind !== "assistant_prose") {
      throw new Error("expected assistant prose item");
    }
    expect(assistantItem.isStreaming).toBe(false);
    const thoughtItem = state.itemsById["reasoning-1"] as ThoughtItem;
    expect(thoughtItem.kind).toBe("thought");
    expect(thoughtItem.isStreaming).toBe(false);
  });

  it("merges tool deltas and re-derives semantic kind from file changes", () => {
    const state = reduceEvents(
      [
        turnStarted(1),
        {
          sessionId: "session-1",
          seq: 2,
          timestamp: "2026-04-04T00:00:02Z",
          turnId: "turn-1",
          itemId: "tool-1",
          event: {
            type: "item_started",
            item: {
              kind: "tool_invocation",
              status: "in_progress",
              sourceAgentKind: "claude",
              toolCallId: "tool-1",
              title: "Edit file",
              contentParts: [
                {
                  type: "tool_call",
                  toolCallId: "tool-1",
                  title: "Edit file",
                  toolKind: "edit",
                },
              ],
            },
          },
        },
        {
          sessionId: "session-1",
          seq: 3,
          timestamp: "2026-04-04T00:00:03Z",
          turnId: "turn-1",
          itemId: "tool-1",
          event: {
            type: "item_delta",
            delta: {
              replaceContentParts: [
                {
                  type: "tool_call",
                  toolCallId: "tool-1",
                  title: "Edit file",
                  toolKind: "edit",
                },
                {
                  type: "file_change",
                  operation: "edit",
                  path: "src/app.ts",
                  workspacePath: "src/app.ts",
                  additions: 5,
                  deletions: 1,
                },
              ],
            },
          },
        },
      ],
      "session-1",
    );

    const item = state.itemsById["tool-1"] as ToolCallItem;
    expect(item.kind).toBe("tool_call");
    expect(item.semanticKind).toBe("file_change");
    expect(item.contentParts.filter((part) => part.type === "tool_call")).toHaveLength(1);
    expect(item.contentParts.filter((part) => part.type === "file_change")).toHaveLength(1);
  });

  it("tracks permission requests and resolutions against tool items", () => {
    const state = reduceEvents(
      [
        turnStarted(1),
        completedToolItem(2, "tool-1"),
        {
          sessionId: "session-1",
          seq: 3,
          timestamp: "2026-04-04T00:00:03Z",
          turnId: "turn-1",
          itemId: "tool-1",
          event: {
            type: "permission_requested",
            requestId: "perm-1",
            title: "Run command",
            toolCallId: "tool-1",
            options: [{ id: "allow", label: "Allow" }],
          },
        },
        {
          sessionId: "session-1",
          seq: 4,
          timestamp: "2026-04-04T00:00:04Z",
          turnId: "turn-1",
          event: {
            type: "permission_resolved",
            requestId: "perm-1",
            outcome: {
              outcome: "selected",
              optionId: "allow",
            },
          },
        },
      ],
      "session-1",
    );

    expect(state.pendingApproval).toBeNull();
    expect((state.itemsById["tool-1"] as ToolCallItem).approvalState).toBe("approved");
  });

  it("aggregates file badges when the turn ends", () => {
    const state = reduceEvents(
      [
        turnStarted(1),
        completedToolItem(2, "tool-1", {
          type: "file_change",
          operation: "edit",
          path: "src/app.ts",
          workspacePath: "src/app.ts",
          additions: 2,
          deletions: 1,
        }),
        completedToolItem(3, "tool-2", {
          type: "file_change",
          operation: "edit",
          path: "src/app.ts",
          workspacePath: "src/app.ts",
          additions: 4,
          deletions: 3,
        }),
        turnEnded(4),
      ],
      "session-1",
    );

    expect(state.turnsById["turn-1"].fileBadges).toEqual([
      {
        path: "src/app.ts",
        additions: 6,
        deletions: 4,
      },
    ]);
  });
});

function turnStarted(seq: number): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    event: { type: "turn_started" },
  };
}

function turnEnded(seq: number): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    event: { type: "turn_ended", stopReason: "end_turn" },
  };
}

function assistantStarted(
  seq: number,
  itemId: string,
  text: string,
): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    itemId,
    event: {
      type: "item_started",
      item: {
        kind: "assistant_message",
        status: "in_progress",
        sourceAgentKind: "claude",
        contentParts: [{ type: "text", text }],
      },
    },
  };
}

function assistantDelta(
  seq: number,
  itemId: string,
  appendText: string,
): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    itemId,
    event: {
      type: "item_delta",
      delta: {
        appendText,
      },
    },
  };
}

function assistantCompleted(
  seq: number,
  itemId: string,
  text: string,
): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    itemId,
    event: {
      type: "item_completed",
      item: {
        kind: "assistant_message",
        status: "completed",
        sourceAgentKind: "claude",
        contentParts: [{ type: "text", text }],
      },
    },
  };
}

function reasoningStarted(
  seq: number,
  itemId: string,
  text: string,
): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    itemId,
    event: {
      type: "item_started",
      item: {
        kind: "reasoning",
        status: "in_progress",
        sourceAgentKind: "claude",
        contentParts: [{ type: "reasoning", text, visibility: "private" }],
      },
    },
  };
}

function completedToolItem(
  seq: number,
  itemId: string,
  extraContentPart?: SessionEventEnvelope["event"] extends never ? never : {
    type: "file_change";
    operation: "edit" | "create" | "delete" | "move";
    path: string;
    workspacePath?: string;
    additions?: number;
    deletions?: number;
  },
): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    itemId,
    event: {
      type: "item_completed",
      item: {
        kind: "tool_invocation",
        status: "completed",
        sourceAgentKind: "claude",
        toolCallId: itemId,
        title: "Tool call",
        contentParts: [
          {
            type: "tool_call",
            toolCallId: itemId,
            title: "Tool call",
            toolKind: "other",
          },
          ...(extraContentPart ? [extraContentPart] : []),
        ],
      },
    },
  };
}
