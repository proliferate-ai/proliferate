import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkspacePathProvider } from "@/providers/WorkspacePathProvider";
import { MarkdownRenderer } from "./MarkdownRenderer";

vi.mock("@/hooks/workspaces/files/use-file-reference-actions", () => ({
  useFileReferenceActions: ({ rawPath }: { rawPath: string }) => ({
    reference: {
      rawPath,
      path: rawPath,
      line: null,
      column: null,
      absolutePath: rawPath.startsWith("/") ? rawPath : `/repo/${rawPath}`,
      workspacePath: rawPath.startsWith("/repo/")
        ? rawPath.slice("/repo/".length)
        : rawPath.startsWith("/")
          ? null
          : rawPath,
    },
    openTargets: [],
    canOpenInSidebar: true,
    canOpenExternal: true,
    copyPath: vi.fn(),
    openInSidebar: vi.fn(),
    openDefault: vi.fn(),
    openPrimary: vi.fn(),
    openWithTarget: vi.fn(),
    reveal: vi.fn(),
  }),
}));

describe("MarkdownRenderer", () => {
  it("keeps markdown formatting while preserving linked file paths only", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspacePathProvider, {
        workspacePath: "/repo",
        children: createElement(MarkdownRenderer, {
          content: [
            "Paragraph with [docs](https://example.com), [README.md](/repo/README.md), [landing](/Users/pablo/landing), and `value` plus `src/App.tsx` and `/Users/pablo/landing`.",
            "",
            "> quoted text",
            "",
            "| A | B |",
            "| --- | --- |",
            "| 1 | 2 |",
          ].join("\n"),
        }),
      }),
    );

    expect(html).toContain("text-link-foreground underline");
    expect(html).toContain("bg-[var(--color-code-block-background,var(--color-muted))]");
    expect(html.match(/data-file-reference-badge="inline"/g)).toHaveLength(2);
    expect(html).toContain("README.md");
    expect(html).toContain("landing");
    expect(html).toContain("data-external-path-reference-icon=\"true\"");
    expect(html).toContain(">src/App.tsx</code>");
    expect(html).toContain(">/Users/pablo/landing</code>");
    expect(html).toContain("hover:text-link-foreground hover:underline");
    expect(html).not.toContain("text-xs");
    expect(html).not.toContain("rounded-md");
    expect(html).not.toContain("title=\"/repo/src/App.tsx\"");
    expect(html).toContain("data-wide-markdown-block=\"true\"");
    expect(html).toContain("border-l-2 border-border");
  });
});
