import type { DiffLine } from "@/lib/domain/files/diff-parser";
import type { HighlightedToken } from "@/lib/infra/editor/highlighting";
import { renderContentSearchMarkedText } from "@/components/ui/content/search/ContentSearchMarks";

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
  let contentSearchMatchIndex = 0;

  if (lineTokens) {
    return (
      <>
        {lineTokens.map((token, index) => (
          <span key={index} style={token.color ? { color: token.color } : undefined}>
            {contentSearchLineId
              ? renderContentSearchMarkedText({
                  text: token.content,
                  query: contentSearchQuery,
                  activeMatchId,
                  nextMatchId: () => {
                    const matchId = `${contentSearchLineId}:${contentSearchMatchIndex}`;
                    contentSearchMatchIndex += 1;
                    return matchId;
                  },
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
        nextMatchId: () => {
          const matchId = `${contentSearchLineId}:${contentSearchMatchIndex}`;
          contentSearchMatchIndex += 1;
          return matchId;
        },
      })}
    </>
  );
}
