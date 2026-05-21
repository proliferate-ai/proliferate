export interface ContentSearchTextToken {
  content: string;
}

export interface ContentSearchMatchRange {
  start: number;
  end: number;
}

export interface ContentSearchTokenMatchSegment {
  tokenIndex: number;
  start: number;
  end: number;
  matchIndex: number;
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
  return findContentSearchMatches(concatTokenText(tokens), query).length;
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
  return findContentSearchMatches(concatTokenText(tokens), query).map(
    (_range, matchIndex) => `${idPrefix}:${matchIndex}`,
  );
}

export function findContentSearchTokenMatchSegments(
  tokens: readonly ContentSearchTextToken[],
  query: string,
): ContentSearchTokenMatchSegment[][] {
  const tokenOffsets = buildTokenOffsets(tokens);
  const matches = findContentSearchMatches(
    tokenOffsets.map((token) => token.content).join(""),
    query,
  );
  const segmentsByToken = tokens.map(() => [] as ContentSearchTokenMatchSegment[]);

  matches.forEach((match, matchIndex) => {
    tokenOffsets.forEach((token) => {
      const start = Math.max(match.start, token.start);
      const end = Math.min(match.end, token.end);
      if (start >= end) {
        return;
      }

      segmentsByToken[token.index].push({
        tokenIndex: token.index,
        start: start - token.start,
        end: end - token.start,
        matchIndex,
      });
    });
  });

  return segmentsByToken;
}

function concatTokenText(tokens: readonly ContentSearchTextToken[]): string {
  return tokens.map((token) => token.content).join("");
}

function buildTokenOffsets(tokens: readonly ContentSearchTextToken[]): Array<{
  index: number;
  content: string;
  start: number;
  end: number;
}> {
  let cursor = 0;
  return tokens.map((token, index) => {
    const start = cursor;
    const end = start + token.content.length;
    cursor = end;
    return {
      index,
      content: token.content,
      start,
      end,
    };
  });
}
