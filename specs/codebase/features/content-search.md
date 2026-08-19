# Content Search (Cmd+F)

Read this doc when a change touches in-app find (Cmd+F) on the chat transcript, the file viewer, or the git Changes review pane: match counting, highlighting, jump-to-match, the shared pill, or the content-search store.

## Surfaces

One store (`apps/packages/product-client/src/stores/search/content-search-store.ts`) and one pill (`ContentSearchPill`, `apps/packages/product-client/src/components/workspace/search/ContentSearchPill.tsx`) drive three surfaces:

- **chat**: the transcript. Searches conversation prose (user + assistant messages) plus inline diffs rendered in tool calls.
- **file**: the file viewer. Searches the open file's source / diff.
- **review**: the git Changes pane. Searches diff content across every rendered review file row. Available only while the Changes pane is mounted (see Availability below). Unlike chat, review search has no dedicated index/paint split; it registers straight off the same `ChatDiffViewer` diff-match extraction the chat surface uses, just tagged with a different `surface`.

`surface` alone gates which units are visible; there is no separate "scope". The shortcut (`workspace.find-content`, in `use-workspace-content-shortcuts.ts`) resolves the surface from the focused zone and calls `openSearch(surface)`. `resolveContentSearchSurfaceForShortcut` prefers an ancestor match (`[data-file-viewer-frame]` -> `file`, `[data-git-review-document]` -> `review`) before falling back to focus zone; outside those, chat is the default and terminal focus is a no-op.

When focus is already inside the pill (`[data-content-search-overlay]`), the same shortcut does not reopen: on `file` it always reselects/refocuses the input and never cycles away, since file search must not silently switch surfaces; on `chat`/`review` it cycles between those two when review is available, otherwise it just refocuses. Placeholder/aria: "Search chat…" / "Find in chat", "Search file…" / "Find in file", and "Search changes…" / "Find in changes".

The pill (`ContentSearchPill`) is a single component mounted once at the shell level (`StandardWorkspaceShell`), marked with `data-content-search-overlay`. One mount serves all three surfaces; there is no separate per-surface mount or file-search modal. Placement is computed per surface, not a single fixed offset: the ruled placement contract is chat sits 8px below the 46px shell tab strip, file and review sit 8px below their own 36px owned header (90px from the shell top), and every surface keeps 16px clearance from its content edge. Confirm the current computed `top`/`right` values in `StandardWorkspaceShell`/`ContentSearchPill` before depending on an exact value in new code or tests.

## Availability

Chat is always available. File and review availability are tracked in the store (`surfaceAvailability: { file, review }`) and toggled by each surface's host component on mount/unmount: `FileViewerFrame` (`apps/packages/product-client/src/components/workspace/files/viewer/FileViewerFrame.tsx`) sets `file`, `GitPanelReviewBody` (`apps/packages/product-client/src/components/workspace/git/GitPanelReviewBody.tsx`) sets `review`. `setSurfaceAvailability` auto-closes the pill when the surface that just went unavailable was the open one: a search whose host unmounted (e.g. the git pane closed) is meaningless and would otherwise leave a stale pill floating over unrelated content.

The Chat | Diff toggle (a `SegmentedControl` in `ContentSearchPill`) renders only when `surfaceAvailability.review` is true and the current surface is not `file`. File surface and review availability are mutually exclusive in practice: review availability implies the git pane is the active right-panel tab, and the file viewer occupies that same tab slot.

## File: eligibility, rendered-to-source transition, and exclusion

File content search is eligible only for an active `file` target (never `fileDiff`) whose settled read is text and not too large (`FileEditorView`'s `canFindInFile = !activeDiffTarget && read?.isText && !read.tooLarge`). Match-unit registration itself is owned by the mounted `FileSourceView`, which registers with `surface: "file"`.

Rendered Markdown stays display-only until search is opened: the closed-to-open transition (Find button, `Cmd/Ctrl+F`, or programmatic `openSearch("file")`) does a one-way switch from rendered to source mode (`setTargetMode(targetKey, "source")`) before search focuses, and does not oscillate the mode again on query changes or next/previous navigation.

`FileDiffPane` registers no content-search unit, and a `fileDiff` target never reports `canFindInFile`. The exclusion is enforced through availability, not a separate code path: `FileViewerFrame` registers the `file` surface as available only while `canFindInFile` is true, reactively for its whole lifetime, rather than unconditionally on mount, so a `fileDiff`, binary, too-large, or still-loading target reports `file` unavailable and neither the Find button nor the `Cmd/Ctrl+F` shortcut can open file search on it. Diff rendering does not implement the file-search owner contract; do not read the diff viewers as supporting file search.

## Focus capture and restoration

`ContentSearchPill` captures `document.activeElement` on every closed-to-open transition, along with the surface open at capture time. Escape, the close button, or the pill unmounting while open restores that captured element via `restoreFocusTo` when it is still connected, visible (not `hidden`/`display:none`/`visibility:hidden`), and enabled — otherwise it falls back to the registered surface owner root (`[data-chat-transcript-root='true']` for chat, `[data-file-viewer-frame]` for file, `[data-git-review-document]` for review), and if that owner is also gone, to the shell root (`[data-workspace-shell]`).

`content-search-store.ts`'s `closeSearch({ restoreFocus?: boolean })` defaults `restoreFocus` to `true` and stores no DOM node; passing `false` increments a session-only `closeSuppressRestoreToken` instead. The pill compares that token across the open-to-closed transition and skips restoration for exactly that one close when it changed — Escape, the close button, and an unprompted surface/target unmount all keep the default `true` and do restore. This suppression exists so a target activation that closes a stale search (old file's still-mounted Find control, a switched tab/tree row) cannot steal focus back from wherever the new activation is placing it.

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
