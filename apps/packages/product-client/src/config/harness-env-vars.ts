// Known per-harness env-var suggestions (contract §6). UI-only prefill data
// for the "Add variable" row in each harness's auth pane — it has zero
// bearing on server-side validation (server/proliferate/server/cloud/
// agent_gateway/selection_rules.py is the actual source of truth there).
import { isValidEnvVarName } from "../lib/domain/settings/harness-auth-sources";
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
  // OpenCode fronts every provider in the vendored registry, but its own
  // catalog auth contexts (catalogs/agents/catalog.json -> opencode.authContexts)
  // list anthropic-api / ANTHROPIC_API_KEY first as the canonical default, so
  // lead with that rather than the first registry entry — which is ordered
  // arbitrarily and can be an env-var name that's invalid on arrival (e.g.
  // "302AI_API_KEY" starts with a digit and never passes ENV_VAR_NAME_RE).
  opencode: [{ envVarName: "ANTHROPIC_API_KEY", providerHint: "anthropic" }],
};

// Fallback suggestions derived from the vendored provider registry, used once
// the harness-specific defaults above are exhausted (e.g. opencode after its
// first row is taken). Suggestions whose env-var name would never pass
// server-side validation are filtered out so a bad suggestion never surfaces.
const REGISTRY_ENV_VAR_SUGGESTIONS: readonly HarnessEnvVarSuggestion[] = PROVIDER_REGISTRY.flatMap(
  (provider) =>
    provider.envVarNames
      .filter((envVarName) => isValidEnvVarName(envVarName))
      .map((envVarName) => ({
        envVarName,
        providerHint: provider.id,
      })),
);

export function getHarnessEnvVarSuggestions(harnessKind: string): readonly HarnessEnvVarSuggestion[] {
  const staticSuggestions = STATIC_HARNESS_ENV_VARS[harnessKind] ?? [];
  if (harnessKind === "opencode") {
    return [...staticSuggestions, ...REGISTRY_ENV_VAR_SUGGESTIONS];
  }
  return staticSuggestions;
}
