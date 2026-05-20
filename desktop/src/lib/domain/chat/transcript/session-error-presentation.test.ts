import { describe, expect, it } from "vitest";
import type { ErrorItem } from "@anyharness/sdk";
import {
  formatModelLabel,
  presentSessionError,
} from "@/lib/domain/chat/transcript/session-error-presentation";

describe("presentSessionError", () => {
  it("turns provider rate limits into concise user-facing copy", () => {
    const presentation = presentSessionError(errorItem({
      message: "Error: provider returned 429 with a long upstream explanation",
      details: {
        kind: "provider_rate_limit",
        provider: "anthropic",
        providerModel: "claude-opus-4-7",
        limit: 30000,
        unit: "input_tokens_per_minute",
        fallbackModelId: "claude-opus-4-6",
      },
    }));

    expect(presentation).toMatchObject({
      title: "Anthropic rate limit reached",
      description: "This chat exceeded the provider limit for Opus 4.7. Try again later or switch to Opus 4.6.",
      fallbackModelLabel: "Opus 4.6",
      technicalDetail: "provider returned 429 with a long upstream explanation",
    });
  });

  it("keeps generic failures short and moves long text into details", () => {
    const presentation = presentSessionError(errorItem({
      code: "RUNTIME_STREAM_FAILED",
      message: "Runtime error: " + "x".repeat(220),
    }));

    expect(presentation.title).toBe("Chat stopped");
    expect(presentation.description.length).toBeLessThanOrEqual(180);
    expect(presentation.technicalDetail).toContain("Error code: RUNTIME_STREAM_FAILED");
    expect(presentation.technicalDetail).toContain("x".repeat(40));
  });
});

describe("formatModelLabel", () => {
  it("formats Claude model ids as compact names", () => {
    expect(formatModelLabel("claude-opus-4-6")).toBe("Opus 4.6");
  });
});

function errorItem(overrides: Partial<ErrorItem>): ErrorItem {
  return {
    kind: "error",
    itemId: "error-1",
    turnId: "turn-1",
    status: "failed",
    sourceAgentKind: "claude",
    messageId: null,
    title: null,
    nativeToolName: null,
    parentToolCallId: null,
    contentParts: [],
    timestamp: "2026-04-04T00:00:00Z",
    startedSeq: 1,
    lastUpdatedSeq: 1,
    completedSeq: 1,
    completedAt: "2026-04-04T00:00:00Z",
    message: "Something failed",
    code: null,
    details: null,
    ...overrides,
  };
}
