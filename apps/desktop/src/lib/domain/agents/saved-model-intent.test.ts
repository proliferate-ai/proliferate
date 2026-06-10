import { describe, expect, it } from "vitest";
import { resolveSavedModelId } from "./saved-model-intent";

const KNOWN_IDS = ["opus-4-8", "sonnet-4-5", "gpt-5.2-codex", "openai/gpt-5.2"];

describe("resolveSavedModelId", () => {
  it("returns an exact match", () => {
    expect(resolveSavedModelId("opus-4-8", KNOWN_IDS, {})).toBe("opus-4-8");
  });

  it("prefers exact match over an alias entry", () => {
    expect(
      resolveSavedModelId("opus-4-8", KNOWN_IDS, { "opus-4-8": "sonnet-4-5" }),
    ).toBe("opus-4-8");
  });

  it("resolves through an alias to a known id", () => {
    expect(
      resolveSavedModelId("claude-opus-4-8", KNOWN_IDS, { "claude-opus-4-8": "opus-4-8" }),
    ).toBe("opus-4-8");
  });

  it("ignores aliases that point outside the known ids", () => {
    expect(
      resolveSavedModelId("legacy", KNOWN_IDS, { legacy: "retired-model" }),
    ).toBeNull();
  });

  it("strips a trailing variant suffix when the base id is known", () => {
    expect(resolveSavedModelId("gpt-5.2-codex/low", KNOWN_IDS, {})).toBe("gpt-5.2-codex");
  });

  it("strips variant suffixes segment by segment", () => {
    expect(resolveSavedModelId("openai/gpt-5.2/high", KNOWN_IDS, {})).toBe("openai/gpt-5.2");
  });

  it("resolves a stripped base through aliases", () => {
    expect(
      resolveSavedModelId("o5/medium", KNOWN_IDS, { o5: "gpt-5.2-codex" }),
    ).toBe("gpt-5.2-codex");
  });

  it("returns null when nothing matches", () => {
    expect(resolveSavedModelId("unknown-model", KNOWN_IDS, {})).toBeNull();
  });

  it("returns null for empty or whitespace input", () => {
    expect(resolveSavedModelId("", KNOWN_IDS, {})).toBeNull();
    expect(resolveSavedModelId("   ", KNOWN_IDS, {})).toBeNull();
  });

  it("trims the saved id before matching", () => {
    expect(resolveSavedModelId("  sonnet-4-5  ", KNOWN_IDS, {})).toBe("sonnet-4-5");
  });

  it("does not strip past a leading slash", () => {
    expect(resolveSavedModelId("/low", KNOWN_IDS, {})).toBeNull();
  });
});
