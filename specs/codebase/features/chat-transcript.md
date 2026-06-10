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
  ConnectedProposedPlanItem: file-like link hrefs and path-like inline code
  render FilePathLink mentions; fenced code renders shiki-highlighted HTML
  inside the product-ui shell

apps/desktop/src/lib/domain/files/path-detection.ts
  pure path heuristics (looksLikePath, looksLikeFileReferenceHref,
  splitPathLineSuffix); promote to product-domain only when a second app
  renders mentions

anyharness .../domains/sessions/response_formatting.rs
  the prompt-side instruction steering models toward markdown file links
```

Rules:

- Detection happens at render time from raw markdown; do not store parsed file
  references in transcript items.
- Mention labels display the workspace-relative path plus a `(line N)` suffix;
  raw absolute hrefs must not be shown as label text.
- Web falls back to plain anchors and unhighlighted (identically styled) code
  blocks; shiki stays out of the web bundle.

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

### Streaming Handoff

When an assistant turn transitions from streaming state to its first line of
prose response, the swap must be a zero-delta layout change: no content shift
and no auto-scroll bump.

| Piece | Location | Value |
| --- | --- | --- |
| `TRAILING_STATUS_MIN_HEIGHT` | `apps/desktop/src/components/workspace/chat/transcript/TranscriptTurnChrome.tsx` | `min-h-[calc(var(--text-chat--line-height)+1.5rem)]` |
| Assistant copy-button slot | `apps/desktop/src/components/workspace/chat/transcript/AssistantMessage.tsx` | `h-6` (24px) |
| Chat text line-height | `apps/packages/design/src/tokens.ts` (`typography.lineHeight.chat`) | `21px` |

The derivation is:

```text
TRAILING_STATUS_MIN_HEIGHT = --text-chat--line-height + h-6
```

Additional dependencies:

- Pending `TurnShell` rows must pass `showCopyButton` to `UserMessage`, or the
  pending bubble becomes shorter than the real row that replaces it.
- Prompt submit should clear the chat input before awaiting prompt delivery;
  otherwise the same message can appear in the composer and transcript at the
  same time.
- `lastTopLevelItemIsProse` controls whether the trailing status renders. Once
  the last top-level turn item is prose with text, the prose itself is the
  placeholder and a separate spinner is not needed.
- The `h-6` copy-button slot in `AssistantMessage` is gated on content, not on
  `showCopyButton`, so the prose-owned slot remains stable while turns stream.

If you change any pinned value, update every file in the table at the same
time and verify by sending a message, waiting for assistant streaming to begin,
and watching for scroll movement during the indicator-to-prose swap.
