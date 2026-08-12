// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatDockInset } from "./use-chat-dock-inset";

interface DockDimensions {
  dockHeight: number;
  surfaceHeight: number;
}

let resizeCallback: ResizeObserverCallback | null = null;

beforeEach(() => {
  class TestResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      resizeCallback = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
    return makeRect(
      Number(this.dataset.testLeft ?? 0),
      Number(this.dataset.testTop ?? 0),
      Number(this.dataset.testWidth ?? 0),
      Number(this.dataset.testHeight ?? 0),
    );
  });
});

afterEach(() => {
  cleanup();
  resizeCallback = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useChatDockInset", () => {
  it("publishes a new safe area when the measured composer grows at narrow width", () => {
    const rendered = render(
      <Harness dimensions={{ dockHeight: 116, surfaceHeight: 72 }} />,
    );

    expect(screen.getByTestId("safe-area").textContent).toBe("132");

    rendered.rerender(
      <Harness dimensions={{ dockHeight: 176, surfaceHeight: 132 }} />,
    );
    act(() => {
      resizeCallback?.([], {} as ResizeObserver);
    });

    expect(screen.getByTestId("safe-area").textContent).toBe("192");
  });
});

function Harness({ dimensions }: { dimensions: DockDimensions }) {
  const { dockRef, dockSafeAreaPx } = useChatDockInset();
  return (
    <div>
      <output data-testid="safe-area">{dockSafeAreaPx}</output>
      <div
        ref={dockRef}
        data-test-left="0"
        data-test-top="100"
        data-test-width="320"
        data-test-height={dimensions.dockHeight}
      >
        <div
          data-chat-composer-surface
          data-test-left="12"
          data-test-top="108"
          data-test-width="296"
          data-test-height={dimensions.surfaceHeight}
        />
        <div
          data-chat-composer-footer
          data-test-left="12"
          data-test-top={108 + dimensions.surfaceHeight}
          data-test-width="296"
          data-test-height="20"
        />
      </div>
    </div>
  );
}

function makeRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}
