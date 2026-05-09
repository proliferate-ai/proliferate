import type { DiffLine } from "@/lib/domain/files/diff-parser";
import type { HighlightedToken } from "@/lib/infra/editor/highlighting";

export function DiffLineContent({
  line,
  tokens,
}: {
  line: DiffLine;
  tokens: HighlightedToken[][] | null;
}) {
  const lineTokens = tokens?.[line.tokenIndex];

  if (lineTokens) {
    return (
      <>
        {lineTokens.map((token, index) => (
          <span key={index} style={token.color ? { color: token.color } : undefined}>
            {token.content}
          </span>
        ))}
      </>
    );
  }

  return <>{line.content || " "}</>;
}
