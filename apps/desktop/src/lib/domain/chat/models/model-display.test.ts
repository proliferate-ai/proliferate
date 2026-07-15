import { describe, expect, it } from "vitest";
import {
  resolveMatchingModelControlLabel,
  resolveModelDisplayName,
  shouldHideModel,
} from "@/lib/domain/chat/models/model-display";

const MODEL_CONTROL = {
  currentValue: "opus[1m]",
  values: [
    { value: "opus[1m]", label: "Opus 4.8" },
    { value: "claude-opus-4-6", label: "Opus 4.6" },
  ],
};

describe("resolveModelDisplayName", () => {
  it("uses runtime catalog labels when provided", () => {
    expect(
      resolveModelDisplayName({
        agentKind: "claude",
        modelId: "opus[1m]",
        sourceLabels: ["Opus 4.8"],
      }),
    ).toBe("Opus 4.8");
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

  it("can prefer known aliases over vague live labels", () => {
    expect(
      resolveModelDisplayName({
        agentKind: "claude",
        modelId: "claude-sonnet-4-6",
        sourceLabels: ["Sonnet"],
        preferKnownAlias: true,
      }),
    ).toBe("Sonnet 4.6");
  });

  it("adds the version before live 1M context labels", () => {
    expect(
      resolveModelDisplayName({
        agentKind: "claude",
        modelId: "sonnet[1m]",
        sourceLabels: ["Sonnet (1M context)"],
        preferKnownAlias: true,
      }),
    ).toBe("Sonnet 4.6 (1M context)");
  });

  it("derives Claude versions from provider-specific live ids", () => {
    expect(
      resolveModelDisplayName({
        agentKind: "claude",
        modelId: "us.anthropic.claude-sonnet-4-6-20251101-v1:0",
        sourceLabels: ["Sonnet"],
        preferKnownAlias: true,
      }),
    ).toBe("Sonnet 4.6");
  });

  it("derives Claude versions for dynamic harness provider ids", () => {
    expect(
      resolveModelDisplayName({
        agentKind: "opencode",
        modelId: "us.anthropic.claude-sonnet-4-6-20251101-v1:0",
        sourceLabels: ["Sonnet"],
        preferKnownAlias: true,
      }),
    ).toBe("Sonnet 4.6");
  });

  it("has a fallback label for the next Codex candidate", () => {
    expect(
      resolveModelDisplayName({
        agentKind: "codex",
        modelId: "gpt-5.5",
      }),
    ).toBe("GPT 5.5");
  });

  it("derives a Gemini label even when the catalog label is the raw id", () => {
    // The catalog ships "Gemini-2.5-Pro", which lowercases to the model id and
    // would be discarded as a raw label; the formatter must still produce a name.
    expect(
      resolveModelDisplayName({
        agentKind: "opencode",
        modelId: "gemini-2.5-pro",
        sourceLabels: ["Gemini-2.5-Pro"],
        preferKnownAlias: true,
      }),
    ).toBe("Gemini 2.5 Pro");
  });

  it("formats Gemini preview and flash variants", () => {
    expect(
      resolveModelDisplayName({
        agentKind: "opencode",
        modelId: "gemini-3-pro-preview",
      }),
    ).toBe("Gemini 3 Pro Preview");
    expect(
      resolveModelDisplayName({
        agentKind: "opencode",
        modelId: "gemini-2.5-flash",
      }),
    ).toBe("Gemini 2.5 Flash");
  });
});

describe("shouldHideModel", () => {
  it("hides legacy Claude Opus values that should not be primary choices", () => {
    expect(shouldHideModel("claude", "claude-opus-4-1")).toBe(true);
    expect(shouldHideModel("claude", "claude-opus-4-1-20250805")).toBe(true);
    expect(shouldHideModel("claude", "claude-opus-4-5")).toBe(true);
    expect(shouldHideModel("claude", "claude-opus-4-5[1m]")).toBe(true);
    expect(shouldHideModel("claude", "claude-opus-4-6-1m")).toBe(true);
    expect(shouldHideModel("claude", "claude-opus-4-6[1m]")).toBe(true);
    expect(shouldHideModel("claude", "claude-opus-4-6")).toBe(false);
    expect(shouldHideModel("opencode", "claude-opus-4-1")).toBe(false);
  });
});

describe("resolveMatchingModelControlLabel", () => {
  it("uses a live-config label when it matches the selected model", () => {
    expect(resolveMatchingModelControlLabel({
      modelId: "opus[1m]",
      control: MODEL_CONTROL,
    })).toBe("Opus 4.8");
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
