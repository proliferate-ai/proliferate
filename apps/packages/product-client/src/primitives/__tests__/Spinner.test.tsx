// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Spinner } from "#product/primitives/Spinner";

afterEach(cleanup);

/** Spinner source with doc comments stripped, so prose about the old
 *  `fill-box` attempt cannot satisfy a code-level assertion. */
const spinnerCode = readFileSync(
  resolve(process.cwd(), "src/primitives/Spinner.tsx"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

describe("Spinner", () => {
  it("keeps a square, non-rotating inline box around the rotating SVG", () => {
    const { container } = render(<Spinner className="icon-control animate-spin" />);
    const spinner = container.querySelector<HTMLElement>("[data-loading-spinner]");
    const glyph = spinner?.querySelector("svg");

    expect(spinner?.className).toContain("inline-grid");
    expect(spinner?.className).toContain("place-items-center");
    expect(spinner?.className).toContain("leading-none");
    expect(spinner?.className).toContain("icon-control");
    // A rotating box must be square: a stretched box sweeps an arc wider than
    // its own footprint, which is what reads as wobble.
    expect(spinner?.className).toContain("aspect-square");
    expect(spinner?.className).toContain("flex-none");
    expect(glyph?.getAttribute("class")).toContain("block");
    expect(glyph?.getAttribute("class")).toContain("size-full");
  });

  it("never authors the rotation on the wrapper or a transform-box inline", () => {
    const { container } = render(<Spinner />);
    const glyph = container.querySelector("svg");

    // The rotation and its origin belong to `.proliferate-spinner > svg` in the
    // generated theme. `fill-box` is not a well-defined reference box on an
    // <svg> root, so an inline transform-box here silently moves the rotation
    // centre off the view box's exact (12,12).
    expect(glyph?.getAttribute("style") ?? "").not.toContain("transform-box");
    expect(spinnerCode).not.toContain("fill-box");
    expect(spinnerCode).not.toContain("transformOrigin");
    expect(spinnerCode).not.toContain("animate-spin");
  });

  it("draws both ring paths exactly centred on the view box centre", () => {
    const { container } = render(<Spinner />);
    const glyph = container.querySelector("svg");
    expect(glyph?.getAttribute("viewBox")).toBe("0 0 24 24");

    const paths = [...(glyph?.querySelectorAll("path") ?? [])];
    expect(paths).toHaveLength(2);

    for (const path of paths) {
      const box = pathControlPointBounds(path.getAttribute("d") ?? "");
      // Symmetric about (12,12): min + max === 24 on both axes. If the art were
      // off-centre, no transform-origin could stop the orbit.
      expect(box.minX + box.maxX).toBeCloseTo(24, 5);
      expect(box.minY + box.maxY).toBeCloseTo(24, 5);
      expect(box.maxX - box.minX).toBeCloseTo(16, 5);
      expect(box.maxY - box.minY).toBeCloseTo(16, 5);
    }
  });
});

/**
 * Bounds of a path's on-curve and control points. Both ring paths are built
 * from circular cubic arcs whose extremes coincide with their endpoints, so
 * these bounds equal the rendered bounding box.
 */
function pathControlPointBounds(d: string) {
  const numbers = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const xs: number[] = [];
  const ys: number[] = [];
  numbers.forEach((value, index) => {
    (index % 2 === 0 ? xs : ys).push(value);
  });
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}
