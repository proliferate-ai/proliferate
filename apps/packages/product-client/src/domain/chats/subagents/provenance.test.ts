import { describe, expect, it } from "vitest";
import {
  formatAgentWakePromptQueueText,
  formatAgentWakePromptTranscriptText,
  formatWakePromptQueueText,
  formatSubagentLabel,
  isAgentWakeProvenance,
  isSubagentWakeProvenance,
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
      relation: "owned_agent",
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

  it("falls back to generic subagent copy for unlabeled link wake prompts", () => {
    expect(formatWakePromptQueueText({
      type: "linkWake",
      relation: "owned_agent",
      sessionLinkId: "link-1",
      completionId: "completion-1",
    })).toBe("Subagent finished");
  });
});

describe("isAgentWakeProvenance", () => {
  it("accepts session-scoped wake pointers", () => {
    expect(isAgentWakeProvenance({
      type: "agentWake",
      targetSessionId: "target-1",
      label: "billing-webhooks",
    })).toBe(true);
  });

  it("rejects link-scoped wakes so they keep their completion-aware copy", () => {
    expect(isAgentWakeProvenance({
      type: "subagentWake",
      sessionLinkId: "link-1",
      completionId: "completion-1",
    })).toBe(false);
  });
});

describe("formatAgentWakePromptQueueText", () => {
  it("uses the pointer label", () => {
    expect(formatAgentWakePromptQueueText({
      type: "agentWake",
      targetSessionId: "target-1",
      label: "billing-webhooks",
    })).toBe("billing-webhooks finished");
  });

  it("falls back to a generic agent title when the pointer carries no label", () => {
    expect(formatAgentWakePromptQueueText({
      type: "agentWake",
      targetSessionId: "target-1",
    })).toBe("Agent finished");
  });

  it("never reports an outcome because the pointer has no completion row", () => {
    expect(formatAgentWakePromptTranscriptText({
      type: "agentWake",
      targetSessionId: "target-1",
      label: "billing-webhooks",
    })).toBe("billing-webhooks finished");
  });
});
