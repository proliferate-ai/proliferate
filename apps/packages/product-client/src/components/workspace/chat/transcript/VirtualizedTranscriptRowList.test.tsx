/* @vitest-environment jsdom */

import { createRef, useLayoutEffect } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptVirtualRow } from "#product/domain/chats/transcript/transcript-virtual-rows";
import { createLargeInterruptedCompletedTurnFixture } from "#product/domain/chats/transcript/transcript-presentation-test-fixtures";
import { buildTranscriptRowModel } from "#product/domain/chats/transcript/transcript-row-model";
import { VirtualizedTranscriptRowList } from "./VirtualizedTranscriptRowList";

const observedVirtualizerOptions = vi.hoisted(() => [] as Array<{
  estimateSize: unknown;
  getItemKey: unknown;
}>);

vi.mock("@tanstack/react-virtual", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-virtual")>();
  return {
    ...actual,
    useVirtualizer: (
      options: Parameters<typeof actual.useVirtualizer>[0],
    ) => {
      observedVirtualizerOptions.push({
        estimateSize: options.estimateSize,
        getItemKey: options.getItemKey,
      });
      return actual.useVirtualizer(options);
    },
  };
});

// jsdom surfaces no virtual items, so the real useTranscriptVirtualAnchorCapture
// never populates its ref there, and the real useTranscriptCompletedTurnAnchor
// nulls whatever it reads regardless of outcome — so observing the ref's final
// value can't distinguish "invalidated by the prepend fix" from "consumed by
// the completed-turn-split branch this fix must prevent." Replace the
// CONSUMER with a fake that has its OWN useLayoutEffect (same hook-order
// contract as the real one: it runs after the prepend effect above it in
// VirtualizedTranscriptRowList.tsx) and records exactly what it saw.
const completedTurnAnchorObservations = vi.hoisted(() => [] as Array<{ key: string } | null>);
vi.mock("#product/hooks/chat/ui/use-transcript-completed-turn-anchor", () => ({
  useTranscriptCompletedTurnAnchor: ({
    pendingAnchorRef,
  }: {
    pendingAnchorRef: { current: { key: string } | null };
  }) => {
    useLayoutEffect(() => {
      completedTurnAnchorObservations.push(pendingAnchorRef.current);
      pendingAnchorRef.current = null;
    });
  },
}));

const completedTurnAnchorRef = vi.hoisted(
  () => ({ current: null }) as { current: { key: string } | null },
);
vi.mock("#product/hooks/chat/ui/use-transcript-virtual-anchor-capture", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("#product/hooks/chat/ui/use-transcript-virtual-anchor-capture")
  >();
  return {
    ...actual,
    useTranscriptVirtualAnchorCapture: () => completedTurnAnchorRef,
  };
});

const ROWS: TranscriptVirtualRow[] = [
  { kind: "pending_prompt", key: "pending-prompt:session-1" },
];

// @tanstack/virtual-core's isScrolling-reset debounce (`utils.ts`
// `debounce`) arms a real `targetWindow.setTimeout` on "scroll" and never
// cancels it on unmount, so a late scroll leaves it pending past
// `cleanup()`. If it fires after vitest tears down jsdom's `window`,
// react-dom's `resolveUpdatePriority` throws, failing the whole CI shard
// even though every test passed (CI run 32450933492, job 96679196436).
//
// Track every timer armed on `window` per test and cancel whatever is still
// outstanding before `cleanup()`, so it is cancelled outright, not raced.
let pendingWindowTimeoutIds: Set<ReturnType<typeof setTimeout>>;
let realWindowSetTimeout: typeof window.setTimeout;
let realWindowClearTimeout: typeof window.clearTimeout;

beforeEach(() => {
  observedVirtualizerOptions.length = 0;
  completedTurnAnchorRef.current = null;
  completedTurnAnchorObservations.length = 0;
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", TestResizeObserver);

  pendingWindowTimeoutIds = new Set();
  realWindowSetTimeout = window.setTimeout.bind(window);
  realWindowClearTimeout = window.clearTimeout.bind(window);
  window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const id = realWindowSetTimeout(() => {
      pendingWindowTimeoutIds.delete(id);
      (handler as (...a: unknown[]) => void)(...args);
    }, timeout);
    pendingWindowTimeoutIds.add(id);
    return id;
  }) as typeof window.setTimeout;
  window.clearTimeout = ((id?: Parameters<typeof window.clearTimeout>[0]) => {
    if (id !== undefined) {
      pendingWindowTimeoutIds.delete(id as ReturnType<typeof setTimeout>);
    }
    return realWindowClearTimeout(id);
  }) as typeof window.clearTimeout;
});

afterEach(() => {
  // Drain, unmount, drain again, and only then restore. cleanup() runs
  // unmount-time effect cleanups, and one of those could itself arm a timer;
  // restoring the native functions before cleanup() would let such a timer
  // slip through untracked, reopening the exact bug class this file guards
  // against from a different source (review finding on #2162).
  pendingWindowTimeoutIds.forEach((id) => realWindowClearTimeout(id));
  pendingWindowTimeoutIds.clear();
  cleanup();
  pendingWindowTimeoutIds.forEach((id) => realWindowClearTimeout(id));
  pendingWindowTimeoutIds.clear();
  window.setTimeout = realWindowSetTimeout;
  window.clearTimeout = realWindowClearTimeout;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeProps(rows: readonly TranscriptVirtualRow[] = ROWS) {
  return {
    rows,
    selectionRootRef: createRef<HTMLDivElement>(),
    hasOlderHistory: false,
    isLoadingOlderHistory: false,
    olderHistoryCursor: null,
    bottomInsetPx: 0,
    selectedWorkspaceId: "workspace-1",
    activeSessionId: "session-1",
    isSessionBusy: false,
    lastPromptSubmittedAtMs: null,
    onLoadOlderHistory: vi.fn(),
    onScrollSample: vi.fn(),
    renderRow: (row: TranscriptVirtualRow) => <div>{row.key}</div>,
    onFallback: vi.fn(),
    virtualizationMode: "on" as const,
  };
}

function getViewport(container: HTMLElement): HTMLDivElement {
  const viewport = container.querySelector<HTMLDivElement>(".scrollbar-none");
  expect(viewport).toBeTruthy();
  return viewport!;
}

describe("VirtualizedTranscriptRowList", () => {
  // jsdom does no layout, so the tanstack virtualizer surfaces no virtual items
  // here; these are wiring smoke tests, not layout/measurement tests.
  it("keeps the complete transcript row stack visibly selectable", () => {
    const { container } = render(<VirtualizedTranscriptRowList {...makeProps()} />);
    const selectionRoot = container.querySelector<HTMLElement>(
      '[data-chat-transcript-root="true"]',
    );

    expect(selectionRoot?.classList.contains("select-text")).toBe(true);
    expect(selectionRoot?.classList.contains("select-none")).toBe(false);
  });

  it("mounts and starts pinned (scroll-to-bottom affordance hidden)", () => {
    const { container } = render(<VirtualizedTranscriptRowList {...makeProps()} />);
    const button = container.querySelector('[aria-label="Scroll to bottom"]');
    expect(button).toBeTruthy();
    expect(button?.getAttribute("aria-hidden")).toBe("true");
  });

  it("preserves measurement accessors across an unchanged scroll render", () => {
    const props = makeProps();
    const rendered = render(<VirtualizedTranscriptRowList {...props} />);
    const firstOptions = observedVirtualizerOptions.at(-1);
    const optionCountBeforeScroll = observedVirtualizerOptions.length;
    expect(firstOptions).toBeTruthy();

    const viewport = getViewport(rendered.container);
    Object.defineProperty(viewport, "clientHeight", { value: 300, configurable: true });
    Object.defineProperty(viewport, "scrollHeight", { value: 2_000, configurable: true });
    viewport.scrollTop = 120;
    act(() => {
      fireEvent.scroll(viewport);
    });
    const nextOptions = observedVirtualizerOptions.at(-1);

    expect(observedVirtualizerOptions.length).toBeGreaterThan(optionCountBeforeScroll);
    expect(nextOptions?.getItemKey).toBe(firstOptions?.getItemKey);
    expect(nextOptions?.estimateSize).toBe(firstOptions?.estimateSize);
  });

  it("keeps large interrupted-turn row keys unique across hydration and upward scroll", () => {
    const fixture = createLargeInterruptedCompletedTurnFixture();
    const rows = buildTranscriptRowModel({
      activeSessionId: fixture.transcript.sessionMeta.sessionId,
      transcript: fixture.transcript,
      visibleOptimisticPrompt: null,
      latestTurnId: fixture.turn.turnId,
      latestTurnHasAssistantRenderableContent: true,
    });
    const expectedKeys = rows.map((row) => row.key);
    const rendered = render(
      <VirtualizedTranscriptRowList {...makeProps(rows)} />,
    );
    const initialOptions = observedVirtualizerOptions.at(-1);
    const initialGetItemKey = initialOptions?.getItemKey as
      | ((index: number) => unknown)
      | undefined;
    expect(initialGetItemKey).toBeTruthy();

    // This delegates to the real TanStack virtualizer. Its configured accessor
    // is the index-to-row identity contract used by measurement and scrolling.
    const initialKeys = rows.map((_, index) => initialGetItemKey!(index));
    expect(initialKeys).toEqual(expectedKeys);
    expect(new Set(initialKeys).size).toBe(initialKeys.length);

    const optionCountBeforeScroll = observedVirtualizerOptions.length;
    const viewport = getViewport(rendered.container);
    Object.defineProperty(viewport, "clientHeight", { value: 300, configurable: true });
    Object.defineProperty(viewport, "scrollHeight", { value: 2_000, configurable: true });
    viewport.scrollTop = 1_200;
    act(() => {
      fireEvent.wheel(viewport, { deltaY: -80 });
      viewport.scrollTop = 1_120;
      fireEvent.scroll(viewport);
    });

    const postScrollOptions = observedVirtualizerOptions.at(-1);
    const postScrollGetItemKey = postScrollOptions?.getItemKey as
      | ((index: number) => unknown)
      | undefined;
    expect(observedVirtualizerOptions.length).toBeGreaterThan(optionCountBeforeScroll);
    expect(postScrollGetItemKey).toBe(initialGetItemKey);
    const postScrollKeys = rows.map((_, index) => postScrollGetItemKey!(index));
    expect(postScrollKeys).toEqual(expectedKeys);
    expect(new Set(postScrollKeys).size).toBe(postScrollKeys.length);
  });

  it("rotates getItemKey only on an ordered-key change, estimateSize also on a session change", () => {
    const props = makeProps();
    const rendered = render(<VirtualizedTranscriptRowList {...props} />);
    const firstOptions = observedVirtualizerOptions.at(-1);

    // A new rows array with the SAME ordered keys is content-only churn: neither
    // accessor may rotate (rotating getItemKey/estimateSize forces TanStack to
    // rebuild every item position, the extra layout pass that stranded the snap,
    // PRO-187 r5).
    rendered.rerender(
      <VirtualizedTranscriptRowList
        {...props}
        rows={ROWS.map((row) => ({ ...row }))}
      />,
    );
    const contentUpdateOptions = observedVirtualizerOptions.at(-1);
    expect(contentUpdateOptions?.getItemKey).toBe(firstOptions?.getItemKey);
    expect(contentUpdateOptions?.estimateSize).toBe(firstOptions?.estimateSize);

    // A session change with the SAME ordered keys re-scopes the measured-height
    // cache lookups, so estimateSize (which reads the session-scoped cache)
    // rotates; getItemKey keys purely on the ordered row keys, so it does NOT.
    rendered.rerender(
      <VirtualizedTranscriptRowList
        {...props}
        activeSessionId="session-2"
      />,
    );
    const sessionUpdateOptions = observedVirtualizerOptions.at(-1);
    expect(sessionUpdateOptions?.getItemKey).toBe(firstOptions?.getItemKey);
    expect(sessionUpdateOptions?.estimateSize).not.toBe(firstOptions?.estimateSize);

    // A change to the ordered set of row keys is a structural change TanStack
    // must re-key on: both accessors rotate.
    rendered.rerender(
      <VirtualizedTranscriptRowList
        {...props}
        activeSessionId="session-2"
        rows={[
          ...ROWS,
          { kind: "pending_prompt", key: "pending-prompt:session-2" },
        ]}
      />,
    );
    const compositionUpdateOptions = observedVirtualizerOptions.at(-1);
    expect(compositionUpdateOptions?.getItemKey).not.toBe(sessionUpdateOptions?.getItemKey);
    expect(compositionUpdateOptions?.estimateSize).not.toBe(sessionUpdateOptions?.estimateSize);
  });

  it("reveals the scroll-to-bottom affordance after a user wheels up", () => {
    const { container } = render(<VirtualizedTranscriptRowList {...makeProps()} />);
    const viewport = getViewport(container);
    Object.defineProperty(viewport, "scrollHeight", { value: 2000, configurable: true });
    Object.defineProperty(viewport, "clientHeight", { value: 300, configurable: true });
    viewport.scrollTop = 1_700;

    act(() => {
      fireEvent.wheel(viewport, { deltaY: -80 });
    });

    const button = container.querySelector('[aria-label="Scroll to bottom"]');
    expect(button?.getAttribute("aria-hidden")).toBe("false");
  });

  it("re-pins to the bottom on prompt submit even if the pin was already lost", () => {
    const props = makeProps();
    const { container, rerender } = render(<VirtualizedTranscriptRowList {...props} />);
    const viewport = getViewport(container);
    const button = container.querySelector('[aria-label="Scroll to bottom"]');
    Object.defineProperty(viewport, "scrollHeight", { value: 2000, configurable: true });
    Object.defineProperty(viewport, "clientHeight", { value: 300, configurable: true });
    // Short of the reachable bottom (2000 - 300 = 1700) so the re-pin below
    // has an actual scrollTop write to assert on, not a same-position no-op.
    viewport.scrollTop = 1_400;

    act(() => {
      fireEvent.wheel(viewport, { deltaY: -80 });
    });
    expect(button?.getAttribute("aria-hidden")).toBe("false");

    // A rising submission stamp is an explicit return-to-bottom intent; it
    // must re-pin even though the user scrolled away and the pin was never
    // re-earned.
    rerender(
      <VirtualizedTranscriptRowList {...props} lastPromptSubmittedAtMs={1_000} />,
    );

    expect(viewport.scrollTop).toBe(2000);
    expect(button?.getAttribute("aria-hidden")).toBe("true");
  });

  it("does not re-pin when the newest submission stamp falls (entry left the outbox)", () => {
    const props = { ...makeProps(), lastPromptSubmittedAtMs: 2_000 };
    const { container, rerender } = render(<VirtualizedTranscriptRowList {...props} />);
    const viewport = getViewport(container);
    const button = container.querySelector('[aria-label="Scroll to bottom"]');
    Object.defineProperty(viewport, "scrollHeight", { value: 2000, configurable: true });
    Object.defineProperty(viewport, "clientHeight", { value: 300, configurable: true });
    viewport.scrollTop = 1_400;

    act(() => {
      fireEvent.wheel(viewport, { deltaY: -80 });
    });
    expect(button?.getAttribute("aria-hidden")).toBe("false");

    // The newest entry leaving the outbox (delivery, dismissal) lowers the
    // stamp; that is not a submit and must not fight the user's position.
    rerender(
      <VirtualizedTranscriptRowList {...props} lastPromptSubmittedAtMs={1_000} />,
    );
    expect(viewport.scrollTop).toBe(1_400);
    expect(button?.getAttribute("aria-hidden")).toBe("false");

    // The next real submit raises it past every stamp seen before — re-pin.
    rerender(
      <VirtualizedTranscriptRowList {...props} lastPromptSubmittedAtMs={3_000} />,
    );
    expect(viewport.scrollTop).toBe(2000);
    expect(button?.getAttribute("aria-hidden")).toBe("true");
  });

  // Regression coverage for the CI webkit bimodal failure (PRO-187, r10 CI
  // round: "prepend anchoring: older-history prepend keeps the reading row
  // fixed", trace evidence from #1992/#1993 both showing scrollTop hard-reset
  // to exactly 0 well inside the 3s blank-fallback grace window, ruling out a
  // virtualizer remount as the cause — see trace timeline in the PR comment).
  // The FIRST synchronous prepend-anchor write
  // (`viewport.scrollTop = anchor.scrollTop + (viewport.scrollHeight -
  // anchor.scrollHeight)`) ran unclamped: on a slow/loaded runner the
  // just-committed DOM's scrollHeight can transiently undershoot
  // anchor.scrollHeight (the freshly-mounted older rows are still
  // estimate-coordinate one frame before layout/measurement lands), producing
  // a negative delta the browser silently clamps to 0 — a full loss of the
  // reading position. This never showed up as a negative scrollTop in the
  // trace because the browser clamp masks it; it shows up as scrollTop 0
  // regardless of how negative the raw delta was.
  it("prepend anchor write never drops scrollTop below its pre-prepend value even if scrollHeight transiently undershoots", () => {
    const props = { ...makeProps(), hasOlderHistory: true, olderHistoryCursor: 1 };
    const { container, rerender } = render(<VirtualizedTranscriptRowList {...props} />);
    const viewport = getViewport(container);
    Object.defineProperty(viewport, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(viewport, "scrollHeight", { value: 5_552, configurable: true });
    viewport.scrollTop = 464;

    // Cross the older-history prefetch threshold: arms pendingPrependAnchorRef
    // with { scrollTop: 464, scrollHeight: 5552 } and fires onLoadOlderHistory.
    act(() => {
      fireEvent.scroll(viewport);
    });
    expect(props.onLoadOlderHistory).toHaveBeenCalledTimes(1);

    // The prepend lands: rowCount grows AND, on this exact commit, the
    // virtualizer's just-committed total transiently reports LESS than the
    // anchor's captured pre-prepend scrollHeight (the pathological case this
    // guard exists for). Negative control: remove the `Math.max(delta, 0)`
    // clamp in VirtualizedTranscriptRowList.tsx and this assertion fails with
    // scrollTop 0 instead of 464.
    Object.defineProperty(viewport, "scrollHeight", { value: 5_000, configurable: true });
    rerender(
      <VirtualizedTranscriptRowList
        {...props}
        rows={[...ROWS, { kind: "pending_prompt", key: "pending-prompt:session-1-older" }]}
      />,
    );

    expect(viewport.scrollTop).toBe(464);
  });

  // Second regression, found AFTER the above fix landed and the identical CI
  // webkit failure (scrollTop Received 0) recurred at the exact same trace
  // numbers: useTranscriptCompletedTurnAnchor runs its own layout effect right
  // after this one (both fire on the same prepend commit, since a prepend also
  // shifts every existing row to a higher index — indistinguishable, to that
  // hook, from its own completed-turn-split case). Left with a stale
  // pre-prepend capture in its ref, it re-arms compensationAnchorRef with
  // cancelableByUpwardIntent=true, clobbering the correctly non-cancelable
  // anchor this effect just installed; wheelToTop's still-in-flight upward
  // gesture then cancels it via notifyUserScrollIntent, and nothing is left to
  // hold scrollTop as the older rows measure in. The fix invalidates that
  // hook's stale capture (`pendingAnchorRef.current = null`) so it no-ops on a
  // prepend commit. Negative control: comment out that line and this
  // assertion regresses to `false` (the completed-turn anchor branch fires).
  it("invalidates the completed-turn-anchor's stale capture on a prepend so it cannot re-arm a cancelable compensation", () => {
    const props = { ...makeProps(), hasOlderHistory: true, olderHistoryCursor: 1 };
    const { container, rerender } = render(<VirtualizedTranscriptRowList {...props} />);
    const viewport = getViewport(container);
    Object.defineProperty(viewport, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(viewport, "scrollHeight", { value: 5_552, configurable: true });
    viewport.scrollTop = 464;

    act(() => {
      fireEvent.scroll(viewport);
    });
    expect(props.onLoadOlderHistory).toHaveBeenCalledTimes(1);

    // Simulate useTranscriptVirtualAnchorCapture's cleanup having captured a
    // stale pre-prepend anchor for the same row the prepend is about to shift
    // to a higher index — exactly what happens on a real prepend commit.
    completedTurnAnchorRef.current = { key: ROWS[0].key };

    act(() => {
      rerender(
        <VirtualizedTranscriptRowList
          {...props}
          rows={[{ kind: "pending_prompt", key: "pending-prompt:session-1-older" }, ...ROWS]}
        />,
      );
    });

    // The fake consumer's layout effect ran once for this commit (after the
    // real prepend effect above it, same hook-order contract) and must have
    // observed the ref already nulled out by the prepend fix — never the
    // stale captured anchor, which would let it re-arm a cancelable
    // compensation and reproduce the CI webkit "scrollTop Received 0" bug.
    expect(completedTurnAnchorObservations.at(-1)).toBeNull();
  });

  // Third regression, found after the previous two fixes when the identical CI
  // webkit failure (scrollTop Received 0) recurred on two independent product
  // heads: the stale-anchor cleanup effect treats "not loading and rows
  // unchanged" as a request that resolved with no rows, but an IN-FLIGHT
  // request looks exactly the same until its answer commits — the fixture (and
  // the real client before its loading flag's own commit lands) never raises
  // isLoadingOlderHistory. Any unrelated commit that re-runs the cleanup in
  // that window (hosted trace: several hundred ms of native-scroll flood
  // between request and answer) silently discards the pending anchor; the
  // prepend then lands with no anchor, no compensation write runs, and the
  // reader is left wherever the native scroll ended (0). Negative control:
  // revert the cleanup to clear on `!isLoadingOlderHistory` alone and this
  // fails with scrollTop 464 instead of the compensated 1820.
  it("keeps an in-flight prepend anchor through unrelated commits until its answer lands", () => {
    const props = { ...makeProps(), hasOlderHistory: true, olderHistoryCursor: 1 };
    const { container, rerender } = render(<VirtualizedTranscriptRowList {...props} />);
    const viewport = getViewport(container);
    Object.defineProperty(viewport, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(viewport, "scrollHeight", { value: 5_552, configurable: true });
    viewport.scrollTop = 464;

    // Cross the prefetch threshold: arms the pending anchor, fires the request.
    act(() => {
      fireEvent.scroll(viewport);
    });
    expect(props.onLoadOlderHistory).toHaveBeenCalledTimes(1);

    // An unrelated commit while the request is still in flight: same rows, not
    // loading, but a fresh onLoadOlderHistory identity (the real parent passes
    // an inline closure, so any parent render produces one). This re-runs the
    // stale-anchor cleanup, which must NOT discard the in-flight anchor.
    act(() => {
      rerender(
        <VirtualizedTranscriptRowList {...props} onLoadOlderHistory={vi.fn()} />,
      );
    });

    // The answer commits: rows grow and the DOM is taller. The prepend effect
    // must still hold the anchor and write the compensated position.
    Object.defineProperty(viewport, "scrollHeight", { value: 6_908, configurable: true });
    act(() => {
      rerender(
        <VirtualizedTranscriptRowList
          {...props}
          rows={[{ kind: "pending_prompt", key: "pending-prompt:session-1-older" }, ...ROWS]}
        />,
      );
    });

    expect(viewport.scrollTop).toBe(464 + (6_908 - 5_552));
  });

  // The cleanup's legitimate job stays intact: a request that RESOLVED with no
  // rows (loading observed true, then false, rows unchanged) releases the
  // pending anchor so the settled-probe can run again.
  it("releases a prepend anchor whose request resolved without rows", () => {
    const props = { ...makeProps(), hasOlderHistory: true, olderHistoryCursor: 1 };
    const { container, rerender } = render(<VirtualizedTranscriptRowList {...props} />);
    const viewport = getViewport(container);
    Object.defineProperty(viewport, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(viewport, "scrollHeight", { value: 5_552, configurable: true });
    viewport.scrollTop = 464;
    act(() => {
      fireEvent.scroll(viewport);
    });
    expect(props.onLoadOlderHistory).toHaveBeenCalledTimes(1);

    // The request's loading window opens, then closes with no rows.
    act(() => {
      rerender(<VirtualizedTranscriptRowList {...props} isLoadingOlderHistory={true} />);
    });
    act(() => {
      rerender(<VirtualizedTranscriptRowList {...props} isLoadingOlderHistory={false} />);
    });

    // A later prepend commit finds no lingering anchor: no compensation write.
    Object.defineProperty(viewport, "scrollHeight", { value: 6_908, configurable: true });
    act(() => {
      rerender(
        <VirtualizedTranscriptRowList
          {...props}
          rows={[{ kind: "pending_prompt", key: "pending-prompt:session-1-older" }, ...ROWS]}
        />,
      );
    });
    expect(viewport.scrollTop).toBe(464);
  });

  it("adds an overlay spacer without changing the current scroll position", () => {
    const props = makeProps();
    const { container, rerender } = render(
      <VirtualizedTranscriptRowList {...props} />,
    );
    const viewport = getViewport(container);
    Object.defineProperty(viewport, "scrollHeight", { value: 1_000, configurable: true });
    viewport.scrollTop = 600;

    rerender(
      <VirtualizedTranscriptRowList
        {...props}
        bottomInsetPx={160}
        nonDisplacingBottomInsetPx={160}
      />,
    );

    expect(viewport.scrollTop).toBe(600);
    expect(
      container.querySelector<HTMLElement>("[data-transcript-bottom-overlay-inset]")?.style.height,
    ).toBe("160px");
    const transcript = container.querySelector<HTMLElement>("[data-transcript-virtualization-mode='virtual']");
    expect(transcript?.className ?? "").not.toContain("mt-auto");
    expect(transcript?.parentElement?.className).toContain("relative flex min-h-full flex-col");
    expect(
      container.querySelector<HTMLElement>("[data-transcript-bottom-overlay-inset]")?.className,
    ).toContain("absolute inset-x-0 top-full");
  });
});
