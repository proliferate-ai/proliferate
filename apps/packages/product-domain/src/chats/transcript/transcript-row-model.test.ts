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
    it("anchors a mid-turn 'set' event inline by seq, even when that overlaps with assistant content", () => {
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
        // Native confirmation lands at seq 3 — after items at seq 2 and 3,
        // but before item at seq 4. Now with seq-based splitting, the turn is
        // split at seq 3, so the goal appears inline between the two sub-rows.
        goalEvents: [goalEvent(3, "set")],
      });

      // With seq-based splitting: turn-1 is split into [seq 1-2] and [seq 3-4]
      expect(rows.map((row) => row.key)).toEqual([
        "turn:turn-1:block:content:1-2",
        "goal-event:3",
        "turn:turn-1:block:content:3-4",
        "turn:turn-2:block:content",
      ]);
    });

    // Ground truth (live Claude session): within a turn the events are
    // user_message(216) → goal_updated set(218) → assistant_message(219..).
    // The set row must render BETWEEN the user message block and the
    // assistant reply block — never after the reply.
    it("renders a goal-set between the user message and the assistant reply (ground truth)", () => {
      const transcript = createTranscriptState("session-1");
      addTurn(transcript, "turn-1", true);
      addUserItem(transcript, "turn-1", "item-user", "Set a goal then meet it", 216);
      addAssistantItems(transcript, "turn-1", 1, 219); // single reply block at seq 219

      const rows = buildTranscriptRowModel({
        activeSessionId: "session-1",
        transcript,
        visibleOptimisticPrompt: null,
        latestTurnId: "turn-1",
        latestTurnHasAssistantRenderableContent: true,
        // set lands at seq 218: after the user message (216), before the
        // assistant reply (219). The turn splits at that block boundary.
        goalEvents: [goalEvent(218, "set")],
      });

      expect(rows.map((row) => row.key)).toEqual([
        "turn:turn-1:block:content:216-216",
        "goal-event:218",
        "turn:turn-1:block:content:219-219",
      ]);
    });

    // A goal event whose seq lands INSIDE the span of a single continuous
    // streamed assistant_message (one block, one startedSeq, with later
    // deltas) renders AFTER that whole block — the message is never
    // fragmented to wedge a goal row in (image-11/13 fix).
    it("keeps a lone streamed assistant message intact and renders a mid-span goal event after it", () => {
      const transcript = createTranscriptState("session-1");
      addTurn(transcript, "turn-1", true);
      // A single assistant message block at seq 10; its deltas keep streaming
      // past seq 10 but it stays one block with startedSeq 10.
      addAssistantItems(transcript, "turn-1", 1, 10);

      const rows = buildTranscriptRowModel({
        activeSessionId: "session-1",
        transcript,
        visibleOptimisticPrompt: null,
        latestTurnId: "turn-1",
        latestTurnHasAssistantRenderableContent: true,
        // seq 12 lands "inside" the streamed message's lifespan — but the
        // block's representative seq is 10, so the goal renders after the
        // whole (single, unsplit) message.
        goalEvents: [goalEvent(12, "met")],
      });

      // Exactly one turn row (the assistant message is never fragmented) then
      // the goal row after it.
      expect(rows.map((row) => row.key)).toEqual([
        "turn:turn-1:block:content",
        "goal-event:12",
      ]);
      const turnRows = rows.filter((row) => row.kind === "turn");
      expect(turnRows).toHaveLength(1);
    });

    it("interleaves a 'met' event inline by seq even when it lands mid-turn", () => {
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

      // The turn is split at seq 3 boundary: [seq 1-2] then goal, then [seq 3-4]
      expect(rows.map((row) => row.key)).toEqual([
        "turn:turn-1:block:content:1-2",
        "goal-event:3",
        "turn:turn-1:block:content:3-4",
      ]);
    });

    it("anchors an idle-armed 'set' event between turns when no turn is running", () => {
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

      // Turn-1 is split because it has a goal event (even though the goal
      // landed after turn-1 finished, it's still bucketed to turn-1 as the
      // host turn). The goal appears after turn-1's content.
      expect(rows.map((row) => row.key)).toEqual([
        "turn:turn-1:block:item-turn-1-user",
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

      // With two goal boundaries (seq 2 and 5), the turn is split into three slices:
      // [seq 1], goal@2, [seq 2-4], goal@5, [seq 5]
      expect(rows.map((row) => row.key)).toEqual([
        "turn:turn-1:block:content:1-1",
        "goal-event:2",
        "turn:turn-1:block:content:2-4",
        "goal-event:5",
        "turn:turn-1:block:content:5-5",
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

    // Real-world bug scenario from session b02656e3: a single turn 585b0744
    // with items at seq 9-23, goal_updated at seq 25, continuation items at
    // seq 26-40+, all same turn_id. The goal event MUST render inline at
    // its seq position (after seq-23 item, before seq-26 item), NOT at the
    // turn's start (which would place it above the "3 messages" divider).
    it("interleaves a goal_updated event inline by seq within a single ongoing turn's content stream", () => {
      const transcript = createTranscriptState("session-1");
      addTurn(transcript, "turn-1", false); // in-progress turn
      addUserItem(transcript, "turn-1", "item-user", "Hey! What are you working on?", 9);
      addAssistantItems(transcript, "turn-1", 15, 10); // seq 10-24 (first assistant response)
      // goal_updated lands at seq 25, AFTER first response but BEFORE continuation
      addAssistantItems(transcript, "turn-1", 15, 26); // seq 26-40 (continuation)

      const rows = buildTranscriptRowModel({
        activeSessionId: "session-1",
        transcript,
        visibleOptimisticPrompt: null,
        latestTurnId: "turn-1",
        latestTurnHasAssistantRenderableContent: true,
        goalEvents: [goalEvent(25, "set")],
      });

      // The goal event MUST appear after the user+first-response content row
      // and before (or within) the continuation content. It must NOT appear
      // at the very start (before the user message).
      const goalEventIndex = rows.findIndex((row) => row.kind === "goal_event");
      const userRowIndex = rows.findIndex((row) =>
        row.kind === "turn" && row.key.includes("item-user")
      );
      expect(goalEventIndex).toBeGreaterThan(userRowIndex);
      expect(goalEventIndex).toBeLessThan(rows.length);
      // Specifically: should NOT be at index 0.
      expect(goalEventIndex).not.toBe(0);
    });

    // CRITICAL TEST: Real session c42ad602, turn a423480f ground truth.
    // This is the EXACT scenario that has been failing (third attempt).
    // One turn with TWO goal events mid-stream, both must render inline.
    it("interleaves multiple goal events inline at their exact seq positions within a single turn", () => {
      const transcript = createTranscriptState("c42ad602");
      addTurn(transcript, "a423480f", true);
      // Turn seq range: 8-72
      // seq 9: user "asdf"
      addUserItem(transcript, "a423480f", "item-user", "asdf", 9);
      // seq 10-29: assistant "Hey! What can I help you with?"
      addAssistantItem(transcript, "a423480f", "item-hey", "Hey! What can I help you with?", 10);
      // seq 31: goal_updated status=active "Goal set — Asdf" (MID-TURN, after item-hey)
      // seq 32-71: assistant "Goal acknowledged: Asdf…"
      addAssistantItem(transcript, "a423480f", "item-ack", "Goal acknowledged: Asdf…", 32);
      // seq 72: goal_updated status=failed "Goal stopped — failed" (END of turn)

      const rows = buildTranscriptRowModel({
        activeSessionId: "c42ad602",
        transcript,
        visibleOptimisticPrompt: null,
        latestTurnId: "a423480f",
        latestTurnHasAssistantRenderableContent: true,
        goalEvents: [
          goalEvent(31, "set"), // Mid-turn, after "Hey!" before "Goal acknowledged"
          goalEvent(72, "failed"), // End of turn, after "Goal acknowledged"
        ],
      });

      // Expected row structure:
      // [0] turn content sub-row: seq 9-30 (user "asdf" + assistant "Hey!")
      // [1] goal event: seq 31 "Goal set — Asdf"
      // [2] turn content sub-row: seq 32-71 (assistant "Goal acknowledged")
      // [3] goal event: seq 72 "Goal stopped — failed"

      // CRITICAL ASSERTIONS:
      // 1. Must have 4 rows (2 content sub-rows + 2 goal rows)
      expect(rows).toHaveLength(4);

      // 2. First row: turn content with user + "Hey!"
      expect(rows[0]).toMatchObject({
        kind: "turn",
        turnId: "a423480f",
        isFirstTurnRow: true,
        isLastTurnRow: false,
      });
      // Verify it contains items with seq < 31
      const firstRowBlocks = (rows[0] as Extract<typeof rows[0], { kind: "turn" }>)
        .renderPresentation.displayBlocks;
      expect(firstRowBlocks.length).toBeGreaterThan(0);
      expect(firstRowBlocks.some((b) =>
        b.kind === "item" && b.itemId === "item-user"
      )).toBe(true);
      expect(firstRowBlocks.some((b) =>
        b.kind === "item" && b.itemId === "item-hey"
      )).toBe(true);

      // 3. Second row: goal event seq 31
      expect(rows[1]).toMatchObject({
        kind: "goal_event",
        event: expect.objectContaining({
          seq: 31,
          kind: "set",
        }),
      });

      // 4. Third row: turn content with "Goal acknowledged"
      expect(rows[2]).toMatchObject({
        kind: "turn",
        turnId: "a423480f",
        isFirstTurnRow: false,
        isLastTurnRow: true,
      });
      const thirdRowBlocks = (rows[2] as Extract<typeof rows[2], { kind: "turn" }>)
        .renderPresentation.displayBlocks;
      expect(thirdRowBlocks.some((b) =>
        b.kind === "item" && b.itemId === "item-ack"
      )).toBe(true);

      // 5. Fourth row: goal event seq 72
      expect(rows[3]).toMatchObject({
        kind: "goal_event",
        event: expect.objectContaining({
          seq: 72,
          kind: "failed",
        }),
      });

      // CRITICAL: Goal rows are NOT at index 0 (not moved to top)
      expect(rows.findIndex((r) => r.kind === "goal_event")).toBe(1);
      // CRITICAL: Goal rows are NOT both at the end (not dumped to bottom)
      const goalIndices = rows
        .map((r, i) => (r.kind === "goal_event" ? i : -1))
        .filter((i) => i >= 0);
      expect(goalIndices).toEqual([1, 3]);
    });

    function addAssistantItem(
      transcript: TranscriptState,
      turnId: string,
      itemId: string,
      text: string,
      startedSeq: number,
    ) {
      const turn = transcript.turnsById[turnId];
      if (!turn) {
        throw new Error(`missing test turn ${turnId}`);
      }
      turn.itemOrder.push(itemId);
      transcript.itemsById[itemId] = {
        kind: "assistant_prose",
        itemId,
        turnId,
        text,
        isStreaming: false,
        startedSeq,
      } as TranscriptState["itemsById"][string];
    }
  });

  describe("goal-event history collapse scoping", () => {
    // Ground truth: session e06fe0dc, turn 17a8a46d.
    // A Stop-hook-extended turn with a goal boundary at seq 25.
    it("scopes the completed-history collapse to the final slice only (ground truth)", () => {
      const transcript = createTranscriptState("session-e06fe0dc");
      addTurn(transcript, "turn-17a8a46d", true);

      // seq 9: user_message "hi"
      addUserItem(transcript, "turn-17a8a46d", "item-user-9", "hi", 9);
      // seq 11: reasoning (thought)
      addThoughtItems(transcript, "turn-17a8a46d", 1, 11);
      // seq 18: assistant_message "Hey! What are you working on?"
      addAssistantItem(transcript, "turn-17a8a46d", "item-asst-18", "Hey! What are you working on?", 18);
      // seq 24: turn_ended (not an item — just marks goal boundary)
      // seq 25: goal_updated boundary
      // seq 26: reasoning (SAME turn id — goal continuation)
      addThoughtItems2(transcript, "turn-17a8a46d", 1, 26);
      // seq 31: assistant_message
      addAssistantItem(transcript, "turn-17a8a46d", "item-asst-31", "I'll create the file.", 31);
      // seq 35: tool_invocation
      addToolItem(transcript, "turn-17a8a46d", "item-tool-35", 35);
      // seq 40: assistant_message
      addAssistantItem(transcript, "turn-17a8a46d", "item-asst-40", "Done writing.", 40);
      // seq 46: tool_invocation
      addToolItem(transcript, "turn-17a8a46d", "item-tool-46", 46);
      // seq 51: final assistant_message
      addAssistantItem(transcript, "turn-17a8a46d", "item-asst-51", "Created the file with 'jam'.", 51);

      const rows = buildTranscriptRowModel({
        activeSessionId: "session-e06fe0dc",
        transcript,
        visibleOptimisticPrompt: null,
        latestTurnId: "turn-17a8a46d",
        latestTurnHasAssistantRenderableContent: true,
        goalEvents: [goalEvent(25, "set")],
      });

      // Expected structure:
      // [0] turn slice: seq 9-18 (user, thought, assistant-18) — PLAIN (no collapse)
      // [1] goal-event row seq 25
      // [2] turn slice: seq 26-51 (thought, assistant-31, tool-35, assistant-40, tool-46, final-51)
      //     — this is the final slice with scoped collapse; isLastTurnRow=true

      const turnRows = rows.filter((r) => r.kind === "turn") as Extract<typeof rows[number], { kind: "turn" }>[];
      const goalEventRows = rows.filter((r) => r.kind === "goal_event");

      expect(goalEventRows).toHaveLength(1);
      expect(goalEventRows[0]).toMatchObject({
        kind: "goal_event",
        event: expect.objectContaining({ seq: 25 }),
      });

      expect(turnRows).toHaveLength(2);

      // First slice: PLAIN — no history collapse
      const firstSlice = turnRows[0];
      expect(firstSlice.renderPresentation.completedHistoryRootIds).toEqual([]);
      expect(firstSlice.renderPresentation.completedHistorySummary).toBeNull();
      expect(firstSlice.isFirstTurnRow).toBe(true);
      expect(firstSlice.isLastTurnRow).toBe(false);

      // Second (final) slice: has scoped collapse + is last turn row
      const finalSlice = turnRows[1];
      expect(finalSlice.renderPresentation.completedHistorySummary).not.toBeNull();
      expect(finalSlice.renderPresentation.completedHistoryRootIds.length).toBeGreaterThan(0);
      expect(finalSlice.isFirstTurnRow).toBe(false);
      expect(finalSlice.isLastTurnRow).toBe(true);

      // The scoped history should only include items from the final slice,
      // not items from the first slice (e.g. reasoning at seq 11, assistant at seq 18)
      expect(finalSlice.renderPresentation.completedHistoryRootIds).not.toContain("item-asst-18");
      expect(finalSlice.renderPresentation.completedHistoryRootIds).not.toContain("item-0");

      // Verify ordering: first slice, then goal, then final slice
      const firstSliceIdx = rows.indexOf(firstSlice);
      const goalIdx = rows.indexOf(goalEventRows[0]);
      const finalSliceIdx = rows.indexOf(finalSlice);
      expect(firstSliceIdx).toBeLessThan(goalIdx);
      expect(goalIdx).toBeLessThan(finalSliceIdx);
    });

    it("no slice other than the final one carries a completedHistorySummary", () => {
      const transcript = createTranscriptState("session-1");
      addTurn(transcript, "turn-1", true);
      addUserItem(transcript, "turn-1", "item-user", "hi", 1);
      addAssistantItem2(transcript, "turn-1", "item-a1", "reply 1", 5);
      addToolItem(transcript, "turn-1", "item-t1", 10);
      addAssistantItem2(transcript, "turn-1", "item-a2", "reply 2", 15);
      addToolItem(transcript, "turn-1", "item-t2", 20);
      addAssistantItem2(transcript, "turn-1", "item-final", "final", 25);

      const rows = buildTranscriptRowModel({
        activeSessionId: "session-1",
        transcript,
        visibleOptimisticPrompt: null,
        latestTurnId: "turn-1",
        latestTurnHasAssistantRenderableContent: true,
        goalEvents: [goalEvent(8, "set")],
      });

      const turnRows = rows.filter((r) => r.kind === "turn") as Extract<typeof rows[number], { kind: "turn" }>[];
      // Only the last turn row (containing finalAssistantItemId) may have a summary
      for (let i = 0; i < turnRows.length - 1; i += 1) {
        expect(turnRows[i].renderPresentation.completedHistorySummary).toBeNull();
      }
    });

    it("goal-less large turn still chunks exactly as before (regression guard)", () => {
      const transcript = createTranscriptState("session-1");
      addTurn(transcript, "turn-large", true);
      addThoughtItems(transcript, "turn-large", 30);

      const rows = buildTranscriptRowModel({
        activeSessionId: "session-1",
        transcript,
        visibleOptimisticPrompt: null,
        latestTurnId: "turn-large",
        latestTurnHasAssistantRenderableContent: true,
        // No goal events
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

    function addAssistantItem(
      transcript: TranscriptState,
      turnId: string,
      itemId: string,
      text: string,
      startedSeq: number,
    ) {
      const turn = transcript.turnsById[turnId];
      if (!turn) throw new Error(`missing test turn ${turnId}`);
      turn.itemOrder.push(itemId);
      transcript.itemsById[itemId] = {
        kind: "assistant_prose",
        itemId,
        turnId,
        text,
        isStreaming: false,
        startedSeq,
      } as TranscriptState["itemsById"][string];
    }

    // Variant that doesn't conflict with the outer-scope helper
    function addAssistantItem2(
      transcript: TranscriptState,
      turnId: string,
      itemId: string,
      text: string,
      startedSeq: number,
    ) {
      addAssistantItem(transcript, turnId, itemId, text, startedSeq);
    }

    function addToolItem(
      transcript: TranscriptState,
      turnId: string,
      itemId: string,
      startedSeq: number,
    ) {
      const turn = transcript.turnsById[turnId];
      if (!turn) throw new Error(`missing test turn ${turnId}`);
      turn.itemOrder.push(itemId);
      transcript.itemsById[itemId] = terminalItem(itemId, turnId, startedSeq);
    }

    // Thought items with unique item ids (to not collide with the outer addThoughtItems
    // which uses `item-${index}` naming)
    function addThoughtItems2(
      transcript: TranscriptState,
      turnId: string,
      count: number,
      startedSeqOffset: number,
    ) {
      const turn = transcript.turnsById[turnId];
      if (!turn) throw new Error(`missing test turn ${turnId}`);
      for (let i = 0; i < count; i += 1) {
        const itemId = `thought-${turnId}-${startedSeqOffset + i}`;
        turn.itemOrder.push(itemId);
        transcript.itemsById[itemId] = thoughtItem(
          itemId,
          turnId,
          startedSeqOffset + i,
          false,
        );
      }
    }
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

function goalEvent(seq: number, kind: string): GoalTranscriptEvent {
  return {
    id: String(seq),
    seq,
    turnId: null,
    kind: kind as GoalTranscriptEvent["kind"],
    objective: "ship the thing",
    detail: null,
  };
}
