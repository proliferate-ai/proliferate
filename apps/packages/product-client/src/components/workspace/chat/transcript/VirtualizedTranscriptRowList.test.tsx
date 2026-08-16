/* @vitest-environment jsdom */

import { createRef } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptVirtualRow } from "#product/domain/chats/transcript/transcript-virtual-rows";
import { createPro292CompletedTurnFixture } from "#product/domain/chats/transcript/transcript-presentation-test-fixtures";
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

const ROWS: TranscriptVirtualRow[] = [
  { kind: "pending_prompt", key: "pending-prompt:session-1" },
];

beforeEach(() => {
  observedVirtualizerOptions.length = 0;
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
});

afterEach(() => {
  cleanup();
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

  it("keeps PRO-292 production row keys unique across hydration and upward scroll", () => {
    const fixture = createPro292CompletedTurnFixture();
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

    // The wrapper delegates to the real TanStack virtualizer. Evaluating its
    // configured accessor for every production row preserves the ordered
    // index-to-row mapping that measurement and scroll identity consume.
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

  it("rotates measurement accessors only when ordered row composition changes", () => {
    const props = makeProps();
    const rendered = render(<VirtualizedTranscriptRowList {...props} />);
    const firstOptions = observedVirtualizerOptions.at(-1);

    rendered.rerender(
      <VirtualizedTranscriptRowList
        {...props}
        rows={ROWS.map((row) => ({ ...row }))}
      />,
    );
    const contentUpdateOptions = observedVirtualizerOptions.at(-1);
    expect(contentUpdateOptions?.getItemKey).toBe(firstOptions?.getItemKey);
    expect(contentUpdateOptions?.estimateSize).toBe(firstOptions?.estimateSize);

    rendered.rerender(
      <VirtualizedTranscriptRowList
        {...props}
        activeSessionId="session-2"
      />,
    );
    const sessionUpdateOptions = observedVirtualizerOptions.at(-1);
    expect(sessionUpdateOptions?.getItemKey).not.toBe(firstOptions?.getItemKey);
    expect(sessionUpdateOptions?.estimateSize).not.toBe(firstOptions?.estimateSize);

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
