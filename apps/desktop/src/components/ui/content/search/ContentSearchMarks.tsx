import { Fragment, type ReactNode } from "react";
import {
  findContentSearchMatches,
  type ContentSearchTokenMatchSegment,
} from "@/lib/domain/content-search/content-search";

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

export function renderContentSearchMarkedToken({
  text,
  matchSegments,
  activeMatchId,
  matchIdPrefix,
}: {
  text: string;
  matchSegments: readonly ContentSearchTokenMatchSegment[];
  activeMatchId: string | null;
  matchIdPrefix: string;
}): ReactNode {
  if (matchSegments.length === 0) {
    return text;
  }

  const nodes: ReactNode[] = [];
  let cursor = 0;

  matchSegments.forEach((segment, index) => {
    if (segment.start > cursor) {
      nodes.push(
        <Fragment key={`text-${index}`}>
          {text.slice(cursor, segment.start)}
        </Fragment>,
      );
    }

    const matchId = `${matchIdPrefix}:${segment.matchIndex}`;
    nodes.push(
      <mark
        key={`${matchId}:${segment.start}:${segment.end}`}
        className={`codex-thread-find-match ${
          matchId === activeMatchId ? "codex-thread-find-active" : ""
        }`}
        data-content-search-match-id={matchId}
      >
        {text.slice(segment.start, segment.end)}
      </mark>,
    );
    cursor = segment.end;
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
