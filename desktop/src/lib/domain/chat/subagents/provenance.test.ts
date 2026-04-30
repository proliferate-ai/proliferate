import { describe, expect, it } from "vitest";
import {
  formatWakePromptQueueText,
  formatSubagentLabel,
  isSubagentWakeProvenance,
  resolveReviewFeedbackPromptReference,
  shortSessionId,
} from "./provenance";

describe("formatSubagentLabel", () => {
  it("uses a provided label after trimming whitespace", () => {
    expect(formatSubagentLabel("  frontend survey  ", 2)).toBe("frontend survey");
  });

  it("falls back to a stable ordinal label for blank labels", () => {
    expect(formatSubagentLabel("", 3)).toBe("Subagent 3");
    expect(formatSubagentLabel("   ", 4)).toBe("Subagent 4");
    expect(formatSubagentLabel(null, 5)).toBe("Subagent 5");
    expect(formatSubagentLabel(undefined, 6)).toBe("Subagent 6");
  });
});

describe("shortSessionId", () => {
  it("returns the first eight characters for long session ids", () => {
    expect(shortSessionId("12345678-abcdef")).toBe("12345678");
  });

  it("leaves short session ids intact", () => {
    expect(shortSessionId("short")).toBe("short");
  });
});

describe("isSubagentWakeProvenance", () => {
  it("accepts relation-aware link wake provenance", () => {
    expect(isSubagentWakeProvenance({
      type: "linkWake",
      relation: "cowork_coding_session",
      sessionLinkId: "link-1",
      completionId: "completion-1",
    })).toBe(true);
  });
});

describe("formatWakePromptQueueText", () => {
  it("formats labeled subagent wake prompts as plain queue text", () => {
    expect(formatWakePromptQueueText({
      type: "subagentWake",
      sessionLinkId: "link-1",
      completionId: "completion-1",
      label: "runtime-server-sdk-survey",
    })).toBe("runtime-server-sdk-survey finished");
  });

  it("falls back for unlabeled cowork wake prompts", () => {
    expect(formatWakePromptQueueText({
      type: "linkWake",
      relation: "cowork_coding_session",
      sessionLinkId: "link-1",
      completionId: "completion-1",
    })).toBe("Coding session finished");
  });
});

describe("resolveReviewFeedbackPromptReference", () => {
  it("resolves first-class review feedback provenance", () => {
    expect(resolveReviewFeedbackPromptReference({
      type: "reviewFeedback",
      reviewRunId: "run-1",
      reviewRoundId: "round-1",
      feedbackJobId: "job-1",
    }, "ignored")).toEqual({
      reviewRunId: "run-1",
      reviewRoundId: "round-1",
      feedbackJobId: "job-1",
      roundNumber: null,
      label: null,
    });
  });

  it("resolves legacy system review feedback prompts", () => {
    expect(resolveReviewFeedbackPromptReference({
      type: "system",
      label: "review_feedback",
    }, [
      "Review feedback is ready.",
      "",
      "Review run: cf16ea77-09a1-4a38-819c-804458f92d33",
      "Round: 1",
      "Target: plan",
    ].join("\n"))).toEqual({
      reviewRunId: "cf16ea77-09a1-4a38-819c-804458f92d33",
      reviewRoundId: null,
      feedbackJobId: null,
      roundNumber: 1,
      label: null,
    });
  });
});
