import { describe, expect, it } from "vitest";
import { createSendPromptIntent } from "./session-intent-model";
import { lastPromptSubmittedAtMs } from "./session-intent-selectors";
import { createOptimisticPendingPrompt } from "../../chats/pending-prompts/pending-prompts";

describe("lastPromptSubmittedAtMs", () => {
  it("stamps the newest submission from outbox createdAt regardless of placement", () => {
    const early = {
      ...createSendPromptIntent({
        clientPromptId: "prompt-early",
        clientSessionId: "session-1",
        text: "First",
        blocks: [{ type: "text" as const, text: "First" }],
      }),
      createdAt: "2026-01-01T00:00:01.000Z",
    };
    // Queue placement is still a submit: sending while the agent is busy must
    // re-pin even though the entry renders in the dock, not the transcript.
    const lateQueued = {
      ...createSendPromptIntent({
        clientPromptId: "prompt-late",
        clientSessionId: "session-1",
        text: "Second",
        blocks: [{ type: "text" as const, text: "Second" }],
        placement: "queue" as const,
      }),
      createdAt: "2026-01-01T00:00:05.000Z",
    };

    expect(lastPromptSubmittedAtMs([], null)).toBeNull();
    expect(lastPromptSubmittedAtMs([lateQueued, early], null))
      .toBe(Date.parse("2026-01-01T00:00:05.000Z"));

    const optimistic = createOptimisticPendingPrompt(
      "Third",
      "prompt-optimistic",
      "2026-01-01T00:00:09.000Z",
    );
    expect(lastPromptSubmittedAtMs([lateQueued, early], optimistic))
      .toBe(Date.parse("2026-01-01T00:00:09.000Z"));
  });
});
