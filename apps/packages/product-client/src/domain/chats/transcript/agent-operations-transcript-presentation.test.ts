import { describe, expect, it } from "vitest";
import { createTranscriptState } from "@anyharness/sdk";
import type { ToolCallItem } from "@anyharness/sdk";
import {
  buildTranscriptDisplayBlocks,
  buildTurnPresentation,
} from "./transcript-presentation";
import {
  assistantItem,
  toolItem,
  turnRecord,
} from "./transcript-presentation-test-fixtures";

describe("Agent Operations transcript presentation", () => {
  it("groups only workspace create_agent calls whose raw kind is subagent", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      subagent1: workspaceCreateAgentItem("subagent1", 1, "subagent"),
      subagent2: workspaceCreateAgentItem("subagent2", 2, "subagent"),
      ordinary: workspaceCreateAgentItem("ordinary", 3, "ordinary"),
    };
    const turn = turnRecord(["subagent1", "subagent2", "ordinary"]);

    expect(buildTurnPresentation(turn, transcript).displayBlocks).toEqual([
      {
        kind: "subagent_creations",
        blockId: "subagent1",
        itemIds: ["subagent1", "subagent2"],
      },
      { kind: "item", itemId: "ordinary" },
    ]);
  });

  it("keeps the first-item creation run key stable while new receipts append", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      subagent1: workspaceCreateAgentItem("subagent1", 1, "subagent"),
      subagent2: workspaceCreateAgentItem("subagent2", 2, "subagent"),
    };

    const first = buildTranscriptDisplayBlocks({
      rootIds: ["subagent1"],
      transcript,
      childrenByParentId: new Map(),
      isComplete: false,
    });
    const appended = buildTranscriptDisplayBlocks({
      rootIds: ["subagent1", "subagent2"],
      transcript,
      childrenByParentId: new Map(),
      isComplete: false,
    });

    expect(first[0]).toMatchObject({ blockId: "subagent1" });
    expect(appended[0]).toMatchObject({ blockId: "subagent1" });
  });

  it("groups a production-shaped Codex subagent creation envelope", () => {
    const transcript = createTranscriptState("session-1");
    const wrapped = workspaceCreateAgentItem("subagent1", 1, "subagent");
    transcript.itemsById = {
      subagent1: {
        ...wrapped,
        nativeToolName: null,
        rawInput: {
          server: "workspace",
          tool: "create_agent",
          arguments: wrapped.rawInput,
        },
        rawOutput: {
          content: [{ type: "text", text: JSON.stringify(wrapped.rawOutput) }],
          isError: false,
          structuredContent: wrapped.rawOutput,
        },
      },
    };

    expect(buildTurnPresentation(turnRecord(["subagent1"]), transcript).displayBlocks).toEqual([
      { kind: "subagent_creations", blockId: "subagent1", itemIds: ["subagent1"] },
    ]);
  });

  it("keeps workspace mutations visible while generic reads remain foldable", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      send: {
        ...toolItem("send", "turn-1", 1, "other"),
        nativeToolName: "mcp__proliferate_workspace__send_message",
      },
      read: {
        ...toolItem("read", "turn-1", 2, "other"),
        nativeToolName: "mcp__proliferate_workspace__list_agents",
      },
      final: assistantItem("final", "turn-1", 3),
    };
    const turn = turnRecord(["send", "read", "final"], "2026-04-04T00:00:10Z");
    const presentation = buildTurnPresentation(turn, transcript);

    expect(presentation.displayBlocks).toEqual([
      { kind: "item", itemId: "send" },
      { kind: "collapsed_actions", blockId: "read-read", itemIds: ["read"] },
      { kind: "item", itemId: "final" },
    ]);
    expect(presentation.completedHistoryRootIds).toEqual(["read"]);
  });
});

function workspaceCreateAgentItem(
  itemId: string,
  startedSeq: number,
  kind: "ordinary" | "subagent",
): ToolCallItem {
  return {
    ...toolItem(itemId, "turn-1", startedSeq, "other"),
    title: "Create agent",
    nativeToolName: "mcp__proliferate_workspace__create_agent",
    rawInput: {
      workspaceId: "workspace-1",
      kind,
      task: kind === "subagent" ? `Agent ${itemId}` : undefined,
    },
    rawOutput: {
      identity: { runtimeId: "runtime-1", sessionId: `session-${itemId}` },
      workspace: { runtimeId: "runtime-1", workspaceId: "workspace-1" },
      role: kind,
      status: { presentation: "available", execution: "idle", hasLiveActor: true },
      title: `Agent ${itemId}`,
    },
  };
}
