/**
 * Pure resolution of a saved model id against the current known ids. Live
 * callers use this compatibility path so a stored preference can land on an
 * equivalent known id instead of silently falling back to the default model.
 *
 * Resolution order after trimming: exact known id, alias to a known id, then
 * repeatedly remove the final `/segment` and retry exact followed by alias;
 * return null when no candidate resolves.
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
