// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Spinner } from "../src/primitives/Spinner";

afterEach(cleanup);

describe("Spinner", () => {
  it("keeps a centered square inline box independent from the rotating SVG", () => {
    const { container } = render(<Spinner className="icon-control animate-spin" />);
    const spinner = container.querySelector<HTMLElement>("[data-loading-spinner]");
    const glyph = spinner?.querySelector("svg");

    expect(spinner?.className).toContain("inline-grid");
    expect(spinner?.className).toContain("flex-none");
    expect(spinner?.className).toContain("place-items-center");
    expect(spinner?.className).toContain("leading-none");
    expect(spinner?.className).toContain("icon-control");
    expect(glyph?.getAttribute("class")).toContain("block");
    expect(glyph?.getAttribute("class")).toContain("size-full");
    expect(glyph?.getAttribute("class")).toContain("motion-safe:animate-spin");
  });
});
