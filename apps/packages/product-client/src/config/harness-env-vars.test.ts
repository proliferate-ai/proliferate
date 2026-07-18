import { describe, expect, it } from "vitest";
import { isValidEnvVarName } from "#product/lib/domain/settings/harness-auth-sources";
import {
  getHarnessEnvVarSuggestions,
  PROVIDER_REGISTRY,
} from "#product/config/harness-env-vars";

describe("getHarnessEnvVarSuggestions", () => {
  it("suggests a valid, anthropic-hinted env var for opencode first", () => {
    const suggestions = getHarnessEnvVarSuggestions("opencode");
    expect(suggestions.length).toBeGreaterThan(0);
    const [first] = suggestions;
    expect(isValidEnvVarName(first.envVarName)).toBe(true);
    expect(first.envVarName).toBe("ANTHROPIC_API_KEY");
    expect(first.providerHint).toBe("anthropic");
  });

  it("never surfaces a suggestion whose env-var name fails validation, even in the registry fallback", () => {
    // Sanity-check the fixture actually contains an invalid-looking entry
    // (e.g. a provider id starting with a digit) so this test would catch a
    // regression rather than vacuously passing.
    const hasInvalidRegistryEntry = PROVIDER_REGISTRY.some((provider) =>
      provider.envVarNames.some((name) => !isValidEnvVarName(name)),
    );
    expect(hasInvalidRegistryEntry).toBe(true);

    const suggestions = getHarnessEnvVarSuggestions("opencode");
    for (const suggestion of suggestions) {
      expect(isValidEnvVarName(suggestion.envVarName)).toBe(true);
    }
  });

  it("keeps the other harnesses' hardcoded single suggestion", () => {
    expect(getHarnessEnvVarSuggestions("claude")).toEqual([
      { envVarName: "ANTHROPIC_API_KEY", providerHint: "anthropic" },
    ]);
    expect(getHarnessEnvVarSuggestions("codex")).toEqual([
      { envVarName: "OPENAI_API_KEY", providerHint: "openai" },
    ]);
    expect(getHarnessEnvVarSuggestions("grok")).toEqual([
      { envVarName: "XAI_API_KEY", providerHint: "xai" },
    ]);
  });

  it("returns nothing for an unknown harness", () => {
    expect(getHarnessEnvVarSuggestions("cursor")).toEqual([]);
  });
});
