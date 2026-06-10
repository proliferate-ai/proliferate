import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkspacePathProvider } from "@/providers/WorkspacePathProvider";
import { MarkdownRenderer } from "./MarkdownRenderer";

vi.mock("@/hooks/workspaces/workflows/files/use-file-reference-actions", () => ({
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
    expect(html).toContain("hover:underline");
    expect(html).not.toContain("text-xs");
    expect(html).not.toContain("rounded-md");
    expect(html).not.toContain("title=\"/repo/src/App.tsx\"");
    expect(html).toContain("data-wide-markdown-block=\"true\"");
    expect(html).toContain("border-l-2 border-border");
  });

  it("renders autolinked GitHub URLs as inline chips while preserving authored link text", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownRenderer, {
        content: [
          "https://github.com/proliferate-ai/proliferate",
          "<https://github.com/proliferate-ai/proliferate/pull/43>",
          "[https://github.com/proliferate-ai/proliferate/blob/main/apps/desktop/src/App.tsx](https://github.com/proliferate-ai/proliferate/blob/main/apps/desktop/src/App.tsx)",
          "[see the PR](https://github.com/proliferate-ai/proliferate/pull/44)",
          "[actions](https://github.com/proliferate-ai/proliferate/actions)",
          "[external](https://example.com/docs)",
        ].join(" "),
      }),
    );

    expect(html.match(/data-github-link-chip="true"/g)).toHaveLength(3);
    expect(html).toContain("data-github-link-kind=\"repo\"");
    expect(html).toContain("data-github-link-kind=\"pull\"");
    expect(html).toContain("data-github-link-kind=\"file\"");
    expect(html).toContain("PR");
    expect(html).toContain("proliferate-ai/proliferate#43");
    expect(html).toContain("proliferate-ai/proliferate/apps/desktop/src/App.tsx");
    expect(html).toContain("text-link-foreground underline");
    expect(html).toContain(">see the PR</a>");
    expect(html).toContain(">actions</a>");
    expect(html).toContain(">external</a>");
    expect(html).not.toContain("proliferate-ai/proliferate#44</span>");
  });
});
