# Chat Transcript

Read this doc when a change touches session streams, transcript replay,
transcript row models, pending/outbox prompt rows, long-history loading, or
chat transcript rendering performance.

## Stream And Transcript Rules

- SSE events should be batched into at most one Zustand store write per
  animation frame during normal streaming. The shared scheduler owner is
  `apps/packages/product-domain/src/chats/transcript/stream-batcher.ts`; Desktop and
  Web controllers inject their own timing/runtime hooks around it.
- Do not reintroduce per-event store patches for the live stream path.
- Any deliberate stream close, detach, prune, or reconnect path must flush
  pending batched stream events before discarding the current handle.
- Never clear `sseHandle` before queued envelopes have a chance to apply.
- Transcript reducers must preserve structural sharing and must not mutate
  prior transcript state, turns, items, or content-part arrays in place.
- Long transcripts must stay virtualized on the normal render path.
- Avoid whole-transcript maps, full-store subscriptions, or new object/array
  props that invalidate memoized row rendering on every stream event.
- Older-history loading must be bounded and retry-safe: use event/turn limits,
  keep requests abortable, key top-of-scroll prefetches by the oldest loaded
  sequence, and do not spin forever when a page returns no new rows.

Before merging transcript or stream-runtime changes, run focused coverage for
stream flushing, session runtime/history loading, transcript row modeling, SDK
transcript reducer immutability, plus:

```bash
pnpm --dir desktop exec tsc --noEmit
```

## Tool Result Rendering

Tool call rows should prefer product-specific renderers before the generic JSON
result row. The generic renderer is the fallback for unknown tools, malformed
payloads, and tool results that have no durable product display contract.

Product-specific result rendering must stay split by ownership:

```text
apps/packages/product-domain/src/chats/tools/<tool>-presentation.ts
  pure parser and display model for raw tool input/output

apps/desktop/src/components/workspace/chat/tool-calls/<Tool>Row.tsx
  visual row/details rendering for that display model

apps/desktop/src/components/workspace/chat/transcript/TranscriptToolCallItemBlock.tsx
  routing only; no product-specific parsing beyond choosing the row
```

`proliferate_skills` is a product MCP and has a transcript renderer:

```text
mcp__proliferate_skills__list_available_skills
  show listed skills as rows with skill id, description, required MCPs, and
  resource count

mcp__proliferate_skills__activate_skill
  show the activated skill as a card and render instructions as markdown

mcp__proliferate_skills__get_skill_resource
  show the loaded resource as markdown when the content type is markdown,
  otherwise as preformatted text
```

Do not render successful skills MCP results as raw JSON in the normal transcript
path.

## Markdown File Mentions And Code Blocks

Assistant markdown renders file references as clickable file mentions and code
blocks as bordered highlighted cards. Ownership is split by package law:

```text
apps/packages/product-ui/src/chat/transcript/MarkdownBody.tsx
  presentational markdown renderer; permissive urlTransform (blocks only
  javascript:/data:/vbscript:); injection props renderLink, renderInlineCode,
  renderCodeBlock; owns the code-block shell styling

apps/desktop/src/components/workspace/chat/transcript/transcript-markdown.tsx
  desktop renderers injected at TranscriptItemBlock, ClaudePlanCard, and
  ConnectedProposedPlanItem: only workspace file references render FilePathLink
  mentions; external/web link hrefs defer to MarkdownBody's default anchor
  (ProviderLinkMention); fenced code renders shiki-highlighted HTML in the shell

apps/packages/product-ui/src/chat/transcript/ProviderLinkMention.tsx
  shared inline provider-icon link mention + URL/host classification
  (isExternalHttpLink, linkHost); rendered by MarkdownBody's default anchor, so
  every surface (web + cloud chat included) gets icon links

apps/desktop/src/lib/domain/files/path-detection.ts
  pure path heuristics (looksLikePath, looksLikeFileReferenceHref,
  splitPathLineSuffix); promote to product-domain only when a second app
  renders mentions

anyharness .../domains/sessions/response_formatting.rs
  the prompt-side instruction (FILE_REFERENCE_INSTRUCTIONS) requiring markdown
  file links with the complete workspace-root path, never abbreviated
```

Rules:

- Detection happens at render time from raw markdown; do not store parsed file
  references in transcript items.
- Mention labels display the workspace-relative path plus a `(line N)` suffix;
  raw absolute hrefs must not be shown as label text.
- External/web link hrefs render as a shared inline provider-icon mention
  (`ProviderLinkMention`): a GitHub brand SVG for github hosts, otherwise the
  site's own favicon — `https://<host>/favicon.ico`, falling back to the root
  domain's favicon, then no icon. It is `MarkdownBody`'s default anchor, so every
  surface gets it (web + cloud chat included); URL detection
  (`isExternalHttpLink`) runs before file-path detection so a real path is never
  mistaken for a link. Favicon requests go to the linked site itself (no
  third-party favicon service), so no list of linked hosts leaks anywhere. The
  provider mention and the file-path mention share one inline-mention treatment
  (muted link color, no underline at rest, brighten to foreground + dashed
  underline on hover); this only renders because the global `a` reset lives in
  `@layer base` (see the frontend styling guide) — unlayered, it would strip the
  anchor's color/underline.
- Web falls back to unhighlighted (identically styled) code blocks; shiki stays
  out of the web bundle.

## Delegated-Work Receipts

Subagent creation, parent/child communication, and wake/completion receipts are
durable transcript events. They must render as delegated-work product events,
not as raw MCP mechanics.

Creation grouping belongs in the transcript presentation layer:

```text
apps/packages/product-domain/src/chats/transcript/transcript-presentation.ts
  buildTranscriptDisplayBlocks
```

Rules:

- Group only adjacent subagent creation receipts from the same assistant/tool
  call cluster.
- Do not group creation with send, wake, status, read, search, close, or
  generic tool calls.
- A single collapsed creation label is `Created subagent`.
- Multiple adjacent creation receipts collapse as `Created N subagents`.
- Collapsed creation labels use the same muted, backgroundless collapsed-action
  trigger treatment as normal transcript tool summaries such as
  `Explored 1 listing`.
- Expanded rows use
  `Created subagent GeneratedName (title ID) with prompt "..."`.
- Expanded creation rows stay on one truncating line. The row uses one text
  treatment except for the generated identity, which keeps the colored robot
  affordance and opens the child session when a valid target exists.
- Hovering the generated identity shows the delegated-agent card. When a valid
  child target exists, that card is clickable and opens the same child session.

Communication receipts:

- Parent messages rendered inside a child session show
  `Sent by parent - {parent chat title}`.
- Wake/completion receipts rendered in the parent transcript use one line:
  `GeneratedName (title ID) finished a turn`.
- Wake receipts source labels from prompt provenance plus
  `linkCompletionsByCompletionId`.
- When a valid child target exists, the whole wake/completion receipt chip and
  not a separate visible action or hover card, opens the child session.

## Layout Invariants

Some layout dimensions are load-bearing. They are tuned together so specific
UI transitions stay visually smooth. Changing one without the others can
reintroduce scroll/layout bumps.

### Spacing Rhythm

Sibling spacing inside a turn comes solely from the shared turn-container
`gap-4` (16px, matching Codex's conversation-item rhythm), and turn rows are
separated by `TurnShell`'s `pt-2 pb-2` (`pt-0` for the first row). Pending
prompt rows use the same shared gap so materialization is layout-stable. Blocks
must not carry external vertical padding of their own
(`TranscriptActivityBlock` is a zero-padding marker wrapper), and spacing must
not vary with streaming state: a turn completing is a zero-delta layout change
for everything already rendered.

Completed tool/reasoning history uses one left-aligned disclosure labelled
`Worked for {duration}`. Its expanded ledger remains underneath that row, and a
single full-width `border-border` hairline separates the work block from the
final answer. Do not render centered labels with rules on both sides, a
separate `Final message` separator, or hairlines between assistant prose
items. Top-level prose and activity blocks inside the expanded history restore
the same `gap-4` conversation-item rhythm; the tighter `gap-1` (4px) grouped
rhythm is reserved for detail rows within one expanded activity. The reveal
gap between the `Worked for…` disclosure and its body is also 4px (`mt-1`). If
the user stopped the turn, the same disclosure is labelled
`You stopped after {duration}` instead; do not add a duplicate stopped footer
beneath it. A stopped turn with no completed-history disclosure may use the
standalone notice as a fallback.

While work is live, the collapsed activity header represents exactly one
current action and its matching icon (`Reading file.ts`, `Running command`,
`Searching files`, and so on). It must never turn completed ledger history into
a cumulative live status such as `Running 4 commands`; prior work stays
available only inside the disclosure. A trailing exploration batch retains
that one live header between adjacent completed search/read events while the
turn remains in progress. Prose, a different trailing block, or turn completion
ends the phase immediately; a generic tail status must not flash between those
events.

Completed activity headers use short, count-free verb phrases such as
`Edited files, read files, ran a command`; exact counts stay in the expanded
ledger. One representative phrase summarizes exploration work so mixed
read/search/list/fetch batches stay concise. The dominant semantic icon follows
Codex's `edit > search/list > read/fetch > command` hierarchy (so a mixed
search/read row may say `Read files` while using the search glyph). Semantic
icons and labels share the same 60%-foreground ink, and the icon box scales
with transcript text instead of using a fixed pixel size. The disclosure
chevron remains layout-reserved but hidden until hover/focus or expansion.
Every row revealed inside an activity ledger repeats its own semantic glyph
(including mixed parsed shell operations), at the same text-relative size and
inherited ink as its label. Completed command details use `Ran …`; only the
active command uses `Running …`. An edit detail shows one pen glyph followed by
an inherited-color, dotted-underlined filename, not a second file-type glyph.

New activity blocks may use one compositor-only opacity/short horizontal
entrance. The motion is claimed once by stable item identity in the latest
in-progress turn. Hydrated history, completed-history expansion,
virtualization remounts, and session revisits must render statically, and
reduced-motion preferences disable the entrance.

### Stick-to-bottom engine

Bottom pinning is owned by one shared engine,
`apps/packages/product-ui/src/chat/transcript/useTranscriptStickToBottom.ts`,
consumed by both `FullTranscriptRowList` and `VirtualizedTranscriptRowList`. It
distinguishes user scrolls from its own programmatic snaps (`notifyProgrammaticScroll`
tags every `scrollTop`/`scrollToOffset` write the engine or its callers make) so
a streaming snap can never fight a user scrolling up. Intent to leave is detected
pre-emptively via passive `wheel`/`keydown`/`touch` listeners on the viewport,
flipping the pin state *before* the next snap layout effect reads it. Re-pinning
happens only when a user scroll lands within a tight bottom band
(`REPIN_BOTTOM_THRESHOLD_PX`), not the retired 96px `STICKY_BOTTOM_THRESHOLD_PX`
window — that loose window kept small upward scrolls "pinned" and let the snap
yank the user back.

While pinned, content growth re-sticks the viewport: the non-virtualized list
via a `ResizeObserver` on the scroll content plus a per-commit layout effect, the
virtualized list via measured `totalContentHeight`; both call the engine's
`scrollToBottom`, which writes `scrollTop = scrollHeight` (never
`virtualizer.scrollToIndex`, which bounces on unmeasured rows). On tab/window
re-show while pinned, a short pre-paint rAF "glue" loop holds the viewport at the
true bottom until row measurement settles, collapsing the resume backlog into one
jump instead of a visible crawl.

When the transcript is shorter than the viewport, both row-list paths use a
bottom-anchored flex frame (`mt-auto` content above the structural composer
inset). This preserves the same composer-relative frontier even when
`scrollTop` must clamp to zero; unused viewport height belongs above the
conversation, never between its frontier and composer.

When the user is unpinned, a completing turn that splits one row into
`completed-history` + `content` (a new, unmeasured row inserted above the anchor)
would bump the viewport as the 360px estimate corrects. The virtualized list
holds the anchored content with the measured `scrollHeight` delta in a
stability-gated loop; the non-virtualized list relies on native browser scroll
anchoring (`overflow-anchor`, left at its default) for the small seam.

Cards mounted above the composer (permission/question panels, slash-command
trays, queued messages, goals, and similar dock slots) are overlays, not a
reason to reposition existing transcript pixels. Their measured height is the
`nonDisplacingBottomInsetPx` portion of the full bottom inset: it is rendered as
absolutely positioned overflow beyond the bottom-anchor frame, adding scroll
range without participating in its layout. The user can manually bring the
transcript end above the obstruction, but changes to that portion alone must
not trigger a pinned snap or a content `ResizeObserver`/visibility-glue snap.
Normal auto-follow targets the soft bottom before this range. Once the user
deliberately reaches the hard bottom, auto-follow preserves the consumed range;
if another card stacks, only its newly added height remains manual-only. If a
consumed overlay shrinks or disappears, the browser's upward clamp to the new
hard bottom is layout movement, not user intent, and must preserve the pinned
state. Composer-surface height remains structural and continues to re-stick
promptly when the input itself grows.

A send intent with `placement: "queue"` is represented by the composer's
outbound queue and must not also produce a transcript row. A queued send that
fails before dispatch remains eligible for transcript error presentation. A
`pending_prompts_reordered` event is a complete queue replacement, including
the same immutable runtime-owned sequence identities in their committed array
order; consumers must not treat it as an incremental move event. Sequence
numbers never change during reorder and are never reused for a later entry.

### Streaming Handoff

The transcript has two distinct bottom concepts:

1. The **frontier** is the final visible thing the agent is doing: `Thinking`,
   a live tool/action row, or streaming/final prose.
2. The **assistant footer** is a permanent `h-6` row below the last frontier.
   It is empty while the turn is live, swaps in place to copy/timestamp/goal
   controls when final prose exists, and stays empty for a tool-only, stopped,
   or errored completion.

The frontier must remain at one composer-relative coordinate through pending
prompt ownership, materialization, live tool work, streamed prose, and
completion. The footer belongs below it and must never cause final prose to
move upward when its controls appear.

| Piece | Location | Value |
| --- | --- | --- |
| Frontier sibling gap | `TURN_ITEM_GAP_CLASS` in `TranscriptTurnChrome.tsx` | `gap-4` (16px) |
| Pending/materialized working-status frame | `renderWorkingTrailingStatus` in `TranscriptTurnChrome.tsx` | `flex h-6 items-center` |
| Empty/completed assistant footer | `TurnAssistantActionRow` in `TranscriptTurnChrome.tsx` | `h-6` (24px) |
| Message/status line-height | `--text-message--line-height` (aliases the appearance composer scale) | Dynamic; `20px` by default |

Additional dependencies:

- Pending `TurnShell` rows must pass `showCopyButton` to `UserMessage`, or the
  pending bubble becomes shorter than the real row that replaces it.
- Pending and materialized working states use the exact same centered `h-6`
  frame. Do not wrap one path in an additional non-flex `h-6`; the indicator is
  taller than the slot and divergent overflow alignment creates a visible
  handoff nudge.
- The pre-workspace `ChatLaunchIntentPane` uses the same bottom-anchored
  `TurnShell` sequence, copyable user-message geometry, `gap-4` frontier, and
  empty footer as the projected pending row. It also uses the transcript's
  stable structural inset and separate non-displacing overlay range, not the
  smaller auto-scroll inset. Launch -> pending -> materialized is an ownership
  handoff, not a layout transition.
- Pending and materialized `needs_input` markers share the same `h-6` frame.
- Retry/dismiss recovery controls on an uncertain pending send render above its
  frontier. The fixed assistant footer remains the last row.
- Prompt submit should clear the chat input before awaiting prompt delivery;
  otherwise the same message can appear in the composer and transcript at the
  same time.
- `latestStreamingAssistantProseRevision` controls whether the trailing
  status renders. Only prose that is *actively streaming* suppresses the
  indicator: while text streams, the growing prose is the placeholder. The
  moment prose completes with the turn still in progress (thinking or
  preparing a tool call), the trailing indicator becomes eligible again. If
  active prose receives no delta for 500ms, the indicator returns during that
  quiet gap; the next `(itemId, lastUpdatedSeq)` revision hides it
  synchronously and re-arms the quiet timer. A completed-looking transcript
  with silent background work is never acceptable.
  The indicator is a frontier row above the assistant footer; it must never
  occupy the footer itself.
- `TurnAssistantActionRow` renders its fixed footer when `reserveSlot` is true
  even before assistant prose exists. The latest materialized turn and pending
  prompt both reserve it; a completion without copyable prose keeps it reserved.
- Completion-only surfaces such as file-diff and artifact cards mount before
  the frontier item. They may grow upward as data arrives, but must never be
  inserted between final prose and its fixed footer. When completed-history UI
  exists, those cards remain inside the work block and above its single
  hairline; the hairline still directly separates all work from final prose.
  Full-turn artifact cards render only in the split row that owns final prose.
- A completed turn presents its final assistant prose last even when tool or
  file-change receipts have a later runtime sequence. Those non-final roots
  belong to completed work history above the prose; arrival order must not put
  activity below the final frontier. Goal-boundary partitioning assigns final
  prose the latest non-final work seq for slicing so it stays in the last turn
  row without crossing a goal event that occurs after all turn work.

If you change any pinned value, update every file in the table at the same time
and verify the full sequence: submit -> immediate Thinking -> materialized
Thinking -> live command -> streamed final prose -> copy/timestamp. The
frontier must not move at any handoff.
