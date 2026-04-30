import { describe, expect, it } from "vitest";
import { resolveModelDisplayName } from "@/lib/domain/chat/model-display";

describe("resolveModelDisplayName", () => {
  it("uses runtime catalog labels when provided", () => {
    expect(
      resolveModelDisplayName({
        agentKind: "claude",
        modelId: "opus[1m]",
        sourceLabels: ["Opus 4.7"],
      }),
    ).toBe("Opus 4.7");
  });

  it("keeps 1M context out of fallback primary labels", () => {
    expect(
      resolveModelDisplayName({
        agentKind: "claude",
        modelId: "sonnet[1m]",
      }),
    ).toBe("Sonnet 4.6");
  });

  it("uses a concise display label for pinned Claude Opus 4.6", () => {
    expect(
      resolveModelDisplayName({
        agentKind: "claude",
        modelId: "claude-opus-4-6",
      }),
    ).toBe("Opus 4.6");
  });

  it("has a fallback label for the next Codex candidate", () => {
    expect(
      resolveModelDisplayName({
        agentKind: "codex",
        modelId: "gpt-5.5",
      }),
    ).toBe("GPT 5.5");
  });
});
