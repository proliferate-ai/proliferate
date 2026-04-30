import { describe, expect, it } from "vitest";
import { formatSubagentLabel, isSubagentWakeProvenance, shortSessionId } from "./provenance";

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
