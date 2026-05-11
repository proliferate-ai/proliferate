import { describe, expect, it } from "vitest";
import { createTranscriptState, type TranscriptState } from "@anyharness/sdk";
import {
  isRenderableUserMessageEcho,
  transcriptHasRenderablePromptEcho,
} from "@/lib/domain/chat/outbox/prompt-echo";

describe("prompt echo", () => {
  it("does not treat empty user-message echoes as renderable", () => {
    expect(isRenderableUserMessageEcho({
      kind: "user_message",
      contentParts: [],
      text: "",
    })).toBe(false);
  });

  it("finds only renderable prompt echoes in a transcript", () => {
    const transcript = createTranscriptState("session-1");
    addUserMessage(transcript, "item-empty", "prompt-empty", "");
    addUserMessage(transcript, "item-filled", "prompt-filled", "hello");

    expect(transcriptHasRenderablePromptEcho(transcript, "prompt-empty")).toBe(false);
    expect(transcriptHasRenderablePromptEcho(transcript, "prompt-filled")).toBe(true);
  });
});

function addUserMessage(
  transcript: TranscriptState,
  itemId: string,
  promptId: string,
  text: string,
) {
  transcript.itemsById[itemId] = {
    itemId,
    turnId: "turn-1",
    kind: "user_message",
    text,
    isStreaming: false,
    promptId,
    status: "completed",
    sourceAgentKind: "codex",
    messageId: itemId,
    title: null,
    nativeToolName: null,
    parentToolCallId: null,
    contentParts: text ? [{ type: "text", text }] : [],
    timestamp: "2026-01-01T00:00:00.000Z",
    startedSeq: 1,
    lastUpdatedSeq: 1,
    completedSeq: 1,
    completedAt: "2026-01-01T00:00:00.000Z",
  };
}
