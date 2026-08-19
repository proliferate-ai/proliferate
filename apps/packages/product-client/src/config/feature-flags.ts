// Build-time product feature flags. Each flag defaults OFF and is turned on by
// a `VITE_*` env value of "1"/"true" at build time. Tests set an in-memory
// override via `setFeatureFlagOverrideForTests` rather than mutating env.
//
// The flags themselves are static per build (env is read once), so there is no
// runtime toggle surface and no store — a component reads `isFeatureEnabled`
// directly. When a flag graduates, delete its entry here and the branch that
// reads it.

export interface FeatureFlags {
  /**
   * ADR agent-auth rung 6: render the harness auth panes from the runtime's
   * derived `authState` (evidence-backed badge, next-action lead, visibility
   * preferences) instead of the legacy locally-derived badge. OFF leaves the
   * current panes untouched.
   */
  agentAuthEvidencePanes: boolean;
  /**
   * Workflows follow-up rung 8: offer the workspace's workflow-run context
   * docs as a second candidate source in the composer's `@` mention menu. OFF
   * leaves the menu file-only; the chip node and its serialization stay
   * registered either way so an existing draft containing a context-doc
   * mention still round-trips.
   */
  chatContextDocMentions: boolean;
}

function readEnvFlag(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

const DEFAULT_FLAGS: FeatureFlags = {
  agentAuthEvidencePanes: readEnvFlag(
    import.meta.env.VITE_AGENT_AUTH_EVIDENCE_PANES,
  ),
  chatContextDocMentions: readEnvFlag(
    import.meta.env.VITE_CHAT_CONTEXT_DOC_MENTIONS,
  ),
};

const overrides: Partial<FeatureFlags> = {};

export function isFeatureEnabled(flag: keyof FeatureFlags): boolean {
  return overrides[flag] ?? DEFAULT_FLAGS[flag];
}

export function setFeatureFlagOverrideForTests(
  flag: keyof FeatureFlags,
  value: boolean,
): void {
  overrides[flag] = value;
}

export function resetFeatureFlagOverridesForTests(): void {
  for (const key of Object.keys(overrides) as (keyof FeatureFlags)[]) {
    delete overrides[key];
  }
}
