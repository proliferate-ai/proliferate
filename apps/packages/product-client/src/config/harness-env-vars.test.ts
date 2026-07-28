import { describe, expect, it } from "vitest";
import { isValidEnvVarName } from "#product/lib/domain/settings/harness-auth-sources";
import {
  getHarnessEnvVarSuggestions,
  getProviderSecretEnvVar,
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

  it("suggests cursor's own account-key slot (CURSOR_API_KEY)", () => {
    expect(getHarnessEnvVarSuggestions("cursor")).toEqual([
      { envVarName: "CURSOR_API_KEY", providerHint: "cursor" },
    ]);
  });

  it("returns nothing for an unknown harness", () => {
    expect(getHarnessEnvVarSuggestions("mystery-harness")).toEqual([]);
  });
});

describe("getProviderSecretEnvVar", () => {
  function registryEntry(id: string) {
    const entry = PROVIDER_REGISTRY.find((provider) => provider.id === id);
    expect(entry, `registry is missing ${id}`).toBeDefined();
    return entry!;
  }

  it("takes the single key-shaped env var for a one-field provider", () => {
    expect(getProviderSecretEnvVar(registryEntry("anthropic"))).toBe(
      "ANTHROPIC_API_KEY",
    );
    expect(getProviderSecretEnvVar(registryEntry("openrouter"))).toBe(
      "OPENROUTER_API_KEY",
    );
  });

  it("skips a multi-field provider's non-secret leading env var", () => {
    // envVarNames[0] is AZURE_RESOURCE_NAME / AWS_ACCESS_KEY_ID — pasting an
    // API key into either writes the secret to the wrong variable.
    expect(getProviderSecretEnvVar(registryEntry("azure"))).toBe("AZURE_API_KEY");
    expect(getProviderSecretEnvVar(registryEntry("amazon-bedrock"))).toBe(
      "AWS_SECRET_ACCESS_KEY",
    );
  });

  it("rejects an env var the server would never accept", () => {
    // "302AI_API_KEY" leads with a digit: ENV_VAR_NAME_RE rejects it, so a save
    // would create a vault key and then 400.
    const provider = registryEntry("302ai");
    expect(provider.envVarNames.some((name) => !isValidEnvVarName(name))).toBe(true);
    expect(getProviderSecretEnvVar(provider)).toBeNull();
  });

  it("returns null when no env var holds a single secret (typed-config path)", () => {
    // google-vertex is project + location + a credentials FILE path.
    expect(getProviderSecretEnvVar(registryEntry("google-vertex"))).toBeNull();
  });

  it("never returns an invalid name for any registry provider", () => {
    for (const provider of PROVIDER_REGISTRY) {
      const envVarName = getProviderSecretEnvVar(provider);
      if (envVarName !== null) {
        expect(isValidEnvVarName(envVarName)).toBe(true);
      }
    }
  });
});
