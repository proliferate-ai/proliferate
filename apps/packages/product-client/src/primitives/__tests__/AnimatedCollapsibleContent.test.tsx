// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnimatedCollapsibleContent } from "#product/primitives/AnimatedCollapsibleContent";

describe("AnimatedCollapsibleContent", () => {
  let pendingFrames: FrameRequestCallback[];

  beforeEach(() => {
    pendingFrames = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      pendingFrames.push(callback);
      return pendingFrames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("animates an inert zero-row into visible normal flow", () => {
    const { container, rerender } = render(
      <AnimatedCollapsibleContent expanded={false}>
        <button type="button">Child action</button>
      </AnimatedCollapsibleContent>,
    );
    const disclosure = container.querySelector<HTMLElement>(
      "[data-animated-collapsible-content]",
    );

    expect(disclosure?.style.gridTemplateRows).toBe("0fr");
    expect(disclosure?.style.transitionProperty).toBe("grid-template-rows, opacity");
    expect(disclosure?.className).toContain("opacity-0");
    expect(disclosure?.hasAttribute("inert")).toBe(true);
    expect(disclosure?.getAttribute("aria-hidden")).toBe("true");

    rerender(
      <AnimatedCollapsibleContent expanded>
        <button type="button">Child action</button>
      </AnimatedCollapsibleContent>,
    );

    expect(disclosure?.style.gridTemplateRows).toBe("0fr");
    expect(disclosure?.className).toContain("opacity-0");
    expect(disclosure?.hasAttribute("inert")).toBe(true);
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);

    act(() => {
      pendingFrames.shift()?.(0);
    });

    expect(disclosure?.style.gridTemplateRows).toBe("1fr");
    expect(disclosure?.className).toContain("opacity-100");
    expect(disclosure?.hasAttribute("inert")).toBe(false);
    expect(disclosure?.getAttribute("aria-hidden")).toBe("false");
  });

  it("cancels a prepared opening when the disclosure closes before the frame", () => {
    const { container, rerender } = render(
      <AnimatedCollapsibleContent expanded={false}>
        <button type="button">Child action</button>
      </AnimatedCollapsibleContent>,
    );
    const disclosure = container.querySelector<HTMLElement>(
      "[data-animated-collapsible-content]",
    );

    rerender(
      <AnimatedCollapsibleContent expanded>
        <button type="button">Child action</button>
      </AnimatedCollapsibleContent>,
    );
    const preparedFrame = pendingFrames[0];

    rerender(
      <AnimatedCollapsibleContent expanded={false}>
        <button type="button">Child action</button>
      </AnimatedCollapsibleContent>,
    );

    expect(window.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(disclosure?.style.gridTemplateRows).toBe("0fr");
    expect(disclosure?.className).toContain("opacity-0");

    act(() => {
      preparedFrame?.(0);
    });

    expect(disclosure?.style.gridTemplateRows).toBe("0fr");
    expect(disclosure?.className).toContain("opacity-0");
  });

  it("renders an initially expanded disclosure statically", () => {
    const { container } = render(
      <AnimatedCollapsibleContent expanded>
        <button type="button">Child action</button>
      </AnimatedCollapsibleContent>,
    );
    const disclosure = container.querySelector<HTMLElement>(
      "[data-animated-collapsible-content]",
    );

    expect(disclosure?.style.gridTemplateRows).toBe("1fr");
    expect(disclosure?.className).toContain("opacity-100");
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
  });
});
