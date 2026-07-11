import { describe, expect, it } from "vitest";
import { createTranscriptState } from "@anyharness/sdk";
import {
  assistantItem,
  terminalItem,
  toolItem,
  turnRecord,
} from "./transcript-presentation-test-fixtures";
import { buildTurnPresentation } from "./transcript-presentation";
import {
  findTrailingLiveExplorationBlock,
  findTrailingLiveWorkBlock,
  turnHasActiveToolWork,
} from "./transcript-rendering";

describe("transcript rendering helpers", () => {
  it("does not keep a completed trailing inline action live after the action phase", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      command: terminalItem("command", "turn-1", 1, "cargo test", "completed"),
    };
    const turn = turnRecord(["command"]);
    const presentation = buildTurnPresentation(turn, transcript);

    expect(findTrailingLiveExplorationBlock(
      presentation.displayBlocks,
      transcript,
      true,
    )).toBeNull();
    expect(findTrailingLiveWorkBlock(
      presentation.displayBlocks,
      transcript,
      true,
    )).toBeNull();
  });

  it("does not keep a completed trailing exploration group live", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      read: toolItem("read", "turn-1", 1, "file_read", "completed"),
    };
    const turn = turnRecord(["read"]);
    const presentation = buildTurnPresentation(turn, transcript);

    expect(findTrailingLiveExplorationBlock(
      presentation.displayBlocks,
      transcript,
      true,
    )).toBeNull();
  });

  it("keeps an active trailing exploration group live", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      read: toolItem("read", "turn-1", 1, "file_read", "in_progress"),
    };
    const turn = turnRecord(["read"]);
    const presentation = buildTurnPresentation(turn, transcript);

    expect(findTrailingLiveExplorationBlock(
      presentation.displayBlocks,
      transcript,
      true,
    )).toEqual({
      kind: "collapsed_actions",
      blockId: "read-read",
      itemIds: ["read"],
    });
  });

  it("does not keep a failed trailing exploration group live", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      read: toolItem("read", "turn-1", 1, "file_read", "failed"),
    };
    const turn = turnRecord(["read"]);
    const presentation = buildTurnPresentation(turn, transcript);

    expect(findTrailingLiveExplorationBlock(
      presentation.displayBlocks,
      transcript,
      true,
    )).toBeNull();
  });

  it("does not treat an earlier action batch as the live bottom phase", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      command: terminalItem("command", "turn-1", 1, "cargo test", "completed"),
      message: assistantItem("message", "turn-1", 2),
    };
    const turn = turnRecord(["command", "message"]);
    const presentation = buildTurnPresentation(turn, transcript);

    expect(findTrailingLiveExplorationBlock(
      presentation.displayBlocks,
      transcript,
      true,
    )).toBeNull();
  });

  it("detects active nested tool work outside top-level display blocks", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      agent: toolItem("agent", "turn-1", 1, "subagent", "completed"),
      command: {
        ...terminalItem("command", "turn-1", 2, "cargo test", "in_progress"),
        parentToolCallId: "agent",
      },
    };
    const turn = turnRecord(["agent", "command"]);
    const presentation = buildTurnPresentation(turn, transcript);

    expect(findTrailingLiveWorkBlock(
      presentation.displayBlocks,
      transcript,
      true,
    )).toBeNull();
    expect(turnHasActiveToolWork(turn, transcript)).toBe(true);
  });
});
