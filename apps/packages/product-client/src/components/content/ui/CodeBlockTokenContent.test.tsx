// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CodeBlockTokenContent } from "./CodeBlockTokenContent";
import type { HighlightedToken } from "#product/lib/infra/editor/highlighting";

function line(...contents: string[]): HighlightedToken[] {
  return contents.map((content) => ({ content }));
}

const THREE_LINES: HighlightedToken[][] = [
  line("const", " a", " = 1;"),
  line("const", " b", " = 2;"),
  line("return", " a + b;"),
];

describe("CodeBlockTokenContent", () => {
  afterEach(cleanup);

  // Regression: shiki's tokens carry no trailing newline and CodeTokenLine
  // emits a bare inline <span>, so without a block-level line wrapper every
  // highlighted transcript code block collapsed onto a single visual line.
  // `showLineNumbers` defaults to false and both the transcript and desktop
  // renderers rely on that default, so this is the branch users actually hit.
  it("gives each line its own block-level wrapper when un-guttered", () => {
    const { container } = render(<CodeBlockTokenContent lines={THREE_LINES} />);

    const code = container.querySelector("code");
    expect(code).toBeTruthy();

    const lineWrappers = Array.from(code!.children);
    expect(lineWrappers).toHaveLength(3);
    for (const wrapper of lineWrappers) {
      expect(wrapper.className).toContain("block");
    }
  });

  it("keeps every line's text, in order", () => {
    const { container } = render(<CodeBlockTokenContent lines={THREE_LINES} />);

    const rendered = Array.from(container.querySelector("code")!.children).map(
      (child) => child.textContent,
    );
    expect(rendered).toEqual(["const a = 1;", "const b = 2;", "return a + b;"]);
  });

  it("renders a blank line as an empty block, not a doubled newline", () => {
    // CodeTokenLine's empty-line branch emits "\n" so that a copy of the
    // block keeps the blank line; the wrapper must not also add height.
    const { container } = render(
      <CodeBlockTokenContent lines={[line("a"), [], line("b")]} />,
    );

    const children = Array.from(container.querySelector("code")!.children);
    expect(children).toHaveLength(3);
    expect(children[1]!.textContent).toBe("\n");
  });

  it("does not add the block wrapper on the gutter branch", () => {
    // There the <tr> rows already break lines; a block span would be redundant.
    const { container } = render(
      <CodeBlockTokenContent lines={THREE_LINES} showLineNumbers />,
    );

    expect(container.querySelectorAll("tr")).toHaveLength(3);
    for (const cell of container.querySelectorAll("td:last-child > span")) {
      expect(cell.className).not.toContain("block");
    }
  });

  it("numbers gutter lines from lineNumberStart", () => {
    const { container } = render(
      <CodeBlockTokenContent lines={THREE_LINES} showLineNumbers lineNumberStart={41} />,
    );

    const numbers = Array.from(container.querySelectorAll("td:first-child")).map(
      (cell) => cell.textContent,
    );
    expect(numbers).toEqual(["41", "42", "43"]);
  });
});
