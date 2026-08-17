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

export interface HostSnapshot {
  transcript: TranscriptState;
  activeSessionId: string;
  hasOlderHistory: boolean;
  // A non-null cursor is required for the transcript to actually request older
  // history (see maybeLoadOlderHistory). It changes on each prepend so the
  // component's per-cursor de-dup admits the next request.
  olderHistoryCursor: number | null;
  sessionBusy: boolean;
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
};

const listeners = new Set<() => void>();
const scrollSamples: ScrollSample[] = [];

// Streaming bookkeeping for the currently-open assistant item.
let openStream: { sessionId: string; turnId: string; itemId: string; text: string } | null = null;

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
let traceFrames: number[] = [];
let traceRafId = 0;
let traceActive = false;

function traceTick(): void {
  if (!traceActive) {
    return;
  }
  const el = viewport();
  traceFrames.push(el ? el.scrollTop : Number.NaN);
  traceRafId = requestAnimationFrame(traceTick);
}

export interface ScrollPhysicsDriver {
  readonly primarySession: string;
  readonly secondarySession: string;
  reset(sessionId?: string): void;
  seedFinalizedConversation(turns: number, sessionId?: string): void;
  setHasOlderHistory(hasOlder: boolean, reservoirTurns?: number): void;
  beginStreamingTurn(): void;
  streamChunk(text?: string): void;
  streamChunks(count: number, textPerChunk?: string): void;
  finalizeStreamingTurn(): void;
  appendLargeToolOutput(): void;
  appendCodeBlockTurn(): void;
  appendFinalizedTurns(turns: number): void;
  prependOlderHistory(turns?: number): void;
  switchSession(sessionId: string, seedTurns: number): void;
  getMetrics(): ViewportMetrics;
  scrollToBottomInstant(): void;
  gestureScrollToBottomDistance(distancePx: number): void;
  // True pin state, read from the floating "Scroll to bottom" control, which is
  // aria-hidden exactly when pinned to bottom. Returns null if the control is
  // not present.
  isPinned(): boolean | null;
  getLastPrependEvidence(): { preScrollTop: number; preScrollHeight: number } | null;
  getScrollSamples(): ScrollSample[];
  clearScrollSamples(): void;
  startScrollTrace(): void;
  stopScrollTrace(): number[];
  hasViewport(): boolean;
}

export const scrollPhysicsDriver: ScrollPhysicsDriver = {
  primarySession: PRIMARY_SESSION,
  secondarySession: SECONDARY_SESSION,

  reset(sessionId?: string): void {
    resetCounter += 1;
    currentSessionId = sessionId ?? `${PRIMARY_SESSION}-${resetCounter}`;
    openStream = null;
    olderReservoir = 0;
    lastPrependEvidence = null;
    scrollSamples.length = 0;
    commit({
      transcript: createTranscriptState(currentSessionId),
      activeSessionId: currentSessionId,
      hasOlderHistory: false,
      olderHistoryCursor: null,
      sessionBusy: false,
    });
  },

  seedFinalizedConversation(turns: number, sessionId?: string): void {
    const id = sessionId ?? currentSessionId;
    currentSessionId = id;
    openStream = null;
    commit({
      ...snapshot,
      transcript: buildFinalizedConversation(id, turns),
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

  finalizeStreamingTurn(): void {
    if (!openStream) {
      return;
    }
    const stream = openStream;
    apply([assistantCompleted(stream.sessionId, stream.turnId, stream.itemId, stream.text)]);
    openStream = null;
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

  // Appends `turns` finalized user+assistant turns AFTER whatever is already in
  // the transcript (unlike seedFinalizedConversation, which REPLACES it). Each
  // hydrates inert (turn_ended), so it renders its full tall height in the
  // commit it lands: a deterministic source of real, immediately-measured
  // content growth with no dependence on the throttled assistant reveal.
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

  getMetrics(): ViewportMetrics {
    return metrics();
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

  hasViewport(): boolean {
    return viewport() !== null;
  },
};

declare global {
  interface Window {
    __scrollPhysics: ScrollPhysicsDriver;
  }
}
