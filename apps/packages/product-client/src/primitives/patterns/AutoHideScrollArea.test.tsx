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
});
