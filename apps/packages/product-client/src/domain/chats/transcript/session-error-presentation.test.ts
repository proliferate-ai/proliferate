import { describe, expect, it } from "vitest";
import type { ErrorItem } from "@anyharness/sdk";
import {
  formatModelLabel,
  presentSessionError,
} from "./session-error-presentation";

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
      technicalDetail: "Error: provider returned 429 with a long upstream explanation",
      recoveryAction: null,
    });
  });

  it("turns a seat plan-limit death into plain words with the relaunch recovery", () => {
    // A date that can never be "today" again, so the day clause is stable.
    const resetAt = "2026-01-05T18:00:00Z";
    const presentation = presentSessionError(errorItem({
      code: "seat_usage_limit",
      message: "seat usage limit reached",
      details: {
        kind: "seat_usage_limit",
        seatId: "seat-1",
        "window": "five_hour",
        resetAt,
      } as unknown as ErrorItem["details"],
    }));

    const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })
      .format(new Date(resetAt));
    const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })
      .format(new Date(resetAt));
    expect(presentation).toMatchObject({
      title: "Claude.ai plan limit reached",
      description:
        `This session's Claude.ai login hit its plan limit. It resets at ${time} on ${day}.`,
      fallbackModelLabel: null,
      recoveryAction: "relaunch_session",
    });
    // No bare code reaches the human copy.
    expect(presentation.title).not.toContain("seat_usage_limit");
    expect(presentation.description).not.toContain("seat_usage_limit");
  });

  it("drops the reset clause when the seat-limit reset instant does not parse", () => {
    const presentation = presentSessionError(errorItem({
      details: {
        kind: "seat_usage_limit",
        seatId: "seat-1",
        "window": null,
        resetAt: "garbage",
      } as unknown as ErrorItem["details"],
    }));

    expect(presentation.description).toBe(
      "This session's Claude.ai login hit its plan limit.",
    );
    expect(presentation.recoveryAction).toBe("relaunch_session");
  });

  it("turns the bounded unavailable-model code into an actionable recovery", () => {
    const presentation = presentSessionError(errorItem({
      code: "provider_model_unavailable",
      message: "An updated harness message that does not need phrase matching",
      sourceAgentKind: "opencode",
    }));

    expect(presentation).toMatchObject({
      title: "Model unavailable",
      description:
        "The selected model isn't available from this provider. Choose another model, then try again.",
      recoveryAction: "choose_model",
    });
    expect(presentation.technicalDetail).toContain(
      "Error code: provider_model_unavailable",
    );
  });

  it("uses the bounded configuration code when provider wording changes", () => {
    const presentation = presentSessionError(errorItem({
      code: "provider_model_configuration_unsupported",
      message: "A future provider message",
      sourceAgentKind: "opencode",
    }));

    expect(presentation).toMatchObject({
      title: "Model settings unsupported",
      description:
        "The provider rejected the reasoning settings for this model. Choose another model, then try again.",
      recoveryAction: "choose_model",
    });
  });

  it("recognizes a legacy invalid-model error without promoting diagnostics into copy", () => {
    const raw = `Internal error: undefined: The provided model identifier is invalid.: {
  "errorName": "APIError",
  "service": "session"
}`;
    const presentation = presentSessionError(errorItem({
      message: raw,
      sourceAgentKind: "opencode",
    }));

    expect(presentation).toMatchObject({
      title: "Model unavailable",
      description:
        "The selected model isn't available from this provider. Choose another model, then try again.",
      technicalDetail: raw,
      recoveryAction: "choose_model",
    });
    expect(presentation.description).not.toContain("undefined");
    expect(presentation.description).not.toContain("APIError");
  });

  it("recognizes a legacy unsupported-reasoning error and keeps the cause in details", () => {
    const raw = `Internal error: undefined: The model returned the following errors: "thinking.type.enabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.: {
  "errorName": "APIError",
  "service": "session"
}`;
    const presentation = presentSessionError(errorItem({
      message: raw,
      sourceAgentKind: "opencode",
    }));

    expect(presentation).toMatchObject({
      title: "Model settings unsupported",
      description:
        "The provider rejected the reasoning settings for this model. Choose another model, then try again.",
      technicalDetail: raw,
      recoveryAction: "choose_model",
    });
    expect(presentation.description).not.toContain("thinking.type.enabled");
    expect(presentation.description).not.toContain("undefined");
  });

  it("sanitizes transport wrappers in generic copy without discarding technical detail", () => {
    const raw = `Internal error: undefined: Something else failed.: {
  "errorName": "APIError",
  "service": "session"
}`;
    const presentation = presentSessionError(errorItem({
      message: raw,
      sourceAgentKind: "claude",
    }));

    expect(presentation).toMatchObject({
      title: "Chat stopped",
      description: "Something else failed.",
      technicalDetail: raw,
      recoveryAction: null,
    });
  });

  it("does not misclassify unrelated unsupported model capabilities", () => {
    const presentation = presentSessionError(errorItem({
      message:
        "Internal error: undefined: The model returned the following errors: tools are not supported for this model.",
      sourceAgentKind: "opencode",
    }));

    expect(presentation.title).toBe("Chat stopped");
    expect(presentation.recoveryAction).toBeNull();
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
