// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnimatedCollapsibleContent } from "../src/primitives/AnimatedCollapsibleContent";

describe("AnimatedCollapsibleContent", () => {
  it("animates an inert zero-row into visible normal flow", () => {
    const { container, rerender } = render(
      <AnimatedCollapsibleContent expanded={false}>
        <button type="button">Child action</button>
      </AnimatedCollapsibleContent>,
    );
    const disclosure = container.querySelector<HTMLElement>(
      "[data-animated-collapsible-content]",
    );

    expect(disclosure?.className).toContain("grid-rows-[0fr]");
    expect(disclosure?.className).toContain("opacity-0");
    expect(disclosure?.hasAttribute("inert")).toBe(true);
    expect(disclosure?.getAttribute("aria-hidden")).toBe("true");

    rerender(
      <AnimatedCollapsibleContent expanded>
        <button type="button">Child action</button>
      </AnimatedCollapsibleContent>,
    );

    expect(disclosure?.className).toContain("grid-rows-[1fr]");
    expect(disclosure?.className).toContain("opacity-100");
    expect(disclosure?.hasAttribute("inert")).toBe(false);
    expect(disclosure?.getAttribute("aria-hidden")).toBe("false");
  });
});
