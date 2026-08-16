// Known per-harness env-var suggestions (contract §6). UI-only prefill data
// for the "Add variable" row in each harness's auth pane — it has zero
// bearing on server-side validation (server/proliferate/server/cloud/
// agent_gateway/selection_rules.py is the actual source of truth there).
import { isValidEnvVarName } from "../lib/domain/settings/harness-auth-sources";
import providerRegistry from "./provider-registry.generated.json";
import providerDocOverlay from "./provider-doc-overlay.json";

export interface ProviderRegistryEntry {
  id: string;
  displayName: string;
  envVarNames: readonly string[];
  npm?: string;
  // Featured-tier documentation/console links (PRO-206). The vendored registry
  // carries no upstream doc URLs, so these come from the hand-curated
  // provider-doc-overlay.json, merged in as data below. Carried as data only
  // today; a later rung renders them.
  docsUrl?: string;
  consoleUrl?: string;
}

interface ProviderDocOverlayEntry {
  docsUrl?: string;
  consoleUrl?: string;
}

const PROVIDER_DOC_OVERLAY: Readonly<Record<string, ProviderDocOverlayEntry>> =
  (providerDocOverlay as { providers?: Record<string, ProviderDocOverlayEntry> }).providers ?? {};

// Re-exported so callers (e.g. the OpenCode "Add provider" modal) don't need
// to import the generated JSON path directly. Refresh the vendored half via
// scripts/vendor-provider-registry.mjs; the doc-URL overlay is hand-maintained
// in provider-doc-overlay.json and merged here by provider id.
export const PROVIDER_REGISTRY: readonly ProviderRegistryEntry[] = (
  providerRegistry as ProviderRegistryEntry[]
).map((entry) => {
  const overlay = PROVIDER_DOC_OVERLAY[entry.id];
  return overlay ? { ...entry, ...overlay } : entry;
});

// Which of a provider's env vars actually holds the secret. Registry order is
// arbitrary and multi-field providers lead with a NON-secret (azure ->
// AZURE_RESOURCE_NAME, amazon-bedrock -> AWS_ACCESS_KEY_ID, google-vertex ->
// GOOGLE_VERTEX_PROJECT), so blindly taking envVarNames[0] would write a pasted
// API key into a resource-name/project variable. Key-shaped names are the ones
// whose suffix names a credential: _API_KEY / _KEY / _TOKEN (covers
// _AUTH_TOKEN, _BEARER_TOKEN) / _PAT.
const KEY_SHAPED_ENV_VAR_RE = /(_API_KEY|_KEY|_TOKEN|_PAT)$/;

/**
 * The env var a single pasted secret belongs in for this provider, or null when
 * the provider has none that is BOTH server-valid (ENV_VAR_NAME_RE — e.g.
 * "302AI_API_KEY" starts with a digit and always 400s) and key-shaped. A null
 * result means the provider cannot be expressed as one api_key selection at all
 * (google-vertex is service-account JSON + project/location): it belongs to the
 * typed provider-config path (agent-auth.md §4), not the single-secret picker.
 */
export function getProviderSecretEnvVar(provider: {
  envVarNames: readonly string[];
}): string | null {
  return (
    provider.envVarNames.find(
      (envVarName) =>
        isValidEnvVarName(envVarName) && KEY_SHAPED_ENV_VAR_RE.test(envVarName),
    ) ?? null
  );
}

/**
 * Human label for a bound API key ("Anthropic API key"). Env-var names are
 * internal wiring and never user-facing: rows and modals describe the key by
 * the provider it belongs to, resolved from the provider hint or — for
 * hand-typed/legacy rows — by matching the env var against the registry.
 */
export function getApiKeyBindingLabel(
  envVarName: string,
  providerHint: string | null | undefined,
): string {
  const byHint = providerHint
    ? PROVIDER_REGISTRY.find((provider) => provider.id === providerHint)
    : undefined;
  const byEnvVar = byHint
    ?? PROVIDER_REGISTRY.find((provider) => provider.envVarNames.includes(envVarName));
  if (byEnvVar) return `${byEnvVar.displayName} API key`;
  // Cursor's account key has no registry entry.
  if (providerHint === "cursor" || envVarName === "CURSOR_API_KEY") {
    return "Cursor API key";
  }
  return "API key";
}

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
  // Cursor's only auth slot (catalog registry.json auth.slots[0].envVars) — an
  // account key, not a provider key, so it has no fallback registry entry.
  cursor: [{ envVarName: "CURSOR_API_KEY", providerHint: "cursor" }],
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
