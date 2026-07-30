// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CodeBlockTokenContent } from "../src/code/CodeBlockTokenContent";
import type { HighlightedToken } from "../src/code/types";

const lines: HighlightedToken[][] = [
  [{ content: "const a = 1;", color: "#ff0000" }],
  [{ content: "const b = 2;", color: "#00ff00" }],
  [{ content: "const c = 3;", color: "#0000ff" }],
];

describe("CodeBlockTokenContent", () => {
  afterEach(cleanup);

  /**
   * Regression: tokenized lines carry no trailing newline, so without block
   * display on each line element the gutterless branch rendered a multi-line
   * highlighted snippet as one long line.
   */
  it("keeps each highlighted line on its own row without line numbers", () => {
    const { container } = render(<CodeBlockTokenContent lines={lines} />);

    const code = container.querySelector("code");
    const lineElements = Array.from(code?.children ?? []);
    expect(lineElements).toHaveLength(3);
    for (const line of lineElements) {
      expect(line.className).toContain("block");
    }
  });
});
