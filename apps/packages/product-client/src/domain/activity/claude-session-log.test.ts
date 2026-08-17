import { describe, expect, it } from "vitest";
import type { AssistantProseItem, ToolCallItem, UserMessageItem } from "@anyharness/sdk";
import { claudeSessionLogToTranscriptState } from "./claude-session-log";

const SESSION_ID = "synthetic-child-session";

function jsonLine(obj: unknown): string {
  return `${JSON.stringify(obj)}\n`;
}

function userTextLine(uuid: string, text: string, timestamp = "2026-08-17T00:00:00.000Z") {
  return {
    type: "user",
    uuid,
    parentUuid: null,
    isSidechain: false,
    timestamp,
    sessionId: SESSION_ID,
    message: { role: "user", content: text },
  };
}

function assistantLine(
  uuid: string,
  content: unknown[],
  timestamp = "2026-08-17T00:00:01.000Z",
  stopReason: string | null = "end_turn",
) {
  return {
    type: "assistant",
    uuid,
    parentUuid: null,
    isSidechain: false,
    timestamp,
    sessionId: SESSION_ID,
    message: {
      role: "assistant",
      id: `msg-${uuid}`,
      model: "claude-test",
      content,
      stop_reason: stopReason,
    },
  };
}

function toolResultLine(
  uuid: string,
  toolUseId: string,
  content: unknown,
  isError = false,
  timestamp = "2026-08-17T00:00:02.000Z",
) {
  return {
    type: "user",
    uuid,
    parentUuid: null,
    isSidechain: false,
    timestamp,
    sessionId: SESSION_ID,
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolUseId, content, is_error: isError }],
    },
  };
}

describe("claudeSessionLogToTranscriptState", () => {
  it("returns an empty transcript for an empty buffer", () => {
    const result = claudeSessionLogToTranscriptState("", SESSION_ID);
    expect(result.transcript.turnOrder).toEqual([]);
    expect(result.skippedLineCount).toBe(0);
    expect(result.pendingPartialLine).toBe("");
  });

  it("maps a happy-path exchange: user prompt, assistant text + tool call, tool result, final text", () => {
    const buffer = [
      jsonLine(userTextLine("u1", "List the files in this repo.")),
      jsonLine(assistantLine("a1", [
        { type: "text", text: "I'll list them now." },
        { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } },
      ], "2026-08-17T00:00:01.000Z", "tool_use")),
      jsonLine(toolResultLine("u2", "toolu_1", "file-a\nfile-b")),
      jsonLine(assistantLine("a2", [
        { type: "text", text: "Found two files." },
      ])),
    ].join("");

    const { transcript, skippedLineCount, pendingPartialLine } =
      claudeSessionLogToTranscriptState(buffer, SESSION_ID);

    expect(skippedLineCount).toBe(0);
    expect(pendingPartialLine).toBe("");
    expect(transcript.turnOrder).toEqual(["turn-1"]);

    const turn = transcript.turnsById["turn-1"];
    expect(turn).toBeDefined();
    expect(turn?.itemOrder).toEqual(["u1:msg", "a1:text:0", "toolu_1", "a2:text:0"]);

    const userItem = transcript.itemsById["u1:msg"] as UserMessageItem;
    expect(userItem.kind).toBe("user_message");
    expect(userItem.text).toBe("List the files in this repo.");

    const prose = transcript.itemsById["a1:text:0"] as AssistantProseItem;
    expect(prose.kind).toBe("assistant_prose");
    expect(prose.text).toBe("I'll list them now.");

    const toolCall = transcript.itemsById["toolu_1"] as ToolCallItem;
    expect(toolCall.kind).toBe("tool_call");
    expect(toolCall.status).toBe("completed");
    expect(toolCall.nativeToolName).toBe("Bash");
    expect(toolCall.semanticKind).toBe("terminal");
    expect(toolCall.rawInput).toEqual({ command: "ls" });
    expect(toolCall.rawOutput).toBe("file-a\nfile-b");

    const finalProse = transcript.itemsById["a2:text:0"] as AssistantProseItem;
    expect(finalProse.text).toBe("Found two files.");
  });

  it("holds back a trailing line with no newline, then includes it once the newline arrives", () => {
    const complete = jsonLine(userTextLine("u1", "First prompt."));
    const partial = JSON.stringify(assistantLine("a1", [{ type: "text", text: "Partial reply" }]));

    const midStream = claudeSessionLogToTranscriptState(complete + partial, SESSION_ID);
    expect(midStream.pendingPartialLine).toBe(partial);
    expect(midStream.transcript.turnOrder).toEqual(["turn-1"]);
    expect(Object.keys(midStream.transcript.itemsById)).toEqual(["u1:msg"]);

    const completed = claudeSessionLogToTranscriptState(`${complete}${partial}\n`, SESSION_ID);
    expect(completed.pendingPartialLine).toBe("");
    expect(completed.transcript.itemsById["a1:text:0"]).toBeDefined();
  });

  it("skips a malformed JSON line without throwing and counts it", () => {
    const buffer = [
      jsonLine(userTextLine("u1", "Hello.")),
      "{not valid json at all\n",
      jsonLine(assistantLine("a1", [{ type: "text", text: "Hi." }])),
    ].join("");

    expect(() => claudeSessionLogToTranscriptState(buffer, SESSION_ID)).not.toThrow();
    const result = claudeSessionLogToTranscriptState(buffer, SESSION_ID);
    expect(result.skippedLineCount).toBe(1);
    expect(result.transcript.turnOrder).toEqual(["turn-1"]);
  });

  it("skips top-level line types outside the mapped subset, and counts them", () => {
    const buffer = [
      jsonLine({ type: "system", uuid: "s1", timestamp: "2026-08-17T00:00:00.000Z", subtype: "info" }),
      jsonLine({ type: "summary", leafUuid: "u1", summary: "A recap" }),
      jsonLine(userTextLine("u1", "Hello.")),
    ].join("");

    const result = claudeSessionLogToTranscriptState(buffer, SESSION_ID);
    expect(result.skippedLineCount).toBe(2);
    expect(result.transcript.turnOrder).toEqual(["turn-1"]);
  });

  it("skips isSidechain lines (nested subagent noise), and counts them", () => {
    const sidechainLine = {
      ...userTextLine("side-1", "Nested subagent prompt."),
      isSidechain: true,
    };
    const buffer = [jsonLine(sidechainLine), jsonLine(userTextLine("u1", "Top-level prompt."))].join("");

    const result = claudeSessionLogToTranscriptState(buffer, SESSION_ID);
    expect(result.skippedLineCount).toBe(1);
    expect(result.transcript.turnOrder).toEqual(["turn-1"]);
    const turn = result.transcript.turnsById["turn-1"];
    expect(turn?.itemOrder).toEqual(["u1:msg"]);
  });

  it("leaves a tool_use with no matching tool_result as an in-progress tool call", () => {
    const buffer = [
      jsonLine(userTextLine("u1", "Run a background command.")),
      jsonLine(assistantLine("a1", [
        { type: "tool_use", id: "toolu_running", name: "Bash", input: { command: "sleep 100" } },
      ])),
    ].join("");

    const result = claudeSessionLogToTranscriptState(buffer, SESSION_ID);
    const toolCall = result.transcript.itemsById.toolu_running as ToolCallItem;
    expect(toolCall.status).toBe("in_progress");
    expect(toolCall.rawOutput).toBeUndefined();
  });

  it("counts an orphaned tool_result (its tool_use is outside the buffer) without crashing", () => {
    const buffer = [
      jsonLine(userTextLine("u1", "Prompt after a truncated tail.")),
      jsonLine(toolResultLine("u0", "toolu_never_seen", "some output")),
    ].join("");

    expect(() => claudeSessionLogToTranscriptState(buffer, SESSION_ID)).not.toThrow();
    const result = claudeSessionLogToTranscriptState(buffer, SESSION_ID);
    expect(result.skippedLineCount).toBe(1);
    expect(result.transcript.itemsById.toolu_never_seen).toBeUndefined();
  });

  it("marks a failed tool result via is_error", () => {
    const buffer = [
      jsonLine(userTextLine("u1", "Run something that fails.")),
      jsonLine(assistantLine("a1", [
        { type: "tool_use", id: "toolu_fail", name: "Bash", input: { command: "false" } },
      ])),
      jsonLine(toolResultLine("u2", "toolu_fail", "command not found", true)),
    ].join("");

    const result = claudeSessionLogToTranscriptState(buffer, SESSION_ID);
    const toolCall = result.transcript.itemsById.toolu_fail as ToolCallItem;
    expect(toolCall.status).toBe("failed");
    expect(toolCall.rawOutput).toBe("command not found");
  });

  it("maps a thinking block to a thought item", () => {
    const buffer = [
      jsonLine(userTextLine("u1", "Think it through.")),
      jsonLine(assistantLine("a1", [
        { type: "thinking", thinking: "Let me consider the options.", signature: "sig" },
        { type: "text", text: "Here is my answer." },
      ])),
    ].join("");

    const result = claudeSessionLogToTranscriptState(buffer, SESSION_ID);
    const thought = result.transcript.itemsById["a1:thinking:0"];
    expect(thought?.kind).toBe("thought");
  });
});
