import { describe, expect, it } from "vitest";
import { createTranscriptState, type TranscriptState } from "@anyharness/sdk";
import {
  assistantItem,
  terminalItem,
  toolItem,
  turnRecord,
} from "./transcript-presentation-test-fixtures";
import { buildTurnPresentation } from "./transcript-presentation";
import {
  collectToolCallIdsWithProposedPlan,
  findTrailingLiveExplorationBlock,
  findTrailingLiveWorkBlock,
  resolveTurnAssistantFooterModeForRow,
  turnHasActiveToolWork,
} from "./transcript-rendering";
import { buildTranscriptRowModel } from "./transcript-row-model";
import type { BackgroundCompletionReceipt } from "../../activity/background-completion-receipt";

describe("transcript rendering helpers", () => {
  it("preserves the proposed-plan index identity when unrelated prose changes", () => {
    const transcript = createTranscriptState("session-1");
    const previous = new Set<string>();

    const first = collectToolCallIdsWithProposedPlan(transcript, previous);
    transcript.itemsById = {
      message: assistantItem("message", "turn-1", 1),
    };
    const next = collectToolCallIdsWithProposedPlan(transcript, first);

    expect(first).toBe(previous);
    expect(next).toBe(first);
  });

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

  it("keeps a completed trailing exploration group live between tool events", () => {
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
    )).toEqual({
      kind: "collapsed_actions",
      blockId: "read-read",
      itemIds: ["read"],
    });
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

  it("does not keep a mixed group live when its trailing action is not exploration", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      read: toolItem("read", "turn-1", 1, "file_read", "completed"),
      command: terminalItem("command", "turn-1", 2, "cargo test", "completed"),
    };
    const turn = turnRecord(["read", "command"]);
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

// Regression: bgwork r6 rounds 3 + 4. A runtime-injected wake turn (the
// background-work finish signal, e.g. "Terminal … finished — exit code 0")
// never receives its completion tail. Round 3 handled the case where the tail
// message item finalized (status "completed") but the TurnRecord.completedAt
// stamp was missing. Round 4 handles the REAL durable shape observed on the
// wire (GET /v1/sessions/{id}/events): the runtime drops both item_completed
// AND turn_ended, so the tail assistant message item stays status "in_progress"
// (isStreaming true) forever — every completion-stamp / item-status gate is
// false. Completion is instead derived from session liveness: once the turn is
// no longer the session's actively-streaming turn (idle, reloaded, or
// interrupted), its message is copyable. Interleaved completion_receipt /
// background_work rows stay transparent to this.
describe("resolveTurnAssistantFooterModeForRow — footer completion without a turn_ended stamp", () => {
  it("round 3: restores copy when the tail message item settled but the TurnRecord never got completedAt", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = { msg: assistantItem("msg", "turn-1", 1) };
    const turn = turnRecord(["msg"], null);

    expect(resolveTurnAssistantFooterModeForRow({
      rowIsLastTurnRow: true,
      turn,
      transcript,
      presentation: buildTurnPresentation(turn, transcript),
      assistantRevealComplete: true,
      turnIsActivelyStreaming: false,
    })).toBe("copy");
  });

  it("round 4: restores copy on a dropped-tail wake turn whose message item is stuck in_progress once the session is idle", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = { msg: streamingProseItem("msg", "turn-1") };
    const turn = turnRecord(["msg"], null);

    expect(resolveTurnAssistantFooterModeForRow({
      rowIsLastTurnRow: true,
      turn,
      transcript,
      presentation: buildTurnPresentation(turn, transcript),
      assistantRevealComplete: true,
      turnIsActivelyStreaming: false,
    })).toBe("copy");
  });

  it("round 4 control: keeps the reserved footer for the same in_progress-tail shape while the turn IS the actively-streaming turn", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = { msg: streamingProseItem("msg", "turn-1") };
    const turn = turnRecord(["msg"], null);

    expect(resolveTurnAssistantFooterModeForRow({
      rowIsLastTurnRow: true,
      turn,
      transcript,
      presentation: buildTurnPresentation(turn, transcript),
      assistantRevealComplete: true,
      turnIsActivelyStreaming: true,
    })).toBe("reserved");
  });

  it("keeps the reserved footer when prose closed but a tool is still running (session working)", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = {
      msg: assistantItem("msg", "turn-1", 1),
      tool: toolItem("tool", "turn-1", 2, "other", "in_progress"),
    };
    const turn = turnRecord(["msg", "tool"], null);

    expect(resolveTurnAssistantFooterModeForRow({
      rowIsLastTurnRow: true,
      turn,
      transcript,
      presentation: buildTurnPresentation(turn, transcript),
      assistantRevealComplete: true,
      turnIsActivelyStreaming: true,
    })).toBe("reserved");
  });

  it("L1: keeps the reserved footer in a prose-finished-but-turn-still-active gap (before the next tool_call)", () => {
    // The tail prose item has settled (status "completed", isStreaming false)
    // and no tool is active YET — structurally identical to a settled wake turn
    // under item-status inputs, but the turn is still the live one, so the
    // liveness gate must keep it reserved (no mid-turn copy flash).
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = { msg: assistantItem("msg", "turn-1", 1) };
    const turn = turnRecord(["msg"], null);

    expect(resolveTurnAssistantFooterModeForRow({
      rowIsLastTurnRow: true,
      turn,
      transcript,
      presentation: buildTurnPresentation(turn, transcript),
      assistantRevealComplete: true,
      turnIsActivelyStreaming: true,
    })).toBe("reserved");
  });

  it("keeps the reserved footer until the assistant reveal completes", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = { msg: assistantItem("msg", "turn-1", 1) };
    const turn = turnRecord(["msg"], null);

    expect(resolveTurnAssistantFooterModeForRow({
      rowIsLastTurnRow: true,
      turn,
      transcript,
      presentation: buildTurnPresentation(turn, transcript),
      assistantRevealComplete: false,
      turnIsActivelyStreaming: false,
    })).toBe("reserved");
  });

  it("leaves stamped turns unchanged (negative control): completed turn still shows copy", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = { msg: assistantItem("msg", "turn-1", 1) };
    const turn = turnRecord(["msg"], "2026-04-04T00:00:01Z");

    expect(resolveTurnAssistantFooterModeForRow({
      rowIsLastTurnRow: true,
      turn,
      transcript,
      presentation: buildTurnPresentation(turn, transcript),
      assistantRevealComplete: true,
      turnIsActivelyStreaming: false,
    })).toBe("copy");
  });

  it("emits no footer on a non-final turn row", () => {
    const transcript = createTranscriptState("session-1");
    transcript.itemsById = { msg: assistantItem("msg", "turn-1", 1) };
    const turn = turnRecord(["msg"], null);

    expect(resolveTurnAssistantFooterModeForRow({
      rowIsLastTurnRow: false,
      turn,
      transcript,
      presentation: buildTurnPresentation(turn, transcript),
      assistantRevealComplete: true,
      turnIsActivelyStreaming: false,
    })).toBe("none");
  });

  it("(a) keeps the wake message's copy footer with a receipt interleaved after the preceding turn", () => {
    const transcript = createTranscriptState("session-1");
    addProseTurn(transcript, "turn-a", { completed: true });
    addProseTurn(transcript, "turn-b", { completed: false, tailStreaming: true });

    const rows = buildTranscriptRowModel({
      activeSessionId: "session-1",
      transcript,
      visibleOptimisticPrompt: null,
      latestTurnId: "turn-b",
      latestTurnHasAssistantRenderableContent: true,
      completionReceipts: [terminalReceiptFor("turn-a")],
    });

    expect(rows.map((row) => row.kind)).toEqual(["turn", "completion_receipt", "turn"]);
    expect(footerModeForTurnRow(rows, transcript, "turn-b")).toBe("copy");
  });

  it("(b) keeps the wake message's copy footer with the background_work row at the tail", () => {
    const transcript = createTranscriptState("session-1");
    addProseTurn(transcript, "turn-a", { completed: true });
    addProseTurn(transcript, "turn-b", { completed: false, tailStreaming: true });

    const rows = buildTranscriptRowModel({
      activeSessionId: "session-1",
      transcript,
      visibleOptimisticPrompt: null,
      latestTurnId: "turn-b",
      latestTurnHasAssistantRenderableContent: true,
      backgroundWorkRunningCount: 2,
    });

    expect(rows.at(-1)?.kind).toBe("background_work");
    expect(footerModeForTurnRow(rows, transcript, "turn-b")).toBe("copy");
  });

  it("(c) keeps the wake message's copy footer with both a receipt and the tail footer", () => {
    const transcript = createTranscriptState("session-1");
    addProseTurn(transcript, "turn-a", { completed: true });
    addProseTurn(transcript, "turn-b", { completed: false, tailStreaming: true });

    const rows = buildTranscriptRowModel({
      activeSessionId: "session-1",
      transcript,
      visibleOptimisticPrompt: null,
      latestTurnId: "turn-b",
      latestTurnHasAssistantRenderableContent: true,
      completionReceipts: [terminalReceiptFor("turn-a")],
      backgroundWorkRunningCount: 1,
    });

    expect(rows.map((row) => row.kind)).toEqual([
      "turn",
      "completion_receipt",
      "turn",
      "background_work",
    ]);
    expect(footerModeForTurnRow(rows, transcript, "turn-b")).toBe("copy");
  });
});

// The wake turn is not the session's active turn (idle / reloaded), so the
// row-model integration cases resolve with turnIsActivelyStreaming: false.
function footerModeForTurnRow(
  rows: ReturnType<typeof buildTranscriptRowModel>,
  transcript: TranscriptState,
  turnId: string,
): "none" | "reserved" | "copy" {
  const row = rows.find((candidate) => candidate.kind === "turn" && candidate.turnId === turnId);
  if (!row || row.kind !== "turn") {
    throw new Error(`turn row ${turnId} not found`);
  }
  return resolveTurnAssistantFooterModeForRow({
    rowIsLastTurnRow: row.isLastTurnRow,
    turn: transcript.turnsById[turnId],
    transcript,
    presentation: row.presentation,
    assistantRevealComplete: true,
    turnIsActivelyStreaming: false,
  });
}

// The verbatim durable shape from the wire: item_started(in_progress) +
// item_delta with no item_completed, so the assistant message stays streaming.
function streamingProseItem(itemId: string, turnId: string) {
  return { ...assistantItem(itemId, turnId, 1), status: "in_progress" as const, isStreaming: true };
}

function addProseTurn(
  transcript: TranscriptState,
  turnId: string,
  opts: { completed: boolean; tailStreaming?: boolean },
): void {
  const proseId = `${turnId}-prose`;
  transcript.turnOrder.push(turnId);
  transcript.turnsById[turnId] = {
    turnId,
    itemOrder: [proseId],
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: opts.completed ? "2026-01-01T00:00:01.000Z" : null,
    stopReason: opts.completed ? "end_turn" : null,
    fileBadges: [],
  };
  transcript.itemsById[proseId] = opts.tailStreaming
    ? streamingProseItem(proseId, turnId)
    : assistantItem(proseId, turnId, transcript.turnOrder.length);
}

function terminalReceiptFor(anchorTurnId: string | null): BackgroundCompletionReceipt {
  return {
    kind: "terminal",
    key: "terminal:p1",
    processId: "p1",
    command: "echo hi",
    exitCode: 0,
    atMs: 1,
    anchorTurnId,
  };
}
