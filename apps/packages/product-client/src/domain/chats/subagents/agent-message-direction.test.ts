import { createTranscriptState, type ToolCallItem, type TranscriptState } from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import {
  toolItem,
  userItem,
} from "../transcript/transcript-presentation-test-fixtures";
import {
  agentInboundMessageVerb,
} from "./agent-message-direction";

const PEER = "peer-session-1";
const OTHER = "peer-session-2";

describe("agentInboundMessageVerb", () => {
  it("says 'replied' when this session already messaged that agent", () => {
    const transcript = buildTranscript([
      sendTo(PEER, "send-1"),
      inbound("msg-1"),
    ]);

    expect(agentInboundMessageVerb({ transcript, sourceSessionId: PEER, itemId: "msg-1" }))
      .toBe("replied");
  });

  it("says 'messaged' when nothing was sent to that agent first", () => {
    const transcript = buildTranscript([inbound("msg-1")]);

    expect(agentInboundMessageVerb({ transcript, sourceSessionId: PEER, itemId: "msg-1" }))
      .toBe("messaged");
  });

  it("does not count a send aimed at a different agent", () => {
    const transcript = buildTranscript([
      sendTo(OTHER, "send-1"),
      inbound("msg-1"),
    ]);

    expect(agentInboundMessageVerb({ transcript, sourceSessionId: PEER, itemId: "msg-1" }))
      .toBe("messaged");
  });

  it("does not let a LATER send turn an earlier message into a reply", () => {
    const transcript = buildTranscript([
      inbound("msg-1"),
      sendTo(PEER, "send-1"),
    ]);

    expect(agentInboundMessageVerb({ transcript, sourceSessionId: PEER, itemId: "msg-1" }))
      .toBe("messaged");
  });

  it("ignores receipts that are not sends, like a status read", () => {
    const transcript = buildTranscript([
      receipt("read-1", "mcp__subagents__read_agent_transcript", PEER),
      inbound("msg-1"),
    ]);

    expect(agentInboundMessageVerb({ transcript, sourceSessionId: PEER, itemId: "msg-1" }))
      .toBe("messaged");
  });
});

function buildTranscript(
  items: readonly { itemId: string; item: ToolCallItem | ReturnType<typeof userItem> }[],
): TranscriptState {
  const transcript = createTranscriptState("session-1");
  transcript.turnOrder = ["turn-1"];
  transcript.turnsById = {
    "turn-1": {
      turnId: "turn-1",
      sessionId: "session-1",
      seq: 1,
      itemOrder: items.map((entry) => entry.itemId),
      status: "completed",
    } as TranscriptState["turnsById"][string],
  };
  transcript.itemsById = Object.fromEntries(
    items.map((entry) => [entry.itemId, entry.item]),
  ) as TranscriptState["itemsById"];
  return transcript;
}

function sendTo(sessionId: string, itemId: string) {
  return receipt(itemId, "mcp__subagents__send_agent_message", sessionId);
}

function receipt(itemId: string, nativeToolName: string, sessionId: string) {
  const item: ToolCallItem = {
    ...toolItem(itemId, "turn-1", 1, "other"),
    nativeToolName,
    rawOutput: { sessionId, title: "dispatch-peer" },
  };
  return { itemId, item };
}

function inbound(itemId: string) {
  const item = {
    ...userItem(itemId, "turn-1", 2),
    text: "Done — the retry ceiling was the culprit.",
    promptProvenance: {
      type: "agentSession" as const,
      sourceSessionId: PEER,
      label: "dispatch-peer",
    },
  };
  return { itemId, item };
}
