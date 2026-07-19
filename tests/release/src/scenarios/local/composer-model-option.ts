const CLAUDE_HAIKU_45_MODEL = /^(?:anthropic\/)?claude-haiku-4-5(?:-\d{8})?$/;

/**
 * Resolves a canonical qualification model id to the exact option id exposed
 * by the live composer. Exact ids always win. The only alias relationship
 * encoded here is Claude Haiku 4.5, whose agent-facing selector id is `haiku`;
 * other Claude family aliases are version-ambiguous and therefore fail closed.
 */
export function resolveVisibleComposerModelOptionId(
  requestedModelId: string,
  visibleModelIds: readonly string[],
): string | null {
  const exactMatches = visibleModelIds.filter((modelId) => modelId === requestedModelId).length;
  if (exactMatches > 0) {
    return exactMatches === 1 ? requestedModelId : null;
  }

  const alias = CLAUDE_HAIKU_45_MODEL.test(requestedModelId) ? "haiku" : null;
  if (!alias) {
    return null;
  }
  return visibleModelIds.filter((modelId) => modelId === alias).length === 1 ? alias : null;
}

export function composerModelSelectionMatches(
  requestedModelId: string,
  selectedModelId: string | null,
): boolean {
  return selectedModelId !== null
    && resolveVisibleComposerModelOptionId(requestedModelId, [selectedModelId]) === selectedModelId;
}

export async function waitForComposerModelSelection(
  readSelectedModelId: () => Promise<string | null>,
  requestedModelId: string,
  timeoutMs: number,
  pollMs = 100,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastSelectedModelId: string | null = null;
  do {
    lastSelectedModelId = await readSelectedModelId();
    if (
      lastSelectedModelId !== null
      && composerModelSelectionMatches(requestedModelId, lastSelectedModelId)
    ) {
      return lastSelectedModelId;
    }
    await sleep(pollMs);
  } while (Date.now() < deadline);

  throw new Error(
    `composer did not reflect model "${requestedModelId}" within ${timeoutMs}ms `
      + `(last selected option: "${lastSelectedModelId ?? ""}")`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
