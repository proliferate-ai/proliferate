import { describe, expect, it } from "vitest";
import {
  resolveMatchingModelControlLabel,
  resolveModelDisplayName,
  shouldHideModel,
} from "#product/lib/domain/chat/models/model-display";

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

  // Table-driven: every claude-<family>-5 id in catalogs/agents/catalog.json
  // (fable, sonnet — the third "opus" case is a hypothetical future id, kept
  // here so a real one lands with a passing test instead of a surprise), the
  // major.minor generation, the -1m / [1m] context variants, and the
  // date-suffixed revisions. Each row asserts derivation from the bare
  // modelId (no sourceLabels) so a fresh id with no catalog label yet still
  // renders correctly.
  const CLAUDE_MODEL_ID_CASES: Array<[modelId: string, expected: string]> = [
    // Bare, no-minor generation ("claude-<family>-5").
    ["claude-sonnet-5", "Sonnet 5"],
    ["claude-fable-5", "Fable 5"],
    ["us.anthropic.claude-opus-5", "Opus 5"],
    // Namespaced bare-5 ids as they actually appear in the catalog.
    ["anthropic/claude-sonnet-5", "Sonnet 5"],
    ["opencode/claude-fable-5", "Fable 5"],
    ["global.anthropic.claude-fable-5", "Fable 5"],
    // Major.minor generation, unaffected by the optional-minor change.
    ["claude-sonnet-4-6", "Sonnet 4.6"],
    ["claude-haiku-4-5", "Haiku 4.5"],
    // 1M-context suffixes, both spellings, on both version shapes.
    ["us.anthropic.claude-sonnet-4-6[1m]", "Sonnet 4.6 (1M context)"],
    ["claude-sonnet-5[1m]", "Sonnet 5 (1M context)"],
    ["claude-sonnet-5-1m", "Sonnet 5 (1M context)"],
    // Date-suffixed revisions must not be mistaken for a minor version.
    ["claude-sonnet-4-5-20250929", "Sonnet 4.5"],
    ["claude-haiku-4-5-20251001", "Haiku 4.5"],
    ["claude-sonnet-5-20260101", "Sonnet 5"],
  ];

  it.each(CLAUDE_MODEL_ID_CASES)("derives %s -> %s", (modelId, expected) => {
    // agentKind "opencode" (rather than "claude") so none of these ids can
    // resolve through MODEL_DISPLAY_ALIASES — this table exercises
    // formatClaudeModelId's id parsing specifically, not the alias table.
    expect(
      resolveModelDisplayName({
        agentKind: "opencode",
        modelId,
        preferKnownAlias: true,
      }),
    ).toBe(expected);
  });

  it("derives the 1M-context hint for a dash-suffixed major.minor id not in the alias table", () => {
    // claude-sonnet-4-6-1m IS in MODEL_DISPLAY_ALIASES under agentKind
    // "claude", so it is covered by the alias-table test below instead; this
    // exercises the same dash-1m suffix on an unaliased opencode-namespaced id.
    expect(
      resolveModelDisplayName({
        agentKind: "opencode",
        modelId: "opencode/claude-sonnet-4-6-1m",
        preferKnownAlias: true,
      }),
    ).toBe("Sonnet 4.6 (1M context)");
  });

  // Table-driven: the literal catalog `displayName` strings for the bare-5
  // ids, both the hyphenated cursor form and the space-separated
  // provider-namespaced forms, run through the sourceLabels path.
  const CLAUDE_SOURCE_LABEL_CASES: Array<[
    modelId: string,
    sourceLabel: string,
    expected: string,
  ]> = [
    // Hyphenated catalog label ("Claude-Sonnet-5") from the cursor harness.
    ["claude-sonnet-5", "Claude-Sonnet-5", "Sonnet 5"],
    // Space-separated catalog label ("Claude Fable 5") from the same harness.
    ["claude-fable-5", "Claude Fable 5", "Fable 5"],
    // Provider-namespaced forms must keep the provider badge and only drop
    // the redundant family word from the leaf.
    ["anthropic/claude-sonnet-5", "Anthropic/Claude Sonnet 5", "Anthropic/Sonnet 5"],
    [
      "opencode/claude-sonnet-5",
      "OpenCode Zen/Claude Sonnet 5",
      "OpenCode Zen/Sonnet 5",
    ],
    [
      "opencode/claude-fable-5",
      "OpenCode Zen/Claude Fable 5",
      "OpenCode Zen/Fable 5",
    ],
    // Date suffixes inside an already-spaced label survive verbatim.
    [
      "claude-sonnet-4-5-20250929",
      "Claude Sonnet 4.5 (2025-09-29)",
      "Sonnet 4.5 (2025-09-29)",
    ],
  ];

  it.each(CLAUDE_SOURCE_LABEL_CASES)(
    "normalizes catalog label %j for %s -> %s",
    (modelId, sourceLabel, expected) => {
      expect(
        resolveModelDisplayName({
          agentKind: "claude",
          modelId,
          sourceLabels: [sourceLabel],
        }),
      ).toBe(expected);
    },
  );

  // Regression: non-Anthropic families must be untouched by the family-word
  // stripping added for Claude.
  const NON_ANTHROPIC_REGRESSION_CASES: Array<[
    agentKind: string,
    modelId: string,
    sourceLabel: string,
    expected: string,
  ]> = [
    ["codex", "gpt-5.5", "GPT-5.5", "GPT 5.5"],
    ["opencode", "gemini-2.5-pro", "Gemini-2.5-Pro", "Gemini 2.5 Pro"],
  ];

  it.each(NON_ANTHROPIC_REGRESSION_CASES)(
    "leaves non-Anthropic label %j untouched -> %s",
    (agentKind, modelId, sourceLabel, expected) => {
      expect(
        resolveModelDisplayName({
          agentKind,
          modelId,
          sourceLabels: [sourceLabel],
          preferKnownAlias: true,
        }),
      ).toBe(expected);
    },
  );

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
