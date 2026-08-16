/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoHideScrollArea } from "./AutoHideScrollArea";

let frames: FrameRequestCallback[];
let resizeObserverConstructions: number;
let resizeObserverDisconnects: number;

beforeEach(() => {
  frames = [];
  resizeObserverConstructions = 0;
  resizeObserverDisconnects = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("ResizeObserver", class {
    constructor(_callback: ResizeObserverCallback) {
      resizeObserverConstructions += 1;
    }
    observe() {}
    unobserve() {}
    disconnect() {
      resizeObserverDisconnects += 1;
    }
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function flushFrames() {
  const pending = frames;
  frames = [];
  for (const callback of pending) {
    callback(0);
  }
}

describe("AutoHideScrollArea", () => {
  it("keeps one observer and coalesces thumb geometry during scroll bursts", () => {
    const firstScroll = vi.fn();
    const latestScroll = vi.fn();
    const rendered = render(
      <AutoHideScrollArea className="h-80" onViewportScroll={firstScroll}>
        <div>content</div>
      </AutoHideScrollArea>,
    );
    const viewport = rendered.container.querySelector<HTMLDivElement>(".scrollbar-none")!;
    Object.defineProperty(viewport, "clientHeight", { value: 300, configurable: true });
    Object.defineProperty(viewport, "scrollHeight", { value: 3_000, configurable: true });
    viewport.scrollTop = 0;
    act(flushFrames);

    rendered.rerender(
      <AutoHideScrollArea className="h-80" onViewportScroll={latestScroll}>
        <div>content</div>
      </AutoHideScrollArea>,
    );
    expect(resizeObserverConstructions).toBe(1);
    expect(resizeObserverDisconnects).toBe(0);

    act(() => {
      viewport.scrollTop = 100;
      fireEvent.scroll(viewport);
      viewport.scrollTop = 200;
      fireEvent.scroll(viewport);
      viewport.scrollTop = 300;
      fireEvent.scroll(viewport);
    });

    expect(firstScroll).not.toHaveBeenCalled();
    expect(latestScroll).toHaveBeenCalledTimes(3);
    expect(frames).toHaveLength(1);

    act(flushFrames);
    const thumb = rendered.container.querySelector<HTMLElement>("[aria-hidden='true'] > div")!;
    expect(thumb.style.height).toBe("30px");
    expect(thumb.style.transform).toBe("translateY(30px)");
  });

  it("restores thumb geometry after horizontal mode remounts it", () => {
    const rendered = render(
      <AutoHideScrollArea className="h-80">
        <div>content</div>
      </AutoHideScrollArea>,
    );
    const viewport = rendered.container.querySelector<HTMLDivElement>(".scrollbar-none")!;
    Object.defineProperty(viewport, "clientHeight", { value: 300, configurable: true });
    Object.defineProperty(viewport, "scrollHeight", { value: 3_000, configurable: true });
    viewport.scrollTop = 300;

    act(() => {
      fireEvent.scroll(viewport);
      flushFrames();
    });
    expect(rendered.container.querySelector<HTMLElement>("[aria-hidden='true'] > div")?.style.height)
      .toBe("30px");

    rendered.rerender(
      <AutoHideScrollArea className="h-80" allowHorizontal>
        <div>content</div>
      </AutoHideScrollArea>,
    );
    expect(rendered.container.querySelector("[aria-hidden='true'] > div")).toBeNull();

    rendered.rerender(
      <AutoHideScrollArea className="h-80">
        <div>content</div>
      </AutoHideScrollArea>,
    );
    const remountedThumb = rendered.container.querySelector<HTMLElement>(
      "[aria-hidden='true'] > div",
    );
    expect(remountedThumb?.style.height).toBe("30px");
    expect(remountedThumb?.style.transform).toBe("translateY(30px)");
    expect(remountedThumb?.style.pointerEvents).toBe("auto");
  });

  it("reports custom scrollbar intent on grab and drag", () => {
    const onUserScrollIntent = vi.fn();
    const rendered = render(
      <AutoHideScrollArea
        className="h-80"
        onUserScrollIntent={onUserScrollIntent}
      >
        <div>content</div>
      </AutoHideScrollArea>,
    );
    const viewport = rendered.container.querySelector<HTMLDivElement>(".scrollbar-none")!;
    Object.defineProperty(viewport, "clientHeight", { value: 300, configurable: true });
    Object.defineProperty(viewport, "scrollHeight", { value: 3_000, configurable: true });
    viewport.scrollTop = 300;
    act(() => {
      fireEvent.scroll(viewport);
      flushFrames();
    });
    const thumb = rendered.container.querySelector<HTMLElement>(
      "[aria-hidden='true'] > div",
    )!;

    act(() => {
      fireEvent.pointerDown(thumb, { clientY: 35 });
    });
    expect(onUserScrollIntent).not.toHaveBeenCalled();

    act(() => {
      fireEvent.pointerMove(window, { clientY: 20 });
      fireEvent.pointerMove(window, { clientY: 20 });
      fireEvent.pointerMove(window, { clientY: 50 });
    });

    expect(onUserScrollIntent).toHaveBeenCalledTimes(2);
    expect(onUserScrollIntent).toHaveBeenNthCalledWith(1, -1);
    expect(onUserScrollIntent).toHaveBeenNthCalledWith(2, 1);
  });

  // Rung 8 (PRO-187, PRO-258): `overscroll-behavior` must flip to "auto" when
  // chaining is on, because touch/momentum deltas never reach the wheel
  // handler and rely entirely on this CSS property to keep moving into the
  // ancestor once the inner region is exhausted. The default without chaining
  // stays "none" (unchanged behavior for every other consumer of the shared
  // primitive: settings panels, the file tree, the publish dialog, etc.).
  it("defaults overscroll-behavior to auto only when chainVerticalWheel is on", () => {
    const chained = render(
      <AutoHideScrollArea className="h-80" chainVerticalWheel>
        <div>content</div>
      </AutoHideScrollArea>,
    );
    const chainedViewport = chained.container.querySelector<HTMLDivElement>(".scrollbar-none")!;
    expect(chainedViewport.style.overscrollBehavior).toBe("auto");
    chained.unmount();

    const unchained = render(
      <AutoHideScrollArea className="h-80">
        <div>content</div>
      </AutoHideScrollArea>,
    );
    const unchainedViewport = unchained.container.querySelector<HTMLDivElement>(".scrollbar-none")!;
    expect(unchainedViewport.style.overscrollBehavior).toBe("none");
  });

  // An explicit `overscrollBehavior` prop still wins over the chaining-derived
  // default in either direction — the flip is a default, not a forced value.
  it("lets an explicit overscrollBehavior override the chaining-derived default", () => {
    const rendered = render(
      <AutoHideScrollArea className="h-80" chainVerticalWheel overscrollBehavior="contain">
        <div>content</div>
      </AutoHideScrollArea>,
    );
    const viewport = rendered.container.querySelector<HTMLDivElement>(".scrollbar-none")!;
    expect(viewport.style.overscrollBehavior).toBe("contain");
  });

  // Rung 8 core mechanism: a wheel event at the inner scroll edge chains onto
  // the first scrollable ancestor. This is the same `chainVerticalWheelScroll`
  // the nested code-block / tool-output physics fixture exercises in real
  // Chromium and WebKit; this unit test pins the wiring (chainVerticalWheel ->
  // onWheel -> chainVerticalWheelScroll -> preventDefault) at the jsdom tier,
  // where a real scrollable-ancestor lookup and scrollTop write are still
  // observable even though jsdom has no real layout.
  it("chains a wheel event at the inner edge onto the first scrollable ancestor when chainVerticalWheel is on", () => {
    const ancestor = document.createElement("div");
    Object.defineProperty(ancestor, "scrollHeight", { value: 2_000, configurable: true });
    Object.defineProperty(ancestor, "clientHeight", { value: 400, configurable: true });
    ancestor.style.overflowY = "auto";
    ancestor.scrollTop = 0;
    document.body.appendChild(ancestor);

    const rendered = render(
      <AutoHideScrollArea className="h-80" chainVerticalWheel>
        <div>content</div>
      </AutoHideScrollArea>,
      { container: ancestor },
    );
    const viewport = rendered.container.querySelector<HTMLDivElement>(".scrollbar-none")!;
    // Already at its own bottom edge, matching real chain-past-inner-scroller
    // state (scrollHeight === clientHeight => isAtVerticalScrollEdge is true
    // for either direction).
    Object.defineProperty(viewport, "scrollHeight", { value: 300, configurable: true });
    Object.defineProperty(viewport, "clientHeight", { value: 300, configurable: true });
    viewport.scrollTop = 0;

    fireEvent.wheel(viewport, { deltaY: 120, cancelable: true });
    // The load-bearing side effect: the ancestor absorbed the delta.
    expect(ancestor.scrollTop).toBe(120);

    document.body.removeChild(ancestor);
  });
});
