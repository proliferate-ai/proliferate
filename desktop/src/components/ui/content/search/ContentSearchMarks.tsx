import { Fragment, type ReactNode } from "react";
import { findContentSearchMatches } from "@/lib/domain/content-search/content-search";

export function renderContentSearchMarkedText({
  text,
  query,
  activeMatchId,
  nextMatchId,
}: {
  text: string;
  query: string;
  activeMatchId: string | null;
  nextMatchId: () => string;
}): ReactNode {
  const ranges = findContentSearchMatches(text, query);
  if (ranges.length === 0) {
    return text;
  }

  const nodes: ReactNode[] = [];
  let cursor = 0;

  ranges.forEach((range, index) => {
    if (range.start > cursor) {
      nodes.push(
        <Fragment key={`text-${index}`}>
          {text.slice(cursor, range.start)}
        </Fragment>,
      );
    }

    const matchId = nextMatchId();
    nodes.push(
      <mark
        key={matchId}
        className={`codex-thread-find-match ${
          matchId === activeMatchId ? "codex-thread-find-active" : ""
        }`}
        data-content-search-match-id={matchId}
      >
        {text.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  });

  if (cursor < text.length) {
    nodes.push(
      <Fragment key="text-tail">
        {text.slice(cursor)}
      </Fragment>,
    );
  }

  return nodes;
}
