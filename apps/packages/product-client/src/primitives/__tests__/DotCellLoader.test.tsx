// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DotCellLoader } from "#product/primitives/DotCellLoader";

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
});
