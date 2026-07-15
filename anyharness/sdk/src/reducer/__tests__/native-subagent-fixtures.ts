import type { SessionEventEnvelope } from "../../index.js";

export type NativeSubagentFixture = {
  provider: "claude" | "codex";
  parentId: string;
  childMessageId: string;
  childToolId: string;
  events: SessionEventEnvelope[];
};

export const nativeSubagentFixtures: NativeSubagentFixture[] = [
  nativeSubagentFixture("claude"),
  nativeSubagentFixture("codex"),
];

function nativeSubagentFixture(provider: "claude" | "codex"): NativeSubagentFixture {
  const sessionId = `${provider}-session`;
  const turnId = `${provider}-turn`;
  const parentId = `${provider}-agent`;
  const childMessageId = `${provider}-child-message`;
  const childToolId = `${provider}-child-tool`;
  const envelope = (
    seq: number,
    event: SessionEventEnvelope["event"],
    itemId?: string,
  ): SessionEventEnvelope => ({
    sessionId,
    seq,
    timestamp: `2026-07-15T00:00:0${seq}Z`,
    turnId,
    ...(itemId ? { itemId } : {}),
    event,
  });
  const parentItem = (status: "in_progress" | "completed") => ({
    kind: "tool_invocation" as const,
    status,
    sourceAgentKind: provider,
    toolCallId: parentId,
    nativeToolName: "Agent",
    title: "Inspect the repository",
    rawInput: { prompt: "Read README.md", description: "Inspect the repository" },
    rawOutput: status === "completed" ? { summary: "Found the heading." } : undefined,
    contentParts: [{
      type: "tool_call" as const,
      toolCallId: parentId,
      title: "Inspect the repository",
      toolKind: "subagent",
      nativeToolName: "Agent",
    }],
  });

  return {
    provider,
    parentId,
    childMessageId,
    childToolId,
    events: [
      envelope(1, { type: "turn_started" }),
      envelope(2, { type: "item_started", item: parentItem("in_progress") }, parentId),
      envelope(3, {
        type: "item_started",
        item: {
          kind: "assistant_message",
          status: "in_progress",
          sourceAgentKind: provider,
          messageId: childMessageId,
          parentToolCallId: parentId,
          contentParts: [{ type: "text", text: "Inspecting README.md" }],
        },
      }, childMessageId),
      envelope(4, {
        type: "item_completed",
        item: {
          kind: "assistant_message",
          status: "completed",
          sourceAgentKind: provider,
          messageId: childMessageId,
          parentToolCallId: parentId,
          contentParts: [{ type: "text", text: "Inspecting README.md" }],
        },
      }, childMessageId),
      envelope(5, {
        type: "item_completed",
        item: {
          kind: "tool_invocation",
          status: "completed",
          sourceAgentKind: provider,
          toolCallId: childToolId,
          nativeToolName: "Read",
          parentToolCallId: parentId,
          title: "Read README.md",
          contentParts: [{
            type: "tool_call",
            toolCallId: childToolId,
            title: "Read README.md",
            toolKind: "read",
            nativeToolName: "Read",
          }],
        },
      }, childToolId),
      envelope(6, { type: "item_completed", item: parentItem("completed") }, parentId),
      envelope(7, { type: "turn_ended", stopReason: "end_turn" }),
    ],
  };
}
