import { describe, expect, it } from "vitest";
import { resolveModelDisplayName } from "#product/lib/domain/chat/models/model-display";

describe("edge cases", () => {
  it("date-suffixed bare-5 not confused with minor", () => {
    // Hypothetical: claude-sonnet-5-20260101 should not become "5.20260101"
    expect(resolveModelDisplayName({ agentKind: "claude", modelId: "claude-sonnet-5-20260101", preferKnownAlias: true }))
      .toBe("Sonnet 5");
  });
  it("1m suffix variants", () => {
    expect(resolveModelDisplayName({ agentKind: "claude", modelId: "claude-sonnet-5-1m", preferKnownAlias: true }))
      .toBe("Sonnet 5 (1M context)");
    expect(resolveModelDisplayName({ agentKind: "claude", modelId: "claude-sonnet-5[1m]", preferKnownAlias: true }))
      .toBe("Sonnet 5 (1M context)");
  });
  it("major-minor with date suffix", () => {
    expect(resolveModelDisplayName({ agentKind: "claude", modelId: "claude-sonnet-4-5-20250929", preferKnownAlias: true }))
      .toBe("Sonnet 4.5");
  });
});
