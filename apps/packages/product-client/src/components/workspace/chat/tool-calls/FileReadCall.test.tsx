import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FileReadCall } from "#product/components/workspace/chat/tool-calls/FileReadCall";

vi.mock("#product/components/workspace/file-references/FileReferenceBadge", () => ({
  FileReferenceBadge: ({
    label,
    variant,
  }: {
    label: string;
    variant: string;
  }) => <button data-file-reference-badge={variant}>{label}</button>,
}));

describe("FileReadCall", () => {
  it("keeps the read scope inside the glyph-free file reference", () => {
    const html = renderToStaticMarkup(createElement(FileReadCall, {
      path: "src/reader.ts",
      workspacePath: "src/reader.ts",
      basename: "reader.ts",
      scope: "range",
      startLine: 4,
      endLine: 18,
      status: "completed",
    }));

    expect(html).toContain("Read");
    expect(html).toContain('data-file-reference-badge="plain"');
    expect(html).toContain("reader.ts (lines 4–18)");
    expect(html).not.toContain("hover:text-foreground");
  });
});
