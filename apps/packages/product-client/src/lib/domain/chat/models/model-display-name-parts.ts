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
    return { leaf: formatModelLeafName(displayName), badge: null };
  }

  const prefix = displayName.slice(0, slashIdx).trim();
  const suffix = displayName.slice(slashIdx + 1).trim();

  if (!prefix || !suffix) {
    return { leaf: formatModelLeafName(displayName), badge: null };
  }

  return { leaf: formatModelLeafName(suffix), badge: prefix };
}

/**
 * Drops the redundant vendor-family prefix from a model name and title-cases
 * the variant suffix: "GPT-5.6 Sol" / "gpt-5.6-sol" → "5.6 Sol", and
 * "Claude-Sonnet-5" / "Claude Sonnet 5" → "Sonnet 5". The provider icon on the
 * pill already carries the family identity, so the prefix is noise. Names in
 * other families pass through unchanged. Display-only — never touches catalog
 * identity or modelId.
 */
const REDUNDANT_FAMILY_PREFIX = /^(?:gpt|claude)[-\s]+(.+)$/i;

export function formatModelLeafName(name: string): string {
  const match = REDUNDANT_FAMILY_PREFIX.exec(name.trim());
  if (!match) {
    return name;
  }

  const remainder = match[1]!.trim();
  // Hyphens are word separators only in an all-hyphen remainder. Once a label
  // already contains spaces, its hyphens are meaningful punctuation — a date
  // suffix like "(2025-09-29)" must survive intact rather than becoming
  // "(2025 09 29)".
  const separator = /\s/.test(remainder) ? /\s+/ : "-";

  // Title-casing runs either way. Splitting on spaces and then returning the
  // pieces unchanged is what produced "4o mini" beside "Opus 5": the casing
  // pass has to apply per word, not only to hyphen-separated names.
  return remainder
    .split(separator)
    .filter(Boolean)
    .map((part) =>
      /^[a-z]/.test(part) ? part.charAt(0).toUpperCase() + part.slice(1) : part
    )
    .join(" ");
}
