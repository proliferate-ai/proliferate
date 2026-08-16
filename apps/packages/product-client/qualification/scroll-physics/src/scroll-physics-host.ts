// QUALIFICATION-ONLY host state + driver for the scroll-physics fixture.
//
// This module owns a small external store that holds a synthetic
// `TranscriptState` built with the REAL `@anyharness/sdk` reducer. React
// subscribes via `useSyncExternalStore`; Playwright drives every transition
// through `window.__scrollPhysics`. No network, no LLM, no server: scripted
// event batches only. The goal is that scroll physics run against the exact
// transcript renderer that ships, so the browser (Chromium/WebKit) does the
// real layout and scrolling.

import {
  createTranscriptState,
  reduceEventBatch,
  type SessionEvent,
  type SessionEventEnvelope,
  type TranscriptState,
} from "@anyharness/sdk";

// --- synthetic event authoring ---------------------------------------------

const BASE_TIME_MS = Date.UTC(2026, 0, 1, 0, 0, 0);
let seqCounter = 1;

function nextSeq(): number {
  return seqCounter++;
}

function timestampFor(seq: number): string {
  return new Date(BASE_TIME_MS + seq * 1000).toISOString();
}

function envelope(
  sessionId: string,
  turnId: string,
  itemId: string | undefined,
  event: SessionEvent,
): SessionEventEnvelope {
  const seq = nextSeq();
  return {
    sessionId,
    seq,
    timestamp: timestampFor(seq),
    turnId,
    itemId,
    event,
  };
}

// A block of prose tall enough that a handful of turns overflow the fixed
// viewport, so real scrolling actually happens.
function tallText(label: string, lines = 24): string {
  const body: string[] = [];
  for (let i = 0; i < lines; i += 1) {
    body.push(`${label} line ${i + 1}: the quick brown fox jumps over the lazy dog.`);
  }
  return body.join("\n");
}

function userMessage(sessionId: string, turnId: string, text: string): SessionEventEnvelope {
  const itemId = `${turnId}-user`;
  return envelope(sessionId, turnId, itemId, {
    type: "item_completed",
    item: {
      kind: "user_message",
      status: "completed",
      sourceAgentKind: "claude",
      promptId: null,
      contentParts: [{ type: "text", text }],
    },
  });
}

function assistantStarted(
  sessionId: string,
  turnId: string,
  itemId: string,
  text: string,
): SessionEventEnvelope {
  return envelope(sessionId, turnId, itemId, {
    type: "item_started",
    item: {
      kind: "assistant_message",
      status: "in_progress",
      sourceAgentKind: "claude",
      contentParts: [{ type: "text", text }],
    },
  });
}

function assistantDelta(
  sessionId: string,
  turnId: string,
  itemId: string,
  appendText: string,
): SessionEventEnvelope {
  return envelope(sessionId, turnId, itemId, {
    type: "item_delta",
    delta: { appendText },
  });
}

function assistantCompleted(
  sessionId: string,
  turnId: string,
  itemId: string,
  text: string,
): SessionEventEnvelope {
  return envelope(sessionId, turnId, itemId, {
    type: "item_completed",
    item: {
      kind: "assistant_message",
      status: "completed",
      sourceAgentKind: "claude",
      contentParts: [{ type: "text", text }],
    },
  });
}

// Q13 (rung 10, PRO-187): a "thought" item mid-turn, the normalized item kind
// every harness's reasoning/thinking events reduce into (see
// harness-transient-block-matrix.ts). Its trailing status renders inside the
// SAME reserved ASSISTANT_ACTION_SLOT_HEIGHT slot as the working gleam and
// the tool-call label (TranscriptTurnChrome.tsx); it must never add its own
// row height while streaming, or the reserved-slot invariant is broken.
function thoughtStarted(
  sessionId: string,
  turnId: string,
  itemId: string,
  text: string,
): SessionEventEnvelope {
  return envelope(sessionId, turnId, itemId, {
    type: "item_started",
    item: {
      kind: "reasoning",
      status: "in_progress",
      sourceAgentKind: "claude",
      isTransient: true,
      contentParts: [{ type: "reasoning", text, visibility: "private" }],
    },
  });
}

function thoughtDelta(
  sessionId: string,
  turnId: string,
  itemId: string,
  appendReasoning: string,
): SessionEventEnvelope {
  return envelope(sessionId, turnId, itemId, {
    type: "item_delta",
    delta: { appendReasoning },
  });
}

function thoughtCompleted(
  sessionId: string,
  turnId: string,
  itemId: string,
  text: string,
): SessionEventEnvelope {
  return envelope(sessionId, turnId, itemId, {
    type: "item_completed",
    item: {
      kind: "reasoning",
      status: "completed",
      sourceAgentKind: "claude",
      isTransient: true,
      contentParts: [{ type: "reasoning", text, visibility: "private" }],
    },
  });
}

// Closes a turn the way production hydration does: a real finalized turn always
// carries a `turn_ended`, which is what stamps `completedAt` on the turn record.
// The renderer reads `completedAt` to decide `wasLive` (use-assistant-reveal-
// frontier.ts): a turn with a null `completedAt` counts as live and runs the
// assistant typewriter reveal on mount. Seeded "finalized" turns that stop at
// `item_completed` (no `turn_ended`) therefore hydrate with `completedAt == null`
// and animate a reveal that production never shows for already-finalized history,
// which inflates per-frame content growth and distorts every physics probe.
// Emitting `turn_ended` here matches production hydration so seeded finalized
// turns hydrate inert, exactly as they do in the real client.
function turnEnded(sessionId: string, turnId: string): SessionEventEnvelope {
  return envelope(sessionId, turnId, undefined, {
    type: "turn_ended",
    stopReason: "end_turn",
  });
}

// A tool invocation (bash) carrying a large output body, used to exercise a
// tall/nested tool-output region.
function largeToolInvocation(sessionId: string, turnId: string): SessionEventEnvelope[] {
  const itemId = `${turnId}-tool`;
  const outputLines: string[] = [];
  for (let i = 0; i < 400; i += 1) {
    outputLines.push(`[${i}] synthetic build output row with a fair amount of width to force wrapping`);
  }
  const rawOutput = outputLines.join("\n");
  const started = envelope(sessionId, turnId, itemId, {
    type: "item_started",
    item: {
      kind: "tool_invocation",
      status: "in_progress",
      sourceAgentKind: "claude",
      title: "bash",
      toolCallId: itemId,
      nativeToolName: "bash",
      rawInput: { command: "pnpm build" },
      contentParts: [
        {
          type: "tool_call",
          toolCallId: itemId,
          title: "bash",
          toolKind: "other",
          nativeToolName: "bash",
        },
      ],
    },
  });
  const completed = envelope(sessionId, turnId, itemId, {
    type: "item_completed",
    item: {
      kind: "tool_invocation",
      status: "completed",
      sourceAgentKind: "claude",
      title: "bash",
      toolCallId: itemId,
      nativeToolName: "bash",
      rawInput: { command: "pnpm build" },
      rawOutput,
    },
  });
  return [started, completed];
}

// A single small, completed bash tool call — used in bulk (see
// `collapsedToolLedgerTurn`) to build one turn with a long run of
// individually-tiny actions that the presentation layer folds into ONE
// `collapsed_actions` display block (see isCollapsibleAction in
// transcript-presentation.ts). This is the "long tool-ledger-like row" the
// rung 5 estimate-bounce fixture targets: real height stays a compact,
// mostly-count-independent disclosure, while the OLD flat 360px-per-row
// estimate assumed every row was itself full-turn-sized.
function smallToolCall(sessionId: string, turnId: string, index: number): SessionEventEnvelope[] {
  const itemId = `${turnId}-tool-${index}`;
  const started = envelope(sessionId, turnId, itemId, {
    type: "item_started",
    item: {
      kind: "tool_invocation",
      status: "in_progress",
      sourceAgentKind: "claude",
      title: "read_file",
      toolCallId: itemId,
      nativeToolName: "read_file",
      rawInput: { path: `src/file-${index}.ts` },
      contentParts: [
        {
          type: "tool_call",
          toolCallId: itemId,
          title: "read_file",
          toolKind: "other",
          nativeToolName: "read_file",
        },
      ],
    },
  });
  const completed = envelope(sessionId, turnId, itemId, {
    type: "item_completed",
    item: {
      kind: "tool_invocation",
      status: "completed",
      sourceAgentKind: "claude",
      title: "read_file",
      toolCallId: itemId,
      nativeToolName: "read_file",
      rawInput: { path: `src/file-${index}.ts` },
      rawOutput: "ok",
    },
  });
  return [started, completed];
}

// One turn whose item count clears SPLIT_TURN_MIN_ITEM_COUNT (24) and whose
// tool calls collapse into a single `collapsed_actions` display block.
function collapsedToolLedgerTurn(
  sessionId: string,
  turnId: string,
  toolCallCount: number,
): SessionEventEnvelope[] {
  const envelopes: SessionEventEnvelope[] = [
    userMessage(sessionId, turnId, "Read through the affected files."),
  ];
  for (let i = 0; i < toolCallCount; i += 1) {
    envelopes.push(...smallToolCall(sessionId, turnId, i));
  }
  const assistantItemId = `${turnId}-assistant`;
  envelopes.push(
    assistantCompleted(sessionId, turnId, assistantItemId, "Done reading through the files."),
  );
  envelopes.push(turnEnded(sessionId, turnId));
  return envelopes;
}

// A tall fenced code block inside assistant prose. This renders through the
// real MarkdownCodeBlock, which owns its OWN inner `overflow-y-auto` region,
// the nested-scroll surface the chaining scenario needs.
function codeBlockText(label: string): string {
  const lines: string[] = ["Here is the generated module:", "", "```ts"];
  for (let i = 0; i < 80; i += 1) {
    lines.push(`export const ${label}_${i} = () => ${i} * 2; // generated line ${i}`);
  }
  lines.push("```", "", "That completes the change.");
  return lines.join("\n");
}

// --- reducer-backed transcript assembly ------------------------------------

// Reduce a fresh session made of a sequence of finalized user+assistant turns.
function buildFinalizedConversation(sessionId: string, turns: number): TranscriptState {
  let state = createTranscriptState(sessionId);
  const batch: SessionEventEnvelope[] = [];
  for (let t = 0; t < turns; t += 1) {
    const turnId = `${sessionId}-turn-${t}`;
    const assistantItemId = `${turnId}-assistant`;
    batch.push(userMessage(sessionId, turnId, `Prompt ${t}: please continue.`));
    batch.push(
      assistantCompleted(sessionId, turnId, assistantItemId, tallText(`Reply ${t}`)),
    );
    batch.push(turnEnded(sessionId, turnId));
  }
  state = reduceEventBatch(state, batch);
  return state;
}

// Merge older turns in FRONT of the current turn order, the shape a
// load-older-history prepend produces.
function mergeOlderBefore(older: TranscriptState, current: TranscriptState): TranscriptState {
  return {
    ...current,
    turnOrder: [...older.turnOrder, ...current.turnOrder],
    turnsById: { ...older.turnsById, ...current.turnsById },
    itemsById: { ...older.itemsById, ...current.itemsById },
  };
}

// --- external store ---------------------------------------------------------

// Default structural (displacing) dock inset the fixture boots with: the
// reserved composer height. Rung 7 (Q6) scenarios drive it to model a composer
// growth/collapse or a status bar appearing/disappearing.
export const DEFAULT_STRUCTURAL_INSET_PX = 120;

export interface HostSnapshot {
  transcript: TranscriptState;
  activeSessionId: string;
  hasOlderHistory: boolean;
  // A non-null cursor is required for the transcript to actually request older
  // history (see maybeLoadOlderHistory). It changes on each prepend so the
  // component's per-cursor de-dup admits the next request.
  olderHistoryCursor: number | null;
  sessionBusy: boolean;
  // Rung 7 (Q6): the dock inset model split the fixture feeds the transcript.
  // structural = displacing (composer/status bar, reserved as paddingEnd + the
  // fake dock's own height); nonDisplacing = manual-only overlay range.
  structuralInsetPx: number;
  nonDisplacingInsetPx: number;
}

export interface ScrollSample {
  programmatic: boolean;
  userInitiated: boolean;
  at: number;
}

const PRIMARY_SESSION = "session-primary";
const SECONDARY_SESSION = "session-secondary";

let snapshot: HostSnapshot = {
  transcript: createTranscriptState(PRIMARY_SESSION),
  activeSessionId: PRIMARY_SESSION,
  hasOlderHistory: false,
  olderHistoryCursor: null,
  sessionBusy: false,
  structuralInsetPx: DEFAULT_STRUCTURAL_INSET_PX,
  nonDisplacingInsetPx: 0,
};

const listeners = new Set<() => void>();
const scrollSamples: ScrollSample[] = [];

// Streaming bookkeeping for the currently-open assistant item.
let openStream: { sessionId: string; turnId: string; itemId: string; text: string } | null = null;
// Q13 (rung 10): the currently-open thought item within an open stream, if any.
let openThought: { sessionId: string; turnId: string; itemId: string; text: string } | null = null;

// A reservoir of older turns to reveal on prepend, keyed per session.
let olderReservoir = 0;

// Each reset advances the session id so the transcript's per-session reset
// (resetForSession) always fires and re-pins to a clean bottom baseline, rather
// than silently inheriting a prior scenario's pin state.
let resetCounter = 0;
let currentSessionId = PRIMARY_SESSION;

// Viewport geometry captured at the instant the transcript asks for older
// history (the same instant the component snapshots its own restore anchor),
// so a spec can assert the anchor invariant after the prepend settles.
let lastPrependEvidence: { preScrollTop: number; preScrollHeight: number } | null = null;

function commit(next: HostSnapshot): void {
  snapshot = next;
  for (const listener of listeners) {
    listener();
  }
}

function apply(envelopes: SessionEventEnvelope[]): void {
  commit({
    ...snapshot,
    transcript: reduceEventBatch(snapshot.transcript, envelopes),
  });
}

export const hostStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): HostSnapshot {
    return snapshot;
  },
  recordScrollSample(sample: { programmatic: boolean; userInitiated?: true } | undefined): void {
    scrollSamples.push({
      programmatic: sample?.programmatic ?? false,
      userInitiated: sample?.userInitiated === true,
      at: performance.now(),
    });
  },
};

// --- Playwright driver ------------------------------------------------------

const VIEWPORT_SELECTOR = "div.overflow-y-auto:has([data-transcript-virtualization-mode])";

function viewport(): HTMLElement | null {
  return document.querySelector<HTMLElement>(VIEWPORT_SELECTOR);
}

export interface ViewportMetrics {
  found: boolean;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  bottomDistance: number;
}

function metrics(): ViewportMetrics {
  const el = viewport();
  if (!el) {
    return { found: false, scrollTop: 0, scrollHeight: 0, clientHeight: 0, bottomDistance: 0 };
  }
  const bottomDistance = el.scrollHeight - el.clientHeight - el.scrollTop;
  return {
    found: true,
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    bottomDistance,
  };
}

// Per-frame scrollTop trace recorder: capture scrollTop on every rAF between
// start and stop, so a spec can assert "no visible motion" (a flat trace).
//
// scrollTop alone conflates two different things: a real backward displacement
// of the pinned reader's view, and the single writer correctly following a
// content area that just got SMALLER (an estimate-to-measured height
// correction shrinking the calibrated content, mid-stream). Both look like a
// backward scrollTop step; only the first one is a bug. `bottomDistanceFrames`
// is captured in the SAME rAF tick as `traceFrames` (frame-aligned, not a
// second independent loop) so a spec can assert on the quantity the reader
// actually perceives — distance from true bottom — which stays flat when
// scrollHeight and scrollTop shrink together and only moves for a real
// displacement.
let traceFrames: number[] = [];
let bottomDistanceFrames: number[] = [];
let traceRafId = 0;
let traceActive = false;

// Per-frame virtualizer TOTAL content height (scrollHeight) trace recorder —
// the rung 5 (PRO-187) estimate-bounce fixture's signal. An estimate error
// shows up here as a transient spike/dip between the guessed size and the
// real measured size, at rAF resolution (finer than a JS-side polling loop
// can reliably observe, since the estimate -> real-measurement swap can land
// within the same frame the row mounts).
let heightTraceFrames: number[] = [];
let heightTraceRafId = 0;
let heightTraceActive = false;

function heightTraceTick(): void {
  if (!heightTraceActive) {
    return;
  }
  const el = viewport();
  heightTraceFrames.push(el ? el.scrollHeight : Number.NaN);
  heightTraceRafId = requestAnimationFrame(heightTraceTick);
}

function traceTick(): void {
  if (!traceActive) {
    return;
  }
  const el = viewport();
  traceFrames.push(el ? el.scrollTop : Number.NaN);
  bottomDistanceFrames.push(el ? el.scrollHeight - el.clientHeight - el.scrollTop : Number.NaN);
  traceRafId = requestAnimationFrame(traceTick);
}

export interface ScrollPhysicsDriver {
  readonly primarySession: string;
  readonly secondarySession: string;
  reset(sessionId?: string): void;
  seedFinalizedConversation(turns: number, sessionId?: string): void;
  seedConversationWithToolLedger(leadingTurns: number, trailingTurns: number, toolCallCount?: number): void;
  setHasOlderHistory(hasOlder: boolean, reservoirTurns?: number): void;
  beginStreamingTurn(): void;
  streamChunk(text?: string): void;
  streamChunks(count: number, textPerChunk?: string): void;
  /**
   * Q13 (rung 10): within the currently-open streaming turn, start a thought
   * (a `reasoning` item, the normalized kind every harness's thinking events
   * reduce into) and stream it a couple of deltas. Its trailing-status label
   * renders inside the reserved slot; it must cost zero row height.
   */
  streamThoughtStart(): void;
  /** Ends the open thought (Q13). Its label survives the stream closing (see transcript-trailing-status.ts) until the next visible item replaces it. */
  streamThoughtStop(): void;
  /** A single small completed tool call inside the open streaming turn (Q13 tool-only class). */
  streamToolCall(): void;
  finalizeStreamingTurn(): void;
  appendLargeToolOutput(): void;
  appendCodeBlockTurn(): void;
  appendCollapsedToolLedgerTurn(toolCallCount?: number): string;
  appendFinalizedTurns(turns: number): void;
  prependOlderHistory(turns?: number): void;
  switchSession(sessionId: string, seedTurns: number): void;
  switchSessionStreaming(sessionId: string, seedTurns: number): void;
  // Rung 7 (Q6): drive the DISPLACING (structural) dock inset, modelling a
  // composer growth/collapse or a status bar appearing/disappearing. Also
  // resizes the fake dock so the transcript's client height changes exactly as
  // it does in the real app when the composer changes height.
  setComposerInset(structuralInsetPx: number): void;
  // Rung 7 (Q6): drive the manual-only overlay (non-displacing) inset.
  setOverlayInset(nonDisplacingInsetPx: number): void;
  getMetrics(): ViewportMetrics;
  // Rung 8 (PRO-187, PRO-258): drives a wheel gesture against the nested
  // code-block scroller already at ITS OWN bottom edge and reports the outer
  // transcript viewport's scrollTop before/after. Chaining means `after` is
  // measurably greater than `before`. Returns null if no code-block viewport
  // is mounted.
  chainWheelPastNestedCodeBlock(deltaY?: number): { before: number; after: number } | null;
  getTopVisibleText(): string | null;
  scrollToBottomInstant(): void;
  scrollToTopInstant(): void;
  sweepEveryRowIntoView(stepDelayMs?: number): Promise<void>;
  gestureScrollToBottomDistance(distancePx: number): void;
  // True pin state, read from the floating "Scroll to bottom" control, which is
  // aria-hidden exactly when pinned to bottom. Returns null if the control is
  // not present.
  isPinned(): boolean | null;
  // Rung 9 (PRO-187, Q18): the new-content accent's own marker element, and a
  // real click on the button's click target.
  hasNewContentIndicator(): boolean;
  clickScrollToBottom(): void;
  getLastPrependEvidence(): { preScrollTop: number; preScrollHeight: number } | null;
  getScrollSamples(): ScrollSample[];
  clearScrollSamples(): void;
  startScrollTrace(): void;
  stopScrollTrace(): number[];
  // Frame-aligned with startScrollTrace/stopScrollTrace: the same rAF ticks,
  // reporting bottomDistance (scrollHeight - clientHeight - scrollTop)
  // instead of raw scrollTop. Use this to assert "the pinned reader never saw
  // backward motion," which raw scrollTop cannot distinguish from the single
  // writer legitimately following a content area that just shrank (an
  // estimate-to-measured correction).
  stopBottomDistanceTrace(): number[];
  startContentHeightTrace(): void;
  stopContentHeightTrace(): number[];
  hasViewport(): boolean;
}

export const scrollPhysicsDriver: ScrollPhysicsDriver = {
  primarySession: PRIMARY_SESSION,
  secondarySession: SECONDARY_SESSION,

  reset(sessionId?: string): void {
    resetCounter += 1;
    currentSessionId = sessionId ?? `${PRIMARY_SESSION}-${resetCounter}`;
    openStream = null;
    openThought = null;
    olderReservoir = 0;
    lastPrependEvidence = null;
    scrollSamples.length = 0;
    commit({
      transcript: createTranscriptState(currentSessionId),
      activeSessionId: currentSessionId,
      hasOlderHistory: false,
      olderHistoryCursor: null,
      sessionBusy: false,
      structuralInsetPx: DEFAULT_STRUCTURAL_INSET_PX,
      nonDisplacingInsetPx: 0,
    });
  },

  seedFinalizedConversation(turns: number, sessionId?: string): void {
    const id = sessionId ?? currentSessionId;
    currentSessionId = id;
    openStream = null;
    openThought = null;
    commit({
      ...snapshot,
      transcript: buildFinalizedConversation(id, turns),
      activeSessionId: id,
      sessionBusy: false,
    });
  },

  // Rung 5 (PRO-187) estimate-accuracy fixture: seeds a conversation that
  // already contains the collapsed tool-ledger turn in its FIRST commit
  // (unlike appendCollapsedToolLedgerTurn, which appends to an existing
  // transcript). The virtualizer's `initialOffset` is computed from the
  // composition-estimate SUM over every row exactly once, at first mount
  // (see VirtualizedTranscriptRowList.tsx) — seeding the ledger turn into the
  // very first paint means the scrollTop the browser lands on immediately
  // after mount (before any scrolling or real measurement) is a direct,
  // single-read signal of estimate accuracy, not something that has to be
  // inferred from a settle window.
  seedConversationWithToolLedger(leadingTurns: number, trailingTurns: number, toolCallCount = 30): void {
    const id = currentSessionId;
    openStream = null;
    openThought = null;
    let state = createTranscriptState(id);
    const batch: SessionEventEnvelope[] = [];
    for (let t = 0; t < leadingTurns; t += 1) {
      const turnId = `${id}-lead-${t}`;
      const assistantItemId = `${turnId}-assistant`;
      batch.push(userMessage(id, turnId, `Prompt ${t}: please continue.`));
      batch.push(assistantCompleted(id, turnId, assistantItemId, tallText(`Reply ${t}`)));
      batch.push(turnEnded(id, turnId));
    }
    batch.push(...collapsedToolLedgerTurn(id, `${id}-ledger`, toolCallCount));
    for (let t = 0; t < trailingTurns; t += 1) {
      const turnId = `${id}-trail-${t}`;
      const assistantItemId = `${turnId}-assistant`;
      batch.push(userMessage(id, turnId, `Prompt trail ${t}: please continue.`));
      batch.push(assistantCompleted(id, turnId, assistantItemId, tallText(`Trail ${t}`)));
      batch.push(turnEnded(id, turnId));
    }
    state = reduceEventBatch(state, batch);
    commit({
      ...snapshot,
      transcript: state,
      activeSessionId: id,
      sessionBusy: false,
    });
  },

  setHasOlderHistory(hasOlder: boolean, reservoirTurns = 8): void {
    olderReservoir = hasOlder ? reservoirTurns : 0;
    commit({
      ...snapshot,
      hasOlderHistory: hasOlder,
      olderHistoryCursor: hasOlder ? reservoirTurns : null,
    });
  },

  beginStreamingTurn(): void {
    const sessionId = snapshot.activeSessionId;
    const turnId = `${sessionId}-stream-${nextSeq()}`;
    const itemId = `${turnId}-assistant`;
    openStream = { sessionId, turnId, itemId, text: "" };
    commit({ ...snapshot, sessionBusy: true });
    apply([
      userMessage(sessionId, turnId, "Stream please."),
      assistantStarted(sessionId, turnId, itemId, ""),
    ]);
  },

  streamChunk(text = " Streaming growth chunk that adds a full line of content.\n"): void {
    if (!openStream) {
      this.beginStreamingTurn();
    }
    const stream = openStream!;
    stream.text += text;
    apply([assistantDelta(stream.sessionId, stream.turnId, stream.itemId, text)]);
  },

  streamChunks(count: number, textPerChunk?: string): void {
    for (let i = 0; i < count; i += 1) {
      this.streamChunk(textPerChunk);
    }
  },

  streamThoughtStart(): void {
    if (!openStream) {
      this.beginStreamingTurn();
    }
    const stream = openStream!;
    const itemId = `${stream.turnId}-thought`;
    openThought = { sessionId: stream.sessionId, turnId: stream.turnId, itemId, text: "Considering the approach" };
    apply([thoughtStarted(stream.sessionId, stream.turnId, itemId, openThought.text)]);
    apply([thoughtDelta(stream.sessionId, stream.turnId, itemId, " and weighing tradeoffs.")]);
  },

  streamThoughtStop(): void {
    if (!openThought) {
      return;
    }
    const thought = openThought;
    apply([thoughtCompleted(thought.sessionId, thought.turnId, thought.itemId, `${thought.text} and weighing tradeoffs.`)]);
    openThought = null;
  },

  streamToolCall(): void {
    if (!openStream) {
      this.beginStreamingTurn();
    }
    const stream = openStream!;
    apply(smallToolCall(stream.sessionId, stream.turnId, nextSeq()));
  },

  finalizeStreamingTurn(): void {
    if (!openStream) {
      return;
    }
    const stream = openStream;
    apply([assistantCompleted(stream.sessionId, stream.turnId, stream.itemId, stream.text)]);
    openStream = null;
    openThought = null;
    commit({ ...snapshot, sessionBusy: false });
  },

  appendLargeToolOutput(): void {
    const sessionId = snapshot.activeSessionId;
    const turnId = `${sessionId}-tooloutput-${nextSeq()}`;
    apply([
      userMessage(sessionId, turnId, "Run the build."),
      ...largeToolInvocation(sessionId, turnId),
      turnEnded(sessionId, turnId),
    ]);
  },

  appendCodeBlockTurn(): void {
    const sessionId = snapshot.activeSessionId;
    const turnId = `${sessionId}-code-${nextSeq()}`;
    const itemId = `${turnId}-assistant`;
    apply([
      userMessage(sessionId, turnId, "Write the module."),
      assistantCompleted(sessionId, turnId, itemId, codeBlockText(`gen${nextSeq()}`)),
      turnEnded(sessionId, turnId),
    ]);
  },

  // Rung 5 (PRO-187) estimate-bounce fixture: appends ONE turn whose tool
  // calls fold into a single collapsed_actions row (a compact disclosure,
  // NOT `toolCallCount` full-size rows) so the OLD flat 360px-per-row
  // estimate over-guesses this row's height, while the composition estimate
  // (transcript-row-height-estimate.ts) recognizes the collapsed-ledger
  // shape and estimates close to its true compact size. Returns the turnId
  // so a spec can target the row for scroll-into-view.
  appendCollapsedToolLedgerTurn(toolCallCount = 30): string {
    const sessionId = snapshot.activeSessionId;
    const turnId = `${sessionId}-toolledger-${nextSeq()}`;
    apply(collapsedToolLedgerTurn(sessionId, turnId, toolCallCount));
    return turnId;
  },

  // Appends `turns` finalized user+assistant turns AFTER whatever is already in
  // the transcript (unlike seedFinalizedConversation, which REPLACES it). Each
  // hydrates inert (turn_ended), so it renders its full tall height in the
  // commit it lands: a deterministic source of real, immediately-measured
  // content growth with no dependence on the throttled assistant reveal (used
  // by no-false-unpin), and it also pushes an already-appended row off the top
  // of the viewport so scrolling back up mounts it mid-scroll.
  appendFinalizedTurns(turns: number): void {
    const sessionId = snapshot.activeSessionId;
    const batch: SessionEventEnvelope[] = [];
    for (let t = 0; t < turns; t += 1) {
      const turnId = `${sessionId}-fill-${nextSeq()}`;
      const assistantItemId = `${turnId}-assistant`;
      batch.push(userMessage(sessionId, turnId, `Prompt fill ${t}: please continue.`));
      batch.push(assistantCompleted(sessionId, turnId, assistantItemId, tallText(`Fill ${t}`)));
      batch.push(turnEnded(sessionId, turnId));
    }
    apply(batch);
  },

  prependOlderHistory(turns = 3): void {
    if (olderReservoir <= 0) {
      return;
    }
    // Record evidence only for the FIRST prepend after a reset, so a spec can
    // measure a single, unambiguous anchor event even if the reservoir would
    // admit more.
    if (lastPrependEvidence === null) {
      const pre = metrics();
      lastPrependEvidence = { preScrollTop: pre.scrollTop, preScrollHeight: pre.scrollHeight };
    }
    const count = Math.min(turns, olderReservoir);
    olderReservoir -= count;
    const sessionId = snapshot.activeSessionId;
    const older = buildFinalizedConversation(`${sessionId}-older-${nextSeq()}`, count);
    commit({
      ...snapshot,
      transcript: mergeOlderBefore(older, snapshot.transcript),
      hasOlderHistory: olderReservoir > 0,
      // Change the cursor so the transcript's per-cursor de-dup will admit a
      // subsequent request; null once the reservoir is exhausted.
      olderHistoryCursor: olderReservoir > 0 ? olderReservoir : null,
    });
  },

  switchSession(sessionId: string, seedTurns: number): void {
    this.seedFinalizedConversation(seedTurns, sessionId);
  },

  // FR-2 (rung 6): revisit a session that is actively STREAMING. Seeds the
  // session content (same deterministic row keys as a finalized revisit) but
  // marks it busy, so the revisit must bottom-pin regardless of any saved
  // reading position — the streaming arm of the FR-2 contract.
  switchSessionStreaming(sessionId: string, seedTurns: number): void {
    this.seedFinalizedConversation(seedTurns, sessionId);
    commit({ ...snapshot, sessionBusy: true });
  },

  setComposerInset(structuralInsetPx: number): void {
    commit({ ...snapshot, structuralInsetPx: Math.max(0, structuralInsetPx) });
  },

  setOverlayInset(nonDisplacingInsetPx: number): void {
    commit({ ...snapshot, nonDisplacingInsetPx: Math.max(0, nonDisplacingInsetPx) });
  },

  getMetrics(): ViewportMetrics {
    return metrics();
  },

  // Rung 8 (PRO-187, PRO-258) nested-scroll-chaining probe. Playwright's
  // `page.mouse.wheel` is unreliable on WebKit for this gesture (real wheel
  // physics differ per engine and momentum/edge-detection timing is not
  // portable), so this drives the SAME mechanics used elsewhere in this file
  // (`gestureScrollToBottomDistance`): a direct scrollTop write establishes
  // ground truth (the nested code-block viewport is already at ITS OWN
  // bottom edge, exactly the state a real user's prior scrolling would leave
  // it in), then a real `WheelEvent` dispatched on that inner element is
  // trusted by the product's own onWheel handler (untrusted synthetic events
  // still run addEventListener/React onWheel handlers) without depending on
  // the browser's default wheel-scroll action, which a JS-dispatched
  // WheelEvent does not trigger. `chainVerticalWheelScroll` reads the inner
  // element's edge state (now at the bottom, matching the deltaY>0 direction)
  // and writes the delta onto the first scrollable ancestor directly — the
  // outer transcript viewport — which is the literal chaining behavior under
  // test, engine-portable because no engine-specific wheel-physics scaling is
  // involved on either side of the chain.
  chainWheelPastNestedCodeBlock(deltaY = 400): { before: number; after: number } | null {
    const inner = document.querySelector<HTMLElement>(
      '[data-markdown-code-content="true"]',
    );
    if (!inner) {
      return null;
    }
    inner.scrollTop = Math.max(0, inner.scrollHeight - inner.clientHeight);
    const outer = viewport();
    const before = outer ? outer.scrollTop : 0;
    inner.dispatchEvent(
      new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true }),
    );
    const after = outer ? outer.scrollTop : 0;
    return { before, after };
  },

  // Estimate-immune reading-position probe: the text of the transcript row
  // under the viewport's top edge. FR-2 restores {rowKey, offsetWithinRow}, so
  // the correct restore lands the SAME row under the top edge even when the
  // off-screen rows above it are estimated to a different total (a raw scrollTop
  // would differ; the row under the top edge is the observable invariant).
  getTopVisibleText(): string | null {
    const el = viewport();
    if (!el) {
      return null;
    }
    const rect = el.getBoundingClientRect();
    const probe = document.elementFromPoint(rect.left + rect.width / 2, rect.top + 4);
    if (!probe) {
      return null;
    }
    const row = probe.closest("[data-index]") ?? probe;
    // Strip the volatile relative timestamp ("Dec 31 · 4:00 pm") so this probe is
    // a STABLE reading-position identity across the fixture's re-seeds: the
    // seq-derived timestamps advance on a global counter, so the same turn
    // renders a later time on a second seed, but its row key and prompt/reply
    // text do not change. FR-2 restores by row key, so the row is identical; only
    // this rendered timestamp would differ, which is not a reading-position move.
    const text = (row.textContent ?? "").replace(
      /[A-Z][a-z]{2} \d{1,2} · \d{1,2}:\d{2} ?[ap]m/gi,
      "",
    );
    return text.trim().slice(0, 48);
  },

  // Engine-portable pin-to-bottom baseline: sets scrollTop directly, which
  // fires a real, trusted native `scroll` event (unlike a JS-dispatched
  // synthetic WheelEvent, which does not trigger the browser's default wheel
  // scroll action). The transcript's own scroll classification re-pins from
  // ANY scroll event that lands inside the repin band, so this is equivalent
  // to a real bottom-directed gesture for baseline purposes.
  scrollToBottomInstant(): void {
    const el = viewport();
    if (!el) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  },

  // Forces every row between the current position and the top to mount and
  // be measured for real (used by the rung 5 estimate-accuracy fixture to
  // replace an off-screen row's ESTIMATE with its REAL measured height).
  scrollToTopInstant(): void {
    const el = viewport();
    if (!el) {
      return;
    }
    el.scrollTop = 0;
  },

  // Steps scrollTop from 0 to the bottom in viewport-sized increments,
  // pausing at each step, so EVERY row mounts and gets measured for real at
  // least once (a single scrollToTopInstant only forces the rows near the
  // top into view/overscan; rows further down stay virtualized-out and
  // still contribute their ESTIMATE, not a real measurement, to totalSize).
  // Used by the rung 5 (PRO-187) estimate-accuracy fixture to establish a
  // ground-truth "real" total content height to compare an all-estimated
  // initial mount against.
  async sweepEveryRowIntoView(stepDelayMs = 40): Promise<void> {
    const el = viewport();
    if (!el) {
      return;
    }
    el.scrollTop = 0;
    await new Promise((resolve) => setTimeout(resolve, stepDelayMs));
    let guard = 0;
    while (guard < 500) {
      const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
      if (el.scrollTop >= maxTop) {
        break;
      }
      el.scrollTop = Math.min(maxTop, el.scrollTop + el.clientHeight);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, stepDelayMs));
      guard += 1;
    }
  },

  // Engine-portable downward user gesture that lands at a chosen distance
  // from the bottom, for asserting the repin band EDGE (rather than only the
  // hard bottom `scrollToBottomInstant` gives you) and for a controlled
  // downward nudge that stays clear of the band. A real WheelEvent (untrusted
  // synthetic events still run addEventListener handlers, so the component's
  // own wheel-intent listener classifies this as user intent) claims downward
  // intent, then the scrollTop write lands at the requested distance and
  // fires a real, trusted native `scroll` event the transcript's pin
  // classification keys off of.
  gestureScrollToBottomDistance(distancePx: number): void {
    const el = viewport();
    if (!el) {
      return;
    }
    el.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true }),
    );
    const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    const targetTop = Math.max(0, Math.min(maxTop, maxTop - distancePx));
    el.scrollTop = targetTop;
  },

  isPinned(): boolean | null {
    const btn = document.querySelector('[aria-label="Scroll to bottom"]');
    if (!btn) {
      return null;
    }
    return btn.getAttribute("aria-hidden") === "true";
  },

  // Rung 9 (PRO-187, Q18): whether the new-content accent is showing on the
  // scroll-to-latest button right now, read from its own marker element
  // rather than inferred from any other DOM state.
  hasNewContentIndicator(): boolean {
    return document.querySelector("[data-transcript-new-content-indicator]") !== null;
  },

  // Rung 9 (PRO-187, Q18): a real click on the floating "Scroll to bottom"
  // control (untrusted synthetic clicks still run addEventListener/React
  // onClick handlers), so this exercises the product's own click handler
  // end-to-end rather than calling an engine method directly.
  clickScrollToBottom(): void {
    const btn = document.querySelector<HTMLElement>('[aria-label="Scroll to bottom"]');
    btn?.click();
  },

  getLastPrependEvidence(): { preScrollTop: number; preScrollHeight: number } | null {
    return lastPrependEvidence;
  },

  getScrollSamples(): ScrollSample[] {
    return scrollSamples.slice();
  },

  clearScrollSamples(): void {
    scrollSamples.length = 0;
  },

  startScrollTrace(): void {
    traceFrames = [];
    bottomDistanceFrames = [];
    traceActive = true;
    traceRafId = requestAnimationFrame(traceTick);
  },

  stopScrollTrace(): number[] {
    traceActive = false;
    if (traceRafId) {
      cancelAnimationFrame(traceRafId);
      traceRafId = 0;
    }
    return traceFrames.slice();
  },

  stopBottomDistanceTrace(): number[] {
    traceActive = false;
    if (traceRafId) {
      cancelAnimationFrame(traceRafId);
      traceRafId = 0;
    }
    return bottomDistanceFrames.slice();
  },

  startContentHeightTrace(): void {
    heightTraceFrames = [];
    heightTraceActive = true;
    heightTraceRafId = requestAnimationFrame(heightTraceTick);
  },

  stopContentHeightTrace(): number[] {
    heightTraceActive = false;
    if (heightTraceRafId) {
      cancelAnimationFrame(heightTraceRafId);
      heightTraceRafId = 0;
    }
    return heightTraceFrames.slice();
  },

  hasViewport(): boolean {
    return viewport() !== null;
  },
};

declare global {
  interface Window {
    __scrollPhysics: ScrollPhysicsDriver;
  }
}
