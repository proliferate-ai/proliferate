/**
 * Pure resolution of a saved model id against a known id set — groundwork for
 * the v2 catalog ids (specs/tbd/agents-catalog-registry-migration.md): when
 * the catalog re-keys, a stored preference must land on the equivalent known
 * id instead of silently falling back to the default model.
 *
 * Resolution order: exact match > alias match > prefix-normalized match
 * (trailing variant suffixes such as "/low" stripped while the base resolves)
 * > null. Existing call sites are NOT rewired yet; this is consumed when the
 * v2 ids land.
 */
export function resolveSavedModelId(
  saved: string,
  knownIds: readonly string[],
  aliases: Record<string, string>,
): string | null {
  const known = new Set(knownIds);

  let candidate = saved.trim();
  while (candidate) {
    if (known.has(candidate)) {
      return candidate;
    }

    const aliased = aliases[candidate]?.trim();
    if (aliased && known.has(aliased)) {
      return aliased;
    }

    const separatorIndex = candidate.lastIndexOf("/");
    if (separatorIndex <= 0) {
      return null;
    }
    candidate = candidate.slice(0, separatorIndex);
  }

  return null;
}
