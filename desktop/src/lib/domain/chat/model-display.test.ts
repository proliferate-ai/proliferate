import { describe, expect, it } from "vitest";
import {
  resolveMatchingModelControlLabel,
  resolveModelDisplayName,
} from "@/lib/domain/chat/model-display";

const MODEL_CONTROL = {
  currentValue: "opus[1m]",
  values: [
    { value: "opus[1m]", label: "Opus 4.7" },
    { value: "claude-opus-4-6", label: "Opus 4.6" },
  ],
};

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

describe("resolveMatchingModelControlLabel", () => {
  it("uses a live-config label when it matches the selected model", () => {
    expect(resolveMatchingModelControlLabel({
      modelId: "opus[1m]",
      control: MODEL_CONTROL,
    })).toBe("Opus 4.7");
  });

  it("ignores stale live-config labels for a different selected model", () => {
    expect(resolveMatchingModelControlLabel({
      modelId: "claude-opus-4-6",
      control: MODEL_CONTROL,
    })).toBeNull();
  });

  it("uses a pending displayed model value when it matches the selected model", () => {
    expect(resolveMatchingModelControlLabel({
      modelId: "claude-opus-4-6",
      control: MODEL_CONTROL,
      displayedModelValue: "claude-opus-4-6",
    })).toBe("Opus 4.6");
  });
});
