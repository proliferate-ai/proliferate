import type { DiffLine } from "@/lib/domain/files/diff-parser";
import type { HighlightedToken } from "@/lib/infra/editor/highlighting";
import {
  renderContentSearchMarkedText,
  renderContentSearchMarkedToken,
} from "@/components/ui/content/search/ContentSearchMarks";
import { findContentSearchTokenMatchSegments } from "@/lib/domain/content-search/content-search";

export function DiffLineContent({
  line,
  tokens,
  contentSearchQuery = "",
  activeMatchId = null,
  contentSearchLineId = null,
}: {
  line: DiffLine;
  tokens: HighlightedToken[][] | null;
  contentSearchQuery?: string;
  activeMatchId?: string | null;
  contentSearchLineId?: string | null;
}) {
  const lineTokens = tokens?.[line.tokenIndex];

  if (lineTokens) {
    const matchSegmentsByToken = contentSearchLineId
      ? findContentSearchTokenMatchSegments(lineTokens, contentSearchQuery)
      : [];

    return (
      <>
        {lineTokens.map((token, index) => (
          <span key={index} style={token.color ? { color: token.color } : undefined}>
            {contentSearchLineId
              ? renderContentSearchMarkedToken({
                  text: token.content,
                  matchSegments: matchSegmentsByToken[index] ?? [],
                  activeMatchId,
                  matchIdPrefix: contentSearchLineId,
                })
              : token.content}
          </span>
        ))}
      </>
    );
  }

  if (!contentSearchLineId) {
    return <>{line.content || " "}</>;
  }

  return (
    <>
      {renderContentSearchMarkedText({
        text: line.content || " ",
        query: contentSearchQuery,
        activeMatchId,
        nextMatchId: createContentSearchMatchIdFactory(contentSearchLineId),
      })}
    </>
  );
}

function createContentSearchMatchIdFactory(matchIdPrefix: string): () => string {
  let matchIndex = 0;
  return () => {
    const matchId = `${matchIdPrefix}:${matchIndex}`;
    matchIndex += 1;
    return matchId;
  };
}
