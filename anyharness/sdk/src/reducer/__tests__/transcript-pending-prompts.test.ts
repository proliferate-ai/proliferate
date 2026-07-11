import { describe, expect, it } from "vitest";

import { reduceEvents } from "../../index.js";
import type { SessionEventEnvelope } from "../../index.js";

describe("transcript pending-prompt reducer", () => {
  it("does not deduplicate distinct pending prompts by prompt id", () => {
    const state = reduceEvents(
      [
        pendingPromptAdded(1, 10, "prompt-1", "first"),
        pendingPromptAdded(2, 11, "prompt-1", "second"),
        pendingPromptUpdated(3, 11, "prompt-1", "updated"),
      ],
      "session-1",
    );

    expect(state.pendingPrompts).toHaveLength(2);
    expect(state.pendingPrompts[0]).toMatchObject({
      seq: 10,
      promptId: "prompt-1",
      text: "first",
    });
    expect(state.pendingPrompts[1]).toMatchObject({
      seq: 11,
      promptId: "prompt-1",
      text: "updated",
    });
  });

  it("removes pending prompts by seq only when prompt id collides", () => {
    const state = reduceEvents(
      [
        pendingPromptAdded(1, 10, "prompt-1", "first"),
        pendingPromptAdded(2, 11, "prompt-1", "second"),
        pendingPromptRemoved(3, 10, "prompt-1"),
      ],
      "session-1",
    );

    expect(state.pendingPrompts).toHaveLength(1);
    expect(state.pendingPrompts[0]).toMatchObject({
      seq: 11,
      promptId: "prompt-1",
      text: "second",
    });
  });

  it("replaces queue order without changing stable pending seq identity", () => {
    const state = reduceEvents(
      [
        pendingPromptAdded(1, 1, "prompt-1", "first"),
        pendingPromptAdded(2, 2, "prompt-2", "second"),
        pendingPromptsReordered(3, [
          { seq: 2, promptId: "prompt-2", text: "second" },
          { seq: 1, promptId: "prompt-1", text: "first" },
        ]),
      ],
      "session-1",
    );

    expect(state.pendingPrompts.map((prompt) => ({
      seq: prompt.seq,
      promptId: prompt.promptId,
      text: prompt.text,
    }))).toEqual([
      { seq: 2, promptId: "prompt-2", text: "second" },
      { seq: 1, promptId: "prompt-1", text: "first" },
    ]);
  });
});

function pendingPromptAdded(
  eventSeq: number,
  pendingSeq: number,
  promptId: string | null,
  text: string,
): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq: eventSeq,
    timestamp: `2026-04-04T00:00:0${eventSeq}Z`,
    event: {
      type: "pending_prompt_added",
      seq: pendingSeq,
      promptId,
      text,
      contentParts: [{ type: "text", text }],
      queuedAt: `2026-04-04T00:00:0${eventSeq}Z`,
      promptProvenance: null,
    },
  };
}

function pendingPromptUpdated(
  eventSeq: number,
  pendingSeq: number,
  promptId: string | null,
  text: string,
): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq: eventSeq,
    timestamp: `2026-04-04T00:00:0${eventSeq}Z`,
    event: {
      type: "pending_prompt_updated",
      seq: pendingSeq,
      promptId,
      text,
      contentParts: [{ type: "text", text }],
      promptProvenance: null,
    },
  };
}

function pendingPromptRemoved(
  eventSeq: number,
  pendingSeq: number,
  promptId: string | null,
): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq: eventSeq,
    timestamp: `2026-04-04T00:00:0${eventSeq}Z`,
    event: {
      type: "pending_prompt_removed",
      seq: pendingSeq,
      promptId,
      reason: "deleted",
    },
  };
}

function pendingPromptsReordered(
  eventSeq: number,
  prompts: Array<{ seq: number; promptId: string; text: string }>,
): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq: eventSeq,
    timestamp: `2026-04-04T00:00:0${eventSeq}Z`,
    event: {
      type: "pending_prompts_reordered",
      pendingPrompts: prompts.map((prompt) => ({
        ...prompt,
        contentParts: [{ type: "text", text: prompt.text }],
        queuedAt: `2026-04-04T00:00:0${eventSeq}Z`,
        promptProvenance: null,
      })),
    },
  };
}
