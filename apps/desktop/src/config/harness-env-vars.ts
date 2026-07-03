// Known per-harness env-var suggestions (contract §6). UI-only prefill data
// for the "Add variable" row in each harness's auth pane — it has zero
// bearing on server-side validation (server/proliferate/server/cloud/
// agent_gateway/selection_rules.py is the actual source of truth there).
import providerRegistry from "./provider-registry.generated.json";

export interface ProviderRegistryEntry {
  id: string;
  displayName: string;
  envVarNames: readonly string[];
  npm?: string;
}

// Re-exported so callers (e.g. the OpenCode "Add provider" modal) don't need
// to import the generated JSON path directly. Refresh via
// scripts/vendor-provider-registry.mjs.
export const PROVIDER_REGISTRY: readonly ProviderRegistryEntry[] = providerRegistry;

export interface HarnessEnvVarSuggestion {
  envVarName: string;
  // Display-only; mirrors agent_auth_selection.provider_hint. Never sent to
  // the runtime — see contract §3.
  providerHint?: string;
}

const STATIC_HARNESS_ENV_VARS: Readonly<Record<string, readonly HarnessEnvVarSuggestion[]>> = {
  claude: [{ envVarName: "ANTHROPIC_API_KEY", providerHint: "anthropic" }],
  codex: [{ envVarName: "OPENAI_API_KEY", providerHint: "openai" }],
  grok: [{ envVarName: "XAI_API_KEY", providerHint: "xai" }],
};

// OpenCode has no single known key: it fronts every provider in the vendored
// registry, so its suggestions are derived rather than hardcoded.
const OPENCODE_ENV_VAR_SUGGESTIONS: readonly HarnessEnvVarSuggestion[] = PROVIDER_REGISTRY.flatMap(
  (provider) =>
    provider.envVarNames.map((envVarName) => ({
      envVarName,
      providerHint: provider.id,
    })),
);

export function getHarnessEnvVarSuggestions(harnessKind: string): readonly HarnessEnvVarSuggestion[] {
  if (harnessKind === "opencode") {
    return OPENCODE_ENV_VAR_SUGGESTIONS;
  }
  return STATIC_HARNESS_ENV_VARS[harnessKind] ?? [];
}
