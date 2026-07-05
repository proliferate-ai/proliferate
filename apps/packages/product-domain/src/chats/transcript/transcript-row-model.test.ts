import { describe, expect, it } from "vitest";
import { createTranscriptState, type PendingPromptEntry, type TranscriptState } from "@anyharness/sdk";
import {
  buildTranscriptRowModel,
  createTranscriptRowModelCache,
} from "./transcript-row-model";
import { createPromptOutboxEntry } from "../../sessions/intents/session-intent-model";
import {
  resolveVirtualBottomDistance,
} from "./transcript-virtual-rows";
import {
  parseTranscriptVirtualizationMode,
  resolveTranscriptVirtualizationEnabled,
} from "./transcript-virtualization-config";
import {
  terminalItem,
  thoughtItem,
} from "./transcript-presentation-test-fixtures";
import type { GoalTranscriptEvent } from "../../activity/goal-transcript-events";

describe("buildTranscriptRowModel", () => {
  it("creates stable turn rows for large transcripts", () => {
    const transcript = createTranscriptState("session-1");
    for (let index = 0; index < 1000; index += 1) {
      addTurn(transcript, `turn-${index}`, true);
    }

    const rows = buildTranscriptRowModel({
      activeSessionId: "session-1",
      transcript,
      visibleOptimisticPrompt: null,
      latestTurnId: "turn-999",
      latestTurnHasAssistantRenderableContent: true,
    });

    expect(rows).toHaveLength(1000);
    expect(rows[0]).toEqual(expect.objectContaining({
      kind: "turn",
      key: "turn:turn-0:block:content",
      turnId: "turn-0",
      blockKey: "content",
    }));
    expect(rows[999]).toEqual(expect.objectContaining({
      kind: "turn",
      key: "turn:turn-999:block:content",
      turnId: "turn-999",
      blockKey: "content",
    }));
  });

  it("hides an empty in-progress latest turn behind the visible pending prompt", () => {
    const transcript = createTranscriptState("session-1");
    addTurn(transcript, "turn-complete", true);
    addTurn(transcript, "turn-live", false);

    const rows = buildTranscriptRowModel({
      activeSessionId: "session-1",
      transcript,
      visibleOptimisticPrompt: pendingPrompt(),
      latestTurnId: "turn-live",
      latestTurnHasAssistantRenderableContent: false,
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "turn",
        key: "turn:turn-complete:block:content",
        turnId: "turn-complete",
        blockKey: "content",
      }),
      { kind: "pending_prompt", key: "pending-prompt:session-1" },
    ]);
  });

  it("hides an empty in-progress latest turn behind the visible outbox prompt", () => {
    const transcript = createTranscriptState("session-1");
    addTurn(transcript, "turn-complete", true);
    addTurn(transcript, "turn-live", false);

    const rows = buildTranscriptRowModel({
      activeSessionId: "session-1",
      transcript,
      visibleOptimisticPrompt: null,
      visibleOutboxEntries: [
        createPromptOutboxEntry({
          clientPromptId: "prompt-1",
          clientSessionId: "session-1",
          text: "hello",
          blocks: [{ type: "text", text: "hello" }],
          now: "2026-01-01T00:00:00.000Z",
        }),
      ],
      latestTurnId: "turn-live",
      latestTurnHasAssistantRenderableContent: false,
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "turn",
        key: "turn:turn-complete:block:content",
        turnId: "turn-complete",
        blockKey: "content",
      }),
      { kind: "outbox_prompt", key: "prompt:prompt-1", clientPromptId: "prompt-1" },
    ]);
  });

  it("keeps an in-progress latest turn when it already has renderable content", () => {
    const transcript = createTranscriptState("session-1");
    addTurn(transcript, "turn-live", false);
    addUserItem(transcript, "turn-live", "item-user", "Previous visible content");

    const rows = buildTranscriptRowModel({
      activeSessionId: "session-1",
      transcript,
      visibleOptimisticPrompt: pendingPrompt(),
      latestTurnId: "turn-live",
      latestTurnHasAssistantRenderableContent: false,
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "turn",
        key: "turn:turn-live:block:content",
        turnId: "turn-live",
        blockKey: "content",
      }),
      { kind: "pending_prompt", key: "pending-prompt:session-1" },
    ]);
  });

  it("keeps the latest turn once it has assistant-renderable content", () => {
    const transcript = createTranscriptState("session-1");
    addTurn(transcript, "turn-live", false);

    const rows = buildTranscriptRowModel({
      activeSessionId: "session-1",
      transcript,
      visibleOptimisticPrompt: pendingPrompt(),
      latestTurnId: "turn-live",
      latestTurnHasAssistantRenderableContent: true,
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "turn",
        key: "turn:turn-live:block:content",
        turnId: "turn-live",
        blockKey: "content",
      }),
      { kind: "pending_prompt", key: "pending-prompt:session-1" },
    ]);
  });

  it("splits large turns into stable display-block rows", () => {
    const transcript = createTranscriptState("session-1");
    addTurn(transcript, "turn-large", true);
    addThoughtItems(transcript, "turn-large", 30);

    const rows = buildTranscriptRowModel({
      activeSessionId: "session-1",
      transcript,
      visibleOptimisticPrompt: null,
      latestTurnId: "turn-large",
      latestTurnHasAssistantRenderableContent: true,
    });

    expect(rows).toHaveLength(30);
    expect(rows[0]).toEqual(expect.objectContaining({
      kind: "turn",
      key: "turn:turn-large:block:item-0",
      turnId: "turn-large",
      blockKey: "item-0",
      isFirstTurnRow: true,
      isLastTurnRow: false,
    }));
    expect(rows[29]).toEqual(expect.objectContaining({
      kind: "turn",
      key: "turn:turn-large:block:item-29",
      turnId: "turn-large",
      blockKey: "item-29",
      isFirstTurnRow: false,
      isLastTurnRow: true,
    }));
  });

  it("keeps large in-progress turns in one row so live action phases do not remount", () => {
    const transcript = createTranscriptState("session-1");
    addTurn(transcript, "turn-live", false);
    addAssistantItems(transcript, "turn-live", 30);

    const rows = buildTranscriptRowModel({
      activeSessionId: "session-1",
      transcript,
      visibleOptimisticPrompt: null,
      latestTurnId: "turn-live",
      latestTurnHasAssistantRenderableContent: true,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      kind: "turn",
      key: "turn:turn-live:block:content",
      turnId: "turn-live",
      blockKey: "content",
      isFirstTurnRow: true,
      isLastTurnRow: true,
    }));
  });

  it("keys split collapsed action rows by the first action in the run", () => {
    const transcript = createTranscriptState("session-1");
    addTurn(transcript, "turn-large", true);
    addCommandItem(transcript, "turn-large", "command-0", 1);
    addCommandItem(transcript, "turn-large", "command-1", 2);
    addThoughtItems(transcript, "turn-large", 22, 3);

    const rows = buildTranscriptRowModel({
      activeSessionId: "session-1",
      transcript,
      visibleOptimisticPrompt: null,
      latestTurnId: "turn-large",
      latestTurnHasAssistantRenderableContent: true,
    });

    expect(rows[0]).toEqual(expect.objectContaining({
      kind: "turn",
      key: "turn:turn-large:block:command-0",
      blockKey: "command-0",
    }));
  });

  it("reuses unchanged turn rows from the presentation cache", () => {
    const transcript = createTranscriptState("session-1");
    addTurn(transcript, "turn-1", true);
    const cache = createTranscriptRowModelCache();

    const firstRows = buildTranscriptRowModel({
      activeSessionId: "session-1",
      transcript,
      visibleOptimisticPrompt: null,
      latestTurnId: "turn-1",
      latestTurnHasAssistantRenderableContent: true,
    }, cache);
    const secondRows = buildTranscriptRowModel({
      activeSessionId: "session-1",
      transcript,
      visibleOptimisticPrompt: null,
      latestTurnId: "turn-1",
      latestTurnHasAssistantRenderableContent: true,
    }, cache);

    expect(secondRows[0]).toBe(firstRows[0]);
  });

  it("keys pending prompts by active session", () => {
    const transcript = createTranscriptState("session-1");
    const rows = buildTranscriptRowModel({
      activeSessionId: "session-2",
      transcript,
      visibleOptimisticPrompt: pendingPrompt(),
      latestTurnId: null,
      latestTurnHasAssistantRenderableContent: false,
    });

    expect(rows).toEqual([
      { kind: "pending_prompt", key: "pending-prompt:session-2" },
    ]);
  });

  it("keys outbox prompt rows by prompt id", () => {
    const transcript = createTranscriptState("session-1");
    const rows = buildTranscriptRowModel({
      activeSessionId: "session-1",
      transcript,
      visibleOptimisticPrompt: null,
      visibleOutboxEntries: [
        createPromptOutboxEntry({
          clientPromptId: "prompt-1",
          clientSessionId: "session-1",
          text: "queued",
          blocks: [{ type: "text", text: "queued" }],
          now: "2026-01-01T00:00:00.000Z",
        }),
      ],
      latestTurnId: null,
      latestTurnHasAssistantRenderableContent: false,
    });

    expect(rows).toEqual([
      { kind: "outbox_prompt", key: "prompt:prompt-1", clientPromptId: "prompt-1" },
    ]);
  });

  describe("goal event rows", () => {
    it("leads the row list with an event before any turn started", () => {
      const transcript = createTranscriptState("session-1");
      addTurn(transcript, "turn-1", true);
      addAssistantItems(transcript, "turn-1", 1, 10);

      const rows = buildTranscriptRowModel({
        activeSessionId: "session-1",
        transcript,
        visibleOptimisticPrompt: null,
        latestTurnId: "turn-1",
        latestTurnHasAssistantRenderableContent: true,
        goalEvents: [goalEvent(1, "set")],
      });

      expect(rows).toEqual([
        { kind: "goal_event", key: "goal-event:1", event: goalEvent(1, "set") },
        expect.objectContaining({ kind: "turn", turnId: "turn-1" }),
      ]);
    });

    it("places an event right after the last turn whose content had already started", () => {
      const transcript = createTranscriptState("session-1");
      addTurn(transcript, "turn-1", true);
      addAssistantItems(transcript, "turn-1", 1, 1);
      addTurn(transcript, "turn-2", true);
      addAssistantItems(transcript, "turn-2", 1, 10);

      const rows = buildTranscriptRowModel({
        activeSessionId: "session-1",
        transcript,
        visibleOptimisticPrompt: null,
        latestTurnId: "turn-2",
        latestTurnHasAssistantRenderableContent: true,
        // seq 5 landed after turn-1 started (seq 1) but before turn-2 (seq 10).
        goalEvents: [goalEvent(5, "met")],
      });

      expect(rows.map((row) => row.key)).toEqual([
        "turn:turn-1:block:content",
        "goal-event:5",
        "turn:turn-2:block:content",
      ]);
    });

    it("orders multiple events on the same turn by seq", () => {
      const transcript = createTranscriptState("session-1");
      addTurn(transcript, "turn-1", true);
      addAssistantItems(transcript, "turn-1", 1, 1);

      const rows = buildTranscriptRowModel({
        activeSessionId: "session-1",
        transcript,
        visibleOptimisticPrompt: null,
        latestTurnId: "turn-1",
        latestTurnHasAssistantRenderableContent: true,
        goalEvents: [goalEvent(9, "met"), goalEvent(3, "set")],
      });

      expect(rows.map((row) => row.key)).toEqual([
        "turn:turn-1:block:content",
        "goal-event:3",
        "goal-event:9",
      ]);
    });

    it("defaults to no goal rows when goalEvents is omitted", () => {
      const transcript = createTranscriptState("session-1");
      addTurn(transcript, "turn-1", true);
      addAssistantItems(transcript, "turn-1", 1, 1);

      const rows = buildTranscriptRowModel({
        activeSessionId: "session-1",
        transcript,
        visibleOptimisticPrompt: null,
        latestTurnId: "turn-1",
        latestTurnHasAssistantRenderableContent: true,
      });

      expect(rows.every((row) => row.kind !== "goal_event")).toBe(true);
    });

    // Regression coverage for the screenshot bug: a user message arms a goal,
    // the assistant turn pursues it, and the native goal_updated confirmation
    // lands (seq-wise) *after* assistant content has already started. The old
    // bucketing always anchored goal rows at the END of their host turn, so
    // "Goal set" rendered below the entire assistant turn instead of right
    // after the user's message.
    it("anchors a mid-turn 'set' event right after the turn's user-message row, before assistant content — and never below a later turn", () => {
      const transcript = createTranscriptState("session-1");
      addTurn(transcript, "turn-1", true);
      addUserItem(transcript, "turn-1", "item-turn-1-user", "Arm a goal and keep going", 1);
      addAssistantItems(transcript, "turn-1", 3, 2); // seq 2, 3, 4
      addTurn(transcript, "turn-2", true);
      addUserItem(transcript, "turn-2", "item-turn-2-user", "Keep going", 20);
      addAssistantItems(transcript, "turn-2", 2, 21); // seq 21, 22

      const rows = buildTranscriptRowModel({
        activeSessionId: "session-1",
        transcript,
        visibleOptimisticPrompt: null,
        latestTurnId: "turn-2",
        latestTurnHasAssistantRenderableContent: true,
        // Native confirmation lands at seq 3 — after the user message (seq 1)
        // and the first assistant chunk (seq 2), but before the rest of
        // turn-1's content (seq 4) — reproducing "goal_updated's seq is
        // assigned at native-confirmation time, after assistant chunks began".
        goalEvents: [goalEvent(3, "set")],
      });

      expect(rows.map((row) => row.key)).toEqual([
        "turn:turn-1:block:item-turn-1-user",
        "goal-event:3",
        "turn:turn-1:block:content",
        "turn:turn-2:block:content",
      ]);
    });

    it("keeps an end-anchored 'met' event at the turn's end even when it lands mid-turn (no split)", () => {
      const transcript = createTranscriptState("session-1");
      addTurn(transcript, "turn-1", true);
      addUserItem(transcript, "turn-1", "item-turn-1-user", "Ship it", 1);
      addAssistantItems(transcript, "turn-1", 3, 2); // seq 2, 3, 4

      const rows = buildTranscriptRowModel({
        activeSessionId: "session-1",
        transcript,
        visibleOptimisticPrompt: null,
        latestTurnId: "turn-1",
        latestTurnHasAssistantRenderableContent: true,
        goalEvents: [goalEvent(3, "met")],
      });

      expect(rows.map((row) => row.key)).toEqual([
        "turn:turn-1:block:content",
        "goal-event:3",
      ]);
    });

    it("anchors an idle-armed 'set' event between the turns (no split) when no turn is running", () => {
      const transcript = createTranscriptState("session-1");
      addTurn(transcript, "turn-1", true);
      addUserItem(transcript, "turn-1", "item-turn-1-user", "First", 1);
      addAssistantItems(transcript, "turn-1", 2, 2); // seq 2, 3 — turn-1 fully idle by seq 3
      addTurn(transcript, "turn-2", true);
      addUserItem(transcript, "turn-2", "item-turn-2-user", "Second", 10);
      addAssistantItems(transcript, "turn-2", 2, 11); // seq 11, 12

      const rows = buildTranscriptRowModel({
        activeSessionId: "session-1",
        transcript,
        visibleOptimisticPrompt: null,
        latestTurnId: "turn-2",
        latestTurnHasAssistantRenderableContent: true,
        // Armed while idle, between turn-1 finishing (seq 3) and turn-2
        // starting (seq 10) — no turn was running when this landed.
        goalEvents: [goalEvent(6, "set")],
      });

      expect(rows.map((row) => row.key)).toEqual([
        "turn:turn-1:block:content",
        "goal-event:6",
        "turn:turn-2:block:content",
      ]);
    });

    it("independently anchors a start event and an end event within the same turn", () => {
      const transcript = createTranscriptState("session-1");
      addTurn(transcript, "turn-1", true);
      addUserItem(transcript, "turn-1", "item-turn-1-user", "Do it", 1);
      addAssistantItems(transcript, "turn-1", 4, 2); // seq 2, 3, 4, 5

      const rows = buildTranscriptRowModel({
        activeSessionId: "session-1",
        transcript,
        visibleOptimisticPrompt: null,
        latestTurnId: "turn-1",
        latestTurnHasAssistantRenderableContent: true,
        // "set" lands mid-turn (seq 2, before the turn's last item at seq 5);
        // "met" lands at the very end of the same turn.
        goalEvents: [goalEvent(2, "set"), goalEvent(5, "met")],
      });

      expect(rows.map((row) => row.key)).toEqual([
        "turn:turn-1:block:item-turn-1-user",
        "goal-event:2",
        "turn:turn-1:block:content",
        "goal-event:5",
      ]);
    });

    it("leads a turn's row entirely when a start-anchored event lands mid-turn but the turn has no leading user-message block", () => {
      const transcript = createTranscriptState("session-1");
      addTurn(transcript, "turn-1", true);
      // No user_message item at all — e.g. an autonomous continuation turn.
      addAssistantItems(transcript, "turn-1", 3, 1); // seq 1, 2, 3

      const rows = buildTranscriptRowModel({
        activeSessionId: "session-1",
        transcript,
        visibleOptimisticPrompt: null,
        latestTurnId: "turn-1",
        latestTurnHasAssistantRenderableContent: true,
        goalEvents: [goalEvent(1, "set")],
      });

      expect(rows.map((row) => row.key)).toEqual([
        "goal-event:1",
        "turn:turn-1:block:content",
      ]);
    });

    it("anchors a mid-conversation goal set inline after the preceding turn, not floated to top", () => {
      const transcript = createTranscriptState("session-1");
      // Turn 1 completes: user "hi" seq 1, assistant "Hey!" seq 2
      addTurn(transcript, "turn-1", true);
      addUserItem(transcript, "turn-1", "item-turn-1-user", "hi", 1);
      addAssistantItems(transcript, "turn-1", 1, 2); // seq 2
      // THEN goal set at seq 5 (after turn 1 finished at seq 2)
      // THEN turn 2 starts: user "keep going" seq 10, assistant "Got it…" seq 11
      addTurn(transcript, "turn-2", true);
      addUserItem(transcript, "turn-2", "item-turn-2-user", "keep going", 10);
      addAssistantItems(transcript, "turn-2", 1, 11); // seq 11

      const rows = buildTranscriptRowModel({
        activeSessionId: "session-1",
        transcript,
        visibleOptimisticPrompt: null,
        latestTurnId: "turn-2",
        latestTurnHasAssistantRenderableContent: true,
        // Goal set at seq 5: after turn-1 finished (maxSeq 2), before turn-2 started (minSeq 10)
        goalEvents: [goalEvent(5, "set")],
      });

      // Expected: goal anchors at turn-1's END (between turn-1 and turn-2), NOT at index 0
      expect(rows.map((row) => row.key)).toEqual([
        "turn:turn-1:block:content",
        "goal-event:5",
        "turn:turn-2:block:content",
      ]);
      // Explicitly assert the goal is NOT floated to top
      expect(rows[0].kind).not.toBe("goal_event");
      expect(rows[1].kind).toBe("goal_event");
    });

    it("defensively anchors a goal with incorrectly-low seq at the last turn's end, not floated to top", () => {
      const transcript = createTranscriptState("session-1");
      // Turn 1 completes: user "hi" seq 1, assistant "Hey!" seq 2
      addTurn(transcript, "turn-1", true);
      addUserItem(transcript, "turn-1", "item-turn-1-user", "hi", 1);
      addAssistantItems(transcript, "turn-1", 1, 2); // seq 2

      const rows = buildTranscriptRowModel({
        activeSessionId: "session-1",
        transcript,
        visibleOptimisticPrompt: null,
        latestTurnId: "turn-1",
        latestTurnHasAssistantRenderableContent: true,
        // BUG: seq mistakenly assigned as 0 (< turn-1's minSeq of 1)
        // Without defensive fallback, this would float to beforeFirstTurn
        goalEvents: [goalEvent(0, "set")],
      });

      // Expected: with defensive fallback, goal anchors to turn-1. Since
      // seq 0 < turn-1's maxSeq (2), it's treated as mid-turn and anchors
      // at START (after the user message, before assistant content) — which
      // is better than floating to top. The turn splits to accommodate it.
      expect(rows.map((row) => row.key)).toEqual([
        "turn:turn-1:block:item-turn-1-user",
        "goal-event:0",
        "turn:turn-1:block:content",
      ]);
      // Critically: goal is NOT floated to index 0 (beforeFirstTurn)
      expect(rows[0].kind).not.toBe("goal_event");
      expect(rows[1].kind).toBe("goal_event");
    });
  });
});

describe("resolveVirtualBottomDistance", () => {
  it("reports the remaining distance from the bottom", () => {
    expect(resolveVirtualBottomDistance({
      scrollOffset: 920,
      viewportSize: 500,
      totalVirtualSize: 1500,
    })).toBe(80);
  });

  it("grows as the user scrolls into history", () => {
    expect(resolveVirtualBottomDistance({
      scrollOffset: 300,
      viewportSize: 500,
      totalVirtualSize: 1500,
    })).toBe(700);
  });

  it("clamps to zero when overscrolled past the bottom", () => {
    expect(resolveVirtualBottomDistance({
      scrollOffset: 1100,
      viewportSize: 500,
      totalVirtualSize: 1500,
    })).toBe(0);
  });
});

describe("transcript virtualization config", () => {
  it("parses the single tri-state localStorage value", () => {
    expect(parseTranscriptVirtualizationMode("auto")).toBe("auto");
    expect(parseTranscriptVirtualizationMode("on")).toBe("on");
    expect(parseTranscriptVirtualizationMode("off")).toBe("off");
    expect(parseTranscriptVirtualizationMode("1")).toBe("auto");
    expect(parseTranscriptVirtualizationMode(null)).toBe("auto");
  });

  it("enables virtualization automatically only for large row counts", () => {
    expect(resolveTranscriptVirtualizationEnabled({
      mode: "auto",
      rowCount: 79,
      autoRowThreshold: 80,
    })).toBe(false);
    expect(resolveTranscriptVirtualizationEnabled({
      mode: "auto",
      rowCount: 80,
      autoRowThreshold: 80,
    })).toBe(true);
  });

  it("allows explicit on/off overrides", () => {
    expect(resolveTranscriptVirtualizationEnabled({
      mode: "on",
      rowCount: 1,
      autoRowThreshold: 80,
    })).toBe(true);
    expect(resolveTranscriptVirtualizationEnabled({
      mode: "off",
      rowCount: 1000,
      autoRowThreshold: 80,
    })).toBe(false);
  });
});

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

function addAssistantItems(
  transcript: TranscriptState,
  turnId: string,
  count: number,
  startedSeqOffset = 1,
) {
  const turn = transcript.turnsById[turnId];
  if (!turn) {
    throw new Error(`missing test turn ${turnId}`);
  }
  for (let index = 0; index < count; index += 1) {
    // Namespaced by turnId: item ids must stay unique across turns within a
    // test transcript, or a later turn's addAssistantItems call overwrites
    // an earlier turn's item in `itemsById` (both `item-0`) while the
    // earlier turn's `itemOrder` still points at that now-clobbered id.
    const itemId = `item-${turnId}-${index}`;
    turn.itemOrder.push(itemId);
    transcript.itemsById[itemId] = {
      kind: "assistant_prose",
      itemId,
      turnId,
      text: `message ${index}`,
      isStreaming: false,
      startedSeq: startedSeqOffset + index,
    } as TranscriptState["itemsById"][string];
  }
}

function addThoughtItems(
  transcript: TranscriptState,
  turnId: string,
  count: number,
  startedSeqOffset = 1,
) {
  const turn = transcript.turnsById[turnId];
  if (!turn) {
    throw new Error(`missing test turn ${turnId}`);
  }
  for (let index = 0; index < count; index += 1) {
    const itemId = `item-${index}`;
    turn.itemOrder.push(itemId);
    transcript.itemsById[itemId] = thoughtItem(
      itemId,
      turnId,
      startedSeqOffset + index,
      false,
    );
  }
}

function addCommandItem(
  transcript: TranscriptState,
  turnId: string,
  itemId: string,
  startedSeq: number,
) {
  const turn = transcript.turnsById[turnId];
  if (!turn) {
    throw new Error(`missing test turn ${turnId}`);
  }
  turn.itemOrder.push(itemId);
  transcript.itemsById[itemId] = terminalItem(
    itemId,
    turnId,
    startedSeq,
    `echo ${itemId}`,
  );
}

function addUserItem(
  transcript: TranscriptState,
  turnId: string,
  itemId: string,
  text: string,
  startedSeq = 1,
) {
  const turn = transcript.turnsById[turnId];
  if (!turn) {
    throw new Error(`missing test turn ${turnId}`);
  }
  turn.itemOrder.push(itemId);
  transcript.itemsById[itemId] = {
    kind: "user_message",
    itemId,
    turnId,
    text,
    isStreaming: false,
    startedSeq,
  } as TranscriptState["itemsById"][string];
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

function goalEvent(seq: number, kind: GoalTranscriptEvent["kind"]): GoalTranscriptEvent {
  return {
    id: String(seq),
    seq,
    turnId: null,
    kind,
    objective: "ship the thing",
    detail: null,
  };
}
