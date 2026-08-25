import { createElement, isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("#product/components/content/ui/FilePathLink", () => ({
  FilePathLink: () => null,
}));
vi.mock("#product/hooks/ui/highlighting/use-highlighted-tokens", () => ({
  useHighlightedTokens: () => null,
}));

import { MermaidDiagram } from "./MermaidDiagram";
import { renderTranscriptCodeBlock } from "./transcript-markdown";
import { renderDesktopCodeBlock } from "#product/components/content/ui/desktop-markdown-code-block";

describe("mermaid code-block dispatch", () => {
  it("routes mermaid language through MermaidDiagram from both renderers", () => {
    const input = { code: "flowchart LR\n  A --> B", language: "mermaid" };
    expect(renderTranscriptCodeBlock(input)).toEqual(
      createElement(MermaidDiagram, input),
    );
    expect(renderDesktopCodeBlock(input)).toEqual(
      createElement(MermaidDiagram, input),
    );
  });

  it("keeps typescript, javascript, python, unlabeled, and text on CodeBlock", () => {
    const samples = [
      { code: "const ready = true;", language: "typescript" },
      { code: "const ready = true;", language: "javascript" },
      { code: "print(1)", language: "python" },
      { code: "plain", language: null },
      { code: "plain", language: "text" },
    ];
    for (const input of samples) {
      const transcript = renderTranscriptCodeBlock(input);
      const desktop = renderDesktopCodeBlock(input);
      expect(isValidElement(transcript) && transcript.type !== MermaidDiagram).toBe(true);
      expect(isValidElement(desktop) && desktop.type !== MermaidDiagram).toBe(true);
    }
  });
});
