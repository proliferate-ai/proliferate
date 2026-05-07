# Chat Transcript

Read this doc when a change touches session streams, transcript replay,
transcript row models, pending/outbox prompt rows, long-history loading, or
chat transcript rendering performance.

## Stream And Transcript Rules

- SSE events should be batched into at most one Zustand store write per
  animation frame during normal streaming.
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
| `TRAILING_STATUS_MIN_HEIGHT` | `desktop/src/components/workspace/chat/transcript/MessageList.tsx` | `min-h-[2.625rem]` (42px) |
| Assistant copy-button slot | `desktop/src/components/workspace/chat/transcript/AssistantMessage.tsx` | `h-6` (24px) |
| Chat text line-height | `desktop/src/index.css` | `1.125rem` (18px) |

The derivation is:

```text
TRAILING_STATUS_MIN_HEIGHT = --text-chat--line-height + h-6
42px = 18px + 24px
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
