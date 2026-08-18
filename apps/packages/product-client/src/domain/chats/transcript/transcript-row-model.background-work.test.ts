import { describe, expect, it } from "vitest";
import { createTranscriptState, type PendingPromptEntry, type TranscriptState } from "@anyharness/sdk";
import {
  buildTranscriptRowModel,
  type TranscriptRow,
} from "./transcript-row-model";
import type { BackgroundCompletionReceipt } from "../../activity/background-completion-receipt";

// Split from transcript-row-model.test.ts for PROD-SIZE-1 (repo-wide 600-line
// cap). Covers the bgwork r6 round-2 in-scroll rows: inline completion receipts
// anchored to a turn's END and the running-count footer at the tail. The
// interleaving helpers under test live in `transcript-interleave-rows.ts`.

describe("buildTranscriptRowModel — background-work rows (bgwork r6 round 2)", () => {
  function build(overrides: {
    transcript: TranscriptState;
    latestTurnId: string | null;
    completionReceipts?: readonly BackgroundCompletionReceipt[];
    backgroundWorkRunningCount?: number;
    visibleOptimisticPrompt?: PendingPromptEntry | null;
  }): TranscriptRow[] {
    return buildTranscriptRowModel({
      activeSessionId: "session-1",
      transcript: overrides.transcript,
      visibleOptimisticPrompt: overrides.visibleOptimisticPrompt ?? null,
      latestTurnId: overrides.latestTurnId,
      latestTurnHasAssistantRenderableContent: true,
      completionReceipts: overrides.completionReceipts,
      backgroundWorkRunningCount: overrides.backgroundWorkRunningCount,
    });
  }

  it("interleaves a completion receipt right after its anchor turn, before the later (wake) turn", () => {
    const transcript = createTranscriptState("session-1");
    addTurn(transcript, "turn-a", true);
    addTurn(transcript, "turn-b", true);

    const rows = build({
      transcript,
      latestTurnId: "turn-b",
      completionReceipts: [terminalReceiptFor("turn-a")],
    });

    expect(rows.map((row) => row.kind)).toEqual(["turn", "completion_receipt", "turn"]);
    expect(rows[0]).toEqual(expect.objectContaining({ turnId: "turn-a" }));
    expect(rows[1]).toEqual(expect.objectContaining({
      kind: "completion_receipt",
      key: "completion-receipt:terminal:p1",
    }));
    expect(rows[2]).toEqual(expect.objectContaining({ turnId: "turn-b" }));
  });

  it("leads the row list with a receipt whose anchor turn never existed (null anchor)", () => {
    const transcript = createTranscriptState("session-1");
    addTurn(transcript, "turn-a", true);

    const rows = build({
      transcript,
      latestTurnId: "turn-a",
      completionReceipts: [terminalReceiptFor(null)],
    });

    expect(rows.map((row) => row.kind)).toEqual(["completion_receipt", "turn"]);
  });

  it("places a receipt whose anchor turn is no longer loaded after all turns", () => {
    const transcript = createTranscriptState("session-1");
    addTurn(transcript, "turn-a", true);

    const rows = build({
      transcript,
      latestTurnId: "turn-a",
      completionReceipts: [terminalReceiptFor("turn-gone")],
    });

    expect(rows.map((row) => row.kind)).toEqual(["turn", "completion_receipt"]);
  });

  it("keeps multiple receipts anchored to the same turn in arrival order", () => {
    const transcript = createTranscriptState("session-1");
    addTurn(transcript, "turn-a", true);

    const rows = build({
      transcript,
      latestTurnId: "turn-a",
      completionReceipts: [
        terminalReceiptFor("turn-a", "terminal:p1"),
        terminalReceiptFor("turn-a", "terminal:p2"),
      ],
    });

    expect(rows.map((row) => row.key)).toEqual([
      "turn:turn-a:block:content",
      "completion-receipt:terminal:p1",
      "completion-receipt:terminal:p2",
    ]);
  });

  it("appends the running-count footer row at the very tail while runningCount > 0", () => {
    const transcript = createTranscriptState("session-1");
    addTurn(transcript, "turn-a", true);

    const rows = build({ transcript, latestTurnId: "turn-a", backgroundWorkRunningCount: 3 });

    expect(rows.at(-1)).toEqual({
      kind: "background_work",
      key: "background-work",
      runningCount: 3,
    });
  });

  it("renders NO footer row at runningCount 0", () => {
    const transcript = createTranscriptState("session-1");
    addTurn(transcript, "turn-a", true);

    const rows = build({ transcript, latestTurnId: "turn-a", backgroundWorkRunningCount: 0 });

    expect(rows.some((row) => row.kind === "background_work")).toBe(false);
  });

  it("orders agent turn -> receipt -> footer at the tail (receipt above the still-running footer)", () => {
    const transcript = createTranscriptState("session-1");
    addTurn(transcript, "turn-a", true);

    const rows = build({
      transcript,
      latestTurnId: "turn-a",
      completionReceipts: [terminalReceiptFor("turn-a")],
      backgroundWorkRunningCount: 1,
    });

    expect(rows.map((row) => row.kind)).toEqual(["turn", "completion_receipt", "background_work"]);
  });

  it("places the footer row after a pending-prompt row (absolute tail)", () => {
    const transcript = createTranscriptState("session-1");
    addTurn(transcript, "turn-a", true);

    const rows = build({
      transcript,
      latestTurnId: "turn-a",
      visibleOptimisticPrompt: pendingPrompt(),
      backgroundWorkRunningCount: 1,
    });

    expect(rows.map((row) => row.kind)).toEqual(["turn", "pending_prompt", "background_work"]);
  });
});

function terminalReceiptFor(
  anchorTurnId: string | null,
  key = "terminal:p1",
): BackgroundCompletionReceipt {
  return {
    kind: "terminal",
    key,
    processId: key.replace("terminal:", ""),
    command: "echo hi",
    exitCode: 0,
    atMs: 1,
    anchorTurnId,
  };
}

function addTurn(
  transcript: TranscriptState,
  turnId: string,
  completed: boolean,
) {
  transcript.turnOrder.push(turnId);
  transcript.turnsById[turnId] = {
    turnId,
    itemOrder: [],
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: completed ? "2026-01-01T00:00:01.000Z" : null,
    stopReason: completed ? "stop" : null,
    fileBadges: [],
  };
}

function pendingPrompt(): PendingPromptEntry {
  return {
    seq: 1,
    promptId: "prompt-1",
    text: "hello",
    contentParts: [],
    queuedAt: "2026-01-01T00:00:00.000Z",
    promptProvenance: null,
  };
}
