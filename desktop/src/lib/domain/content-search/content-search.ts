export interface ContentSearchTextToken {
  content: string;
}

export interface ContentSearchMatchRange {
  start: number;
  end: number;
}

export function normalizeContentSearchQuery(query: string): string {
  return query.trim();
}

export function findContentSearchMatches(
  text: string,
  query: string,
): ContentSearchMatchRange[] {
  const needle = normalizeContentSearchQuery(query);
  if (!needle) {
    return [];
  }

  const haystack = text.toLocaleLowerCase();
  const normalizedNeedle = needle.toLocaleLowerCase();
  const ranges: ContentSearchMatchRange[] = [];
  let searchFrom = 0;

  while (searchFrom <= haystack.length) {
    const start = haystack.indexOf(normalizedNeedle, searchFrom);
    if (start === -1) {
      break;
    }

    const end = start + normalizedNeedle.length;
    ranges.push({ start, end });
    searchFrom = end;
  }

  return ranges;
}

export function countContentSearchTokenMatches(
  tokens: readonly ContentSearchTextToken[],
  query: string,
): number {
  return tokens.reduce(
    (count, token) => count + findContentSearchMatches(token.content, query).length,
    0,
  );
}

export function buildContentSearchLineMatchIds({
  idPrefix,
  tokens,
  query,
}: {
  idPrefix: string;
  tokens: readonly ContentSearchTextToken[];
  query: string;
}): string[] {
  const ids: string[] = [];
  let matchIndex = 0;

  for (const token of tokens) {
    const ranges = findContentSearchMatches(token.content, query);
    for (let index = 0; index < ranges.length; index += 1) {
      ids.push(`${idPrefix}:${matchIndex}`);
      matchIndex += 1;
    }
  }

  return ids;
}
