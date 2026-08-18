// @vitest-environment jsdom

import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WorkflowCanvas } from "#product/components/workflows/canvas/WorkflowCanvas";

afterEach(() => {
  cleanup();
});

/** `translate(Xpx, Ypx) scale(Z)` — the only place the viewport is observable. */
function readTransform(): { x: number; y: number; zoom: number } {
  const content = screen.getByTestId("canvas-content").parentElement!;
  const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/
    .exec(content.style.transform);
  if (!match) throw new Error(`unreadable transform: ${content.style.transform}`);
  return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
}

function renderCanvas() {
  render(
    <StrictMode>
      <WorkflowCanvas contentWidth={400} contentHeight={300} edges={[]} ariaLabel="Test canvas">
        <div data-testid="canvas-content" />
      </WorkflowCanvas>
    </StrictMode>,
  );
  return screen.getByRole("group", { name: "Test canvas" });
}

describe("WorkflowCanvas", () => {
  // jsdom reports a zero-sized container, so the mount-time fit is a no-op and
  // the view starts at the untouched zoom 1 / 24px inset.
  it("anchors a zoom on the pointer exactly once under StrictMode's double render", () => {
    const canvas = renderCanvas();
    const before = readTransform();
    expect(before).toEqual({ x: 24, y: 24, zoom: 1 });

    fireEvent.wheel(canvas, { deltaY: -1, metaKey: true, clientX: 100, clientY: 50 });

    // One application of the anchor math: pan = point - (point - pan) * ratio.
    // Applying it twice (the hazard of deriving pan inside the zoom updater)
    // would land near the anchor itself instead.
    const after = readTransform();
    const ratio = after.zoom / before.zoom;
    expect(after.zoom).toBeCloseTo(1.15, 5);
    expect(after.x).toBeCloseTo(100 - (100 - before.x) * ratio, 5);
    expect(after.y).toBeCloseTo(50 - (50 - before.y) * ratio, 5);
  });

  it("leaves the viewport alone for a wheel without the zoom modifier", () => {
    const canvas = renderCanvas();
    fireEvent.wheel(canvas, { deltaY: -1, clientX: 100, clientY: 50 });
    expect(readTransform()).toEqual({ x: 24, y: 24, zoom: 1 });
  });

  it("pans by the pointer's own travel, once per drag frame", () => {
    const canvas = renderCanvas();
    fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 40, clientY: 70 });
    expect(readTransform()).toEqual({ x: 54, y: 84, zoom: 1 });

    // The drag is over: further motion is not more panning.
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 40, clientY: 70 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 200, clientY: 200 });
    expect(readTransform()).toEqual({ x: 54, y: 84, zoom: 1 });
  });
});
