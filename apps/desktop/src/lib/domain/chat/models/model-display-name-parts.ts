/**
 * Splits a provider-namespaced display name (e.g. "OpenCode Zen/Claude Sonnet 4")
 * into a leaf model name and an optional provider badge.
 *
 * Rules:
 * - Splits on the FIRST "/" only.
 * - Both sides are trimmed; if either side is empty after trimming, the full
 *   original name is returned as-is (no badge).
 * - Names without "/" pass through unchanged.
 *
 * This is a pure presentation helper — it never mutates catalog identity or modelId.
 */
export interface DisplayNameParts {
  /** The model name to show as the primary label. */
  leaf: string;
  /** The provider namespace badge text, or null when no split applies. */
  badge: string | null;
}

export function splitProviderDisplayName(displayName: string): DisplayNameParts {
  const slashIdx = displayName.indexOf("/");
  if (slashIdx === -1) {
    return { leaf: displayName, badge: null };
  }

  const prefix = displayName.slice(0, slashIdx).trim();
  const suffix = displayName.slice(slashIdx + 1).trim();

  if (!prefix || !suffix) {
    return { leaf: displayName, badge: null };
  }

  return { leaf: suffix, badge: prefix };
}
