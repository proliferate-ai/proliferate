import { describe, expect, it } from "vitest";
import {
  formatModelLeafName,
  splitProviderDisplayName,
} from "#product/lib/domain/chat/models/model-display-name-parts";

describe("splitProviderDisplayName", () => {
  it("splits on the first slash", () => {
    expect(splitProviderDisplayName("OpenCode Zen/Claude Sonnet 4")).toEqual({
      leaf: "Sonnet 4",
      badge: "OpenCode Zen",
    });
  });

  it("splits on the first slash when multiple slashes exist", () => {
    expect(splitProviderDisplayName("Acme/Pro/Turbo")).toEqual({
      leaf: "Pro/Turbo",
      badge: "Acme",
    });
  });

  it("trims whitespace around both parts", () => {
    expect(splitProviderDisplayName(" OpenCode Zen / DeepSeek V4 Flash Free ")).toEqual({
      leaf: "DeepSeek V4 Flash Free",
      badge: "OpenCode Zen",
    });
  });

  it("returns null badge when no slash is present", () => {
    expect(splitProviderDisplayName("Sonnet 4.5")).toEqual({
      leaf: "Sonnet 4.5",
      badge: null,
    });
  });

  it("returns null badge when prefix is empty", () => {
    expect(splitProviderDisplayName("/Acme Sonnet 4")).toEqual({
      leaf: "/Acme Sonnet 4",
      badge: null,
    });
  });

  it("returns null badge when suffix is empty", () => {
    expect(splitProviderDisplayName("OpenCode Zen/")).toEqual({
      leaf: "OpenCode Zen/",
      badge: null,
    });
  });

  it("returns null badge when suffix is only whitespace", () => {
    expect(splitProviderDisplayName("OpenCode Zen/   ")).toEqual({
      leaf: "OpenCode Zen/   ",
      badge: null,
    });
  });

  it("drops the GPT prefix from plain model names", () => {
    expect(splitProviderDisplayName("GPT 5.5")).toEqual({
      leaf: "5.5",
      badge: null,
    });
  });

  it("drops the GPT prefix from namespaced leaves", () => {
    expect(splitProviderDisplayName("OpenAI/GPT-5.6 Sol")).toEqual({
      leaf: "5.6 Sol",
      badge: "OpenAI",
    });
  });

  it("passes through empty string", () => {
    expect(splitProviderDisplayName("")).toEqual({
      leaf: "",
      badge: null,
    });
  });
});

describe("formatModelLeafName", () => {
  it("strips GPT- and title-cases variant words", () => {
    expect(formatModelLeafName("GPT-5.6 Sol")).toBe("5.6 Sol");
    expect(formatModelLeafName("gpt-5.6-sol")).toBe("5.6 Sol");
    expect(formatModelLeafName("gpt-5.4-mini")).toBe("5.4 Mini");
    expect(formatModelLeafName("GPT-5.5")).toBe("5.5");
  });

  /**
   * Title-casing applies per word regardless of separator. Skipping the pass
   * whenever a label already contained a space — which is how the date-suffix
   * shapes below were protected — is what put "4o mini" next to "Opus 5" in the
   * same picker.
   */
  it.each([
    ["GPT-4o mini", "4o Mini"],
    ["GPT-4.1 mini", "4.1 Mini"],
    ["GPT-4.1 nano", "4.1 Nano"],
    ["GPT-5.4 mini Fast", "5.4 Mini Fast"],
  ])("title-cases space-separated variant words: %s -> %s", (input, expected) => {
    expect(formatModelLeafName(input)).toBe(expected);
  });

  // Table-driven: the literal catalog `displayName` leaves for the
  // claude-<family>-5 bare-version ids (fable, sonnet), both the hyphenated
  // cursor form and the space-separated form, plus the pre-existing
  // major.minor and date-suffixed shapes.
  const CLAUDE_LEAF_CASES: Array<[input: string, expected: string]> = [
    ["Claude-Sonnet-5", "Sonnet 5"],
    ["Claude Sonnet 5", "Sonnet 5"],
    ["Claude-Fable-5", "Fable 5"],
    ["Claude Fable 5", "Fable 5"],
    ["Claude Opus 4.8", "Opus 4.8"],
    ["Claude Sonnet 4.5 (2025-09-29)", "Sonnet 4.5 (2025-09-29)"],
  ];

  it.each(CLAUDE_LEAF_CASES)(
    "strips the redundant vendor family word: %s -> %s",
    (input, expected) => {
      expect(formatModelLeafName(input)).toBe(expected);
    },
  );

  it("leaves names in other families untouched", () => {
    expect(formatModelLeafName("Sonnet 4.5")).toBe("Sonnet 4.5");
    expect(formatModelLeafName("grok-4.3")).toBe("grok-4.3");
    expect(formatModelLeafName("chatgpt-image-latest")).toBe("chatgpt-image-latest");
    // Regression: non-Anthropic, non-GPT families keep their family word.
    expect(formatModelLeafName("Gemini 2.5 Pro")).toBe("Gemini 2.5 Pro");
    expect(formatModelLeafName("GLM-5")).toBe("GLM-5");
  });
});

describe("splitProviderDisplayName with Claude family prefixes", () => {
  // Table-driven: the literal catalog `displayName` strings for
  // provider-namespaced Anthropic models, verifying the badge survives and
  // only the leaf's redundant family word is dropped.
  const PROVIDER_NAMESPACED_CASES: Array<[
    input: string,
    badge: string | null,
    leaf: string,
  ]> = [
    ["Anthropic/Claude Fable 5", "Anthropic", "Fable 5"],
    ["Anthropic/Claude Sonnet 5", "Anthropic", "Sonnet 5"],
    ["OpenCode Zen/Claude Fable 5", "OpenCode Zen", "Fable 5"],
    ["OpenCode Zen/Claude Sonnet 5", "OpenCode Zen", "Sonnet 5"],
    ["OpenCode Zen/Claude Sonnet 4", "OpenCode Zen", "Sonnet 4"],
  ];

  it.each(PROVIDER_NAMESPACED_CASES)(
    "splits %s -> badge %j, leaf %j",
    (input, badge, leaf) => {
      expect(splitProviderDisplayName(input)).toEqual({ leaf, badge });
    },
  );
});
