# Content Search (Cmd+F)

Read this doc when a change touches in-app find (Cmd+F) on the chat transcript, the file viewer, or the git Changes review pane: match counting, highlighting, jump-to-match, the shared pill, or the content-search store.

## Surfaces

One store (`apps/packages/product-client/src/stores/search/content-search-store.ts`) and one pill (`ContentSearchPill`, `apps/packages/product-client/src/components/workspace/search/ContentSearchPill.tsx`) drive three surfaces:

- **chat**: the transcript. Searches conversation prose (user + assistant messages) plus inline diffs rendered in tool calls.
- **file**: the file viewer. Searches the open file's source / diff.
- **review**: the git Changes pane. Searches diff content across every rendered review file row. Available only while the Changes pane is mounted (see Availability below). Unlike chat, review search has no dedicated index/paint split; it registers straight off the same `ChatDiffViewer` diff-match extraction the chat surface uses, just tagged with a different `surface`.

`surface` alone gates which units are visible; there is no separate "scope". The shortcut (`workspace.find-content`) resolves the surface from the focused zone and calls `openSearch(surface)`; when focus is already inside the pill and review is available, the same shortcut cycles surface between "chat" and "review" instead of reopening. Placeholder/aria: "Search chat…" / "Find in chat", "Search file…" / "Find in file", and "Search changes…" / "Find in changes".

The pill is a single component mounted once at the shell level (`StandardWorkspaceShell`), fixed to the top-right, positioned to clear the fixed header/tab chrome band (`top-[calc(var(--tab-system-height)+8px)]`). There is no per-surface vertical offset anymore, since there is only one mount shared by all three surfaces.

## Availability

Chat is always available. File and review availability are tracked in the store (`surfaceAvailability: { file, review }`) and toggled by each surface's host component on mount/unmount: `FileViewerFrame` (`apps/packages/product-client/src/components/workspace/files/viewer/FileViewerFrame.tsx`) sets `file`, `GitPanelReviewBody` (`apps/packages/product-client/src/components/workspace/git/GitPanelReviewBody.tsx`) sets `review`. `setSurfaceAvailability` auto-closes the pill when the surface that just went unavailable was the open one: a search whose host unmounted (e.g. the git pane closed) is meaningless and would otherwise leave a stale pill floating over unrelated content.

The Chat | Diff toggle (a `SegmentedControl` in `ContentSearchPill`) renders only when `surfaceAvailability.review` is true. File surface and review availability are mutually exclusive in practice: review availability implies the git pane is the active right-panel tab, and the file viewer occupies that same tab slot.

## Store model

`registerUnit({ unitId, surface, query, matchIds, orderKey? })` records a unit (a diff instance, a file source view, or one transcript row). Visible matches = the flattened `matchIds` of units whose `surface` and normalized `query` match the active search, ordered by `orderKey` ascending. Units without an `orderKey` (e.g. inline chat diffs that can't cheaply learn their transcript row index) sort after all keyed units, in registration order. `activeMatchId` walks that flattened list.

## Chat: index / paint split

The chat surface separates **counting** from **highlighting** because most transcript rows are unmounted (virtualized), so the DOM cannot be the source of truth.

- **Index (data, authoritative).** `apps/packages/product-client/src/hooks/chat/lifecycle/use-chat-transcript-content-search.ts` rebuilds the transcript row model and, per row, extracts searchable prose via `apps/packages/product-client/src/lib/domain/content-search/transcript-search-text.ts` (`extractTranscriptRowProseSegments`: markdown-stripped assistant prose + plain user text). It registers one store unit per matching row: `unitId = "chatrow:" + rowKey`, `matchIds = [unitId + ":" + i]`, `orderKey = rowIndex * 2`. This yields exact counts regardless of virtualization and is entirely inert unless chat search is open with a non-empty query. Per-row extraction is memoized on row identity (a `WeakMap`), and the query is behind `useDeferredValue`, so streaming updates only recompute changed rows.

- **Paint (React, context-gated).** `ChatTranscriptView` receives a `contentSearch={{ query }}` prop and publishes it through `ChatContentSearchQueryContext`; each transcript row publishes its unit id + index through `ChatTranscriptRowContext` (see `apps/packages/product-client/src/components/workspace/chat/transcript/ChatContentSearchContext.tsx`). `MarkdownBody` (assistant prose, opted in via `enableContentSearch`) and `FileLinkedText` (user prose, `apps/packages/product-client/src/components/workspace/chat/content/PromptContentRenderer.tsx`, itself a thin `MarkdownBody` wrapper) wrap query matches in `<mark class="content-find-match" data-content-search-row={rowUnitId}>`, with no per-match id at render time. Everything is inert when the query context is null; secondary chrome (tool detail bodies, plan cards) reuses `MarkdownBody` without `enableContentSearch` and shadows the query context to null so its text is never highlighted and never indexed.

- **Jump-to-match.** When `activeMatchId` is a `chatrow:` id, `MessageList` (`apps/packages/product-client/src/components/workspace/chat/transcript/MessageList.tsx`) parses the row key + ordinal (`apps/packages/product-client/src/lib/domain/content-search/chat-row-match-jump.ts`), calls the `ChatTranscriptView` imperative `scrollToRowKey` handle to bring an off-screen row into view, then runs a bounded rAF retry loop that selects the ordinal-th `mark[data-content-search-row=...]` in document order, marks it active, and scrolls it into view. If fewer marks are painted than the index counted, the ordinal clamps to the last painted mark (a benign extraction/render mismatch); the row is still scrolled into view.

Inline diffs inside a transcript row register through `ChatDiffViewer` with `orderKey = rowIndex * 2 + 1` (read from the row context) so a row's diff matches interleave just after its prose. Diff/file marks keep their existing React-rendered `data-content-search-match-id` marks and active class; the pill's own scroll effect still handles them.

## Review: diff matches

`GitPanelReviewSections` (`apps/packages/product-client/src/components/workspace/git/GitPanelReviewSections.tsx`) gives each rendered `GitReviewFileRow` a running flattened index across every section (sections don't reset the index), passed through as `contentSearchOrderKey`. Each row's `DiffViewer` (unified layout only, `variant="chat"`) is called with `contentSearchSurface="review"`, `contentSearchUnitId={"review-diff:" + row id}`, and that order key, so review matches walk file rows top to bottom regardless of which working-tree section (staged/unstaged/etc.) they came from.

Split layout renders `DiffViewer` through the `default` variant (`SplitDiffViewer`), which never registers a content-search unit, so review search finds nothing while a file is displayed split. This is an accepted v1 edge; see Out of scope.

Opening review search auto-expands every collapsed review file: `GitPanel`'s `collapsedFiles` state clears on the search's false-to-true open transition only, via the pure `shouldAutoExpandForReviewSearch` helper in `apps/packages/product-client/src/lib/domain/workspaces/changes/git-panel-review-model.ts`. Re-expansion fires once per open transition, not on every keystroke, so a reviewer's manual collapse during an active search session isn't fought.

## Virtualization handling

- The imperative `scrollToRowKey` handle lives on both list implementations (`VirtualizedTranscriptRowList`: `virtualizer.scrollToIndex`; `FullTranscriptRowList`: all rows mounted, so it only releases the stick-to-bottom pin and lets the mark scroll happen). Both release the bottom pin so the jump isn't fought by auto-follow.

## Out of scope / known v1 edges

- **Tool-call titles and collapsed tool output are not searched.** Collapsed bodies aren't rendered, so they aren't painted; tool-call titles are a deliberate deferral (they fan out across many renderers). They are in neither the index nor the paint layer, keeping counts and highlights consistent.
- **Matches spanning inline formatting** (e.g. a query straddling a bold run, an inline-code span, or a link) may go unpainted, since matching is per text segment. The index still counts them; the jump clamps.
- **User-message prose** is painted only inside committed transcript turn rows, not the composer or in-flight prompt rows (which the index doesn't cover).
- **Review search in split-diff layout finds nothing.** Split diffs don't register a content-search unit; switching the Changes pane to unified layout is the workaround. Case/exact/regex options and split-diff matches are both out of scope for the review surface in v1.

## Performance

The chat paint/index layers must stay inert when search is closed or the surface isn't chat (context value null, hook returns early, zero work). This is load-bearing: transcript re-renders racing keystrokes have historically caused multi-second stalls (see the INPUT-PRIORITY note in `MessageList.tsx`). The paint query is deferred, and per-row extraction is memoized on row identity.
