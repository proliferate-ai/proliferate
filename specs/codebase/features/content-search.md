# Content Search (Cmd+F)

Read this doc when a change touches in-app find (Cmd+F) on the chat transcript
or the file viewer: match counting, highlighting, jump-to-match, the shared
overlay, or the content-search store.

## Surfaces

One store (`apps/desktop/src/stores/search/content-search-store.ts`) and one
overlay (`SessionContentSearchOverlay`) drive two surfaces:

- **chat** — the transcript. Searches conversation prose (user + assistant
  messages) plus inline diffs rendered in tool calls.
- **file** — the file viewer. Searches the open file's source / diff.

`surface` alone gates which units are visible; there is no separate "scope".
The shortcut (`workspace.find-content`) resolves the surface from the focused
zone and calls `openSearch(surface)`. Placeholder/aria: "Search chat…" /
"Find in chat" and "Search file…" / "Find in file". The overlay pill is shared;
the only per-surface difference is vertical offset (file sits below the viewer
toolbar).

## Store model

`registerUnit({ unitId, surface, query, matchIds, orderKey? })` records a unit
(a diff instance, a file source view, or one transcript row). Visible matches =
the flattened `matchIds` of units whose `surface` and normalized `query` match
the active search, ordered by `orderKey` ascending. Units without an `orderKey`
(e.g. inline diffs that can't cheaply learn their transcript row index) sort
after all keyed units, in registration order. `activeMatchId` walks that
flattened list.

## Chat: index / paint split

The chat surface separates **counting** from **highlighting** because most
transcript rows are unmounted (virtualized), so the DOM cannot be the source of
truth.

- **Index (data — authoritative).**
  `apps/desktop/src/hooks/chat/search/use-chat-transcript-content-search.ts`
  rebuilds the transcript row model and, per row, extracts searchable prose via
  `apps/desktop/src/lib/domain/content-search/transcript-search-text.ts`
  (`extractTranscriptRowProseSegments` → markdown-stripped assistant prose +
  plain user text). It registers one store unit per matching row:
  `unitId = "chatrow:" + rowKey`, `matchIds = [unitId + ":" + i]`,
  `orderKey = rowIndex * 2`. This yields exact counts regardless of
  virtualization and is entirely inert unless chat search is open with a
  non-empty query. Per-row extraction is memoized on row identity (a `WeakMap`),
  and the query is behind `useDeferredValue`, so streaming updates only recompute
  changed rows.

- **Paint (React, context-gated).** `ChatTranscriptView` receives a
  `contentSearch={{ query }}` prop and publishes it through
  `ChatContentSearchQueryContext`; each transcript row publishes its unit id +
  index through `ChatTranscriptRowContext` (see
  `apps/packages/product-ui/src/chat/transcript/ChatContentSearchContext.tsx`).
  `MarkdownBody` (assistant prose, opted in via `enableContentSearch`) and the
  desktop `FileLinkedText` (user prose) wrap query matches in
  `<mark class="codex-thread-find-match" data-content-search-row={rowUnitId}>` —
  no per-match id at render time. Everything is inert when the query context is
  null; secondary chrome (tool detail bodies, plan cards) reuses `MarkdownBody`
  without `enableContentSearch` and shadows the query context to null so its
  text is never highlighted and never indexed.

- **Jump-to-match.** When `activeMatchId` is a `chatrow:` id, `MessageList`
  parses the row key + ordinal
  (`apps/desktop/src/lib/domain/content-search/chat-row-match-jump.ts`), calls
  the `ChatTranscriptView` imperative `scrollToRowKey` handle to bring an
  off-screen row into view, then runs a bounded rAF retry loop that selects the
  ordinal-th `mark[data-content-search-row=...]` in document order, marks it
  active, and scrolls it into view. If fewer marks are painted than the index
  counted, the ordinal clamps to the last painted mark (a benign
  extraction/render mismatch); the row is still scrolled into view.

Inline diffs inside a transcript row register through `ChatDiffViewer` with
`orderKey = rowIndex * 2 + 1` (read from the row context) so a row's diff
matches interleave just after its prose. Diff/file marks keep their existing
React-rendered `data-content-search-match-id` marks and active class — the
overlay's own scroll effect still handles them.

## Virtualization handling

- The imperative `scrollToRowKey` handle lives on both list implementations
  (`VirtualizedTranscriptRowList` → `virtualizer.scrollToIndex`;
  `FullTranscriptRowList` → all rows mounted, so it only releases the
  stick-to-bottom pin and lets the mark scroll happen). Both release the
  bottom pin so the jump isn't fought by auto-follow.

## Out of scope / known v1 edges

- **Tool-call titles and collapsed tool output are not searched.** Collapsed
  bodies aren't rendered, so they aren't painted; tool-call titles are a
  deliberate deferral (they fan out across many renderers). They are in neither
  the index nor the paint layer, keeping counts and highlights consistent.
- **Matches spanning inline formatting** (e.g. a query straddling a bold run, an
  inline-code span, or a link) may go unpainted — matching is per text segment.
  The index still counts them; the jump clamps.
- **User-message prose** is painted only inside committed transcript turn rows,
  not the composer or in-flight prompt rows (which the index doesn't cover).

## Performance

The chat paint/index layers must stay inert when search is closed or the
surface isn't chat (context value null, hook returns early, zero work). This is
load-bearing: transcript re-renders racing keystrokes have historically caused
multi-second stalls (see the INPUT-PRIORITY note in `MessageList.tsx`). The
paint query is deferred, and per-row extraction is memoized on row identity.
