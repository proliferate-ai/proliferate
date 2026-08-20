// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DotCellLoader } from "#product/primitives/DotCellLoader";

const productCss = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../design/src/css/product.css",
  ),
  "utf8",
);

afterEach(cleanup);

describe("DotCellLoader", () => {
  it("renders one nine-dot cell with the requested motion and size", () => {
    const { container } = render(
      <DotCellLoader variant="helix" size="compact" />,
    );
    const loader = container.querySelector("[data-dot-cell-loader]");

    expect(loader?.getAttribute("data-variant")).toBe("helix");
    expect(loader?.getAttribute("data-size")).toBe("compact");
    expect(loader?.querySelectorAll(".dot-cell-loader__dot")).toHaveLength(9);
  });

  it("defaults to the full-size wave treatment", () => {
    const { container } = render(<DotCellLoader />);
    const loader = container.querySelector("[data-dot-cell-loader]");

    expect(loader?.getAttribute("data-variant")).toBe("wave");
    expect(loader?.getAttribute("data-size")).toBe("default");
  });

  it("keeps the persistent wave off the transform compositor path", () => {
    const keyframes = productCss.match(
      /@keyframes om-wave\s*\{([\s\S]*?)\n\}/,
    )?.[1];
    const waveRule = productCss.match(
      /\.dot-cell-loader\[data-variant="wave"\] \.dot-cell-loader__dot\s*\{([\s\S]*?)\}/,
    )?.[1];

    expect(keyframes).toBeDefined();
    expect(waveRule).toBeDefined();
    expect(keyframes).not.toContain("transform:");
    expect(waveRule).not.toContain("transform:");
  });
});
