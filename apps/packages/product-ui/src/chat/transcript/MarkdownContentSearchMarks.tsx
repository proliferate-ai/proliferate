import { Fragment, type ReactNode } from "react";

/**
 * Wraps content-search query matches inside a markdown text node with
 * `<mark class="codex-thread-find-match">` (the same class the diff/file
 * highlighters use, so styling is shared). Marks carry only the row unit id —
 * no per-match id — because the active match is resolved by DOM ordinal at
 * jump time, not encoded at render (see the desktop jump-to-match effect).
 *
 * Only direct string children are decorated. Matches that span nested inline
 * formatting (bold/italic/inline-code/links) are left unpainted — an accepted
 * v1 edge; the data-level index still counts them.
 */
export function markSearchChildren(
  children: ReactNode,
  query: string,
  rowUnitId: string,
): ReactNode {
  if (typeof children === "string") {
    return markString(children, query, rowUnitId);
  }
  if (Array.isArray(children)) {
    return children.map((child, index) =>
      typeof child === "string" ? (
        <Fragment key={index}>{markString(child, query, rowUnitId)}</Fragment>
      ) : (
        child
      )
    );
  }
  return children;
}

function markString(text: string, query: string, rowUnitId: string): ReactNode {
  const ranges = findMatchRanges(text, query);
  if (ranges.length === 0) {
    return text;
  }

  const nodes: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start > cursor) {
      nodes.push(
        <Fragment key={`t-${index}`}>{text.slice(cursor, range.start)}</Fragment>,
      );
    }
    nodes.push(
      <mark
        key={`m-${index}`}
        className="codex-thread-find-match"
        data-content-search-row={rowUnitId}
      >
        {text.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  });
  if (cursor < text.length) {
    nodes.push(<Fragment key="t-tail">{text.slice(cursor)}</Fragment>);
  }
  return nodes;
}

interface MatchRange {
  start: number;
  end: number;
}

function findMatchRanges(text: string, query: string): MatchRange[] {
  const needle = query.toLocaleLowerCase();
  if (!needle) {
    return [];
  }
  const haystack = text.toLocaleLowerCase();
  const ranges: MatchRange[] = [];
  let from = 0;
  while (from <= haystack.length) {
    const start = haystack.indexOf(needle, from);
    if (start === -1) {
      break;
    }
    const end = start + needle.length;
    ranges.push({ start, end });
    from = end;
  }
  return ranges;
}
