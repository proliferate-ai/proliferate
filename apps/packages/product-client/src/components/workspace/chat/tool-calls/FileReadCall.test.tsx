// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileReadCall } from "#product/components/workspace/chat/tool-calls/FileReadCall";

const chipInputs = vi.hoisted(() => ([] as Array<Record<string, unknown>>));
const codeBlockInputs = vi.hoisted(() => ([] as Array<Record<string, unknown>>));

vi.mock("#product/components/workspace/chat/tool-calls/ToolFileChip", () => ({
  ToolFileChip: (props: Record<string, unknown>) => {
    chipInputs.push(props);
    return <span data-mocked-file-chip />;
  },
}));

// Highlighting/clipboard/host wiring is HighlightedCodeBlock's own concern;
// this test is only about FileReadCall wiring the right line-numbering
// props into it.
vi.mock("#product/components/content/ui/HighlightedCodeBlock", () => ({
  HighlightedCodeBlock: (props: Record<string, unknown>) => {
    codeBlockInputs.push(props);
    return <div data-mocked-highlighted-code-block />;
  },
}));

afterEach(() => {
  cleanup();
  chipInputs.length = 0;
  codeBlockInputs.length = 0;
});

describe("FileReadCall", () => {
  it("keeps the raw wire path when a structured blank path is supplied", () => {
    render(
      <FileReadCall
        path="src/raw/visible.ts"
        workspacePath=""
        basename="visible.ts"
      />,
    );
    expect(chipInputs).toContainEqual(expect.objectContaining({
      rawPath: "src/raw/visible.ts",
      workspacePath: "",
      basename: "visible.ts",
    }));
  });

  it("preserves null as absent structured metadata", () => {
    render(<FileReadCall path="src/raw.ts" workspacePath={null} />);
    expect(chipInputs).toContainEqual(expect.objectContaining({
      rawPath: "src/raw.ts",
      workspacePath: null,
    }));
  });

  // 03C r2: regression pinning only, demoted from new work by the freeze
  // audit — do NOT switch the ASCII hyphen to an en dash.
  describe("scope labels (FileReadCall.tsx:84-99)", () => {
    it("renders a single-line scope as 'line N'", () => {
      const { getByText } = render(
        <FileReadCall path="src/a.ts" scope="line" line={12} />,
      );
      expect(getByText("line 12")).not.toBeNull();
    });

    it("renders a full range scope with an ASCII hyphen, not an en dash", () => {
      const { getByText, queryByText } = render(
        <FileReadCall path="src/a.ts" scope="range" startLine={10} endLine={20} />,
      );
      expect(getByText("lines 10-20")).not.toBeNull();
      expect(queryByText("lines 10–20")).toBeNull();
    });

    it("renders an open-ended range as 'from line N'", () => {
      const { getByText } = render(
        <FileReadCall path="src/a.ts" scope="range" startLine={10} endLine={null} />,
      );
      expect(getByText("from line 10")).not.toBeNull();
    });

    it("has no scope label for a full-file read", () => {
      const { container } = render(<FileReadCall path="src/a.ts" scope={null} />);
      expect(container.textContent).not.toContain("line");
    });
  });

  describe("preview line numbering", () => {
    it("shows line numbers starting at the scoped start line for a partial read", () => {
      render(
        <FileReadCall
          path="src/a.ts"
          scope="range"
          startLine={5}
          endLine={7}
          preview={"one\ntwo\nthree"}
          defaultExpanded
        />,
      );
      expect(codeBlockInputs).toContainEqual(expect.objectContaining({
        showLineNumbers: true,
        lineNumberStart: 5,
      }));
    });

    it("does not show line numbers for a full-file preview", () => {
      render(<FileReadCall path="src/a.ts" scope={null} preview={"one\ntwo"} defaultExpanded />);
      expect(codeBlockInputs).toContainEqual(expect.objectContaining({
        showLineNumbers: false,
      }));
    });
  });
});
