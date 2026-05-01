import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkspacePathProvider } from "@/providers/WorkspacePathProvider";
import { MarkdownRenderer } from "./MarkdownRenderer";

vi.mock("@/hooks/editor/use-open-in-default-editor", () => ({
  useOpenInDefaultEditor: () => ({
    openInDefaultEditor: vi.fn(),
    copyPath: vi.fn(),
    ready: true,
  }),
}));

vi.mock("@/hooks/editor/use-file-path-native-context-menu", () => ({
  useFilePathNativeContextMenu: () => ({
    onContextMenuCapture: vi.fn(),
  }),
}));

describe("MarkdownRenderer", () => {
  it("keeps Codex-style markdown formatting while preserving file path links", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspacePathProvider, {
        workspacePath: "/repo",
        children: createElement(MarkdownRenderer, {
          content: [
            "Paragraph with [docs](https://example.com) and `value` plus `src/App.tsx`.",
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
    expect(html).toContain("title=\"/repo/src/App.tsx\"");
    expect(html).toContain("hover:text-link-foreground hover:underline");
    expect(html).toContain("data-wide-markdown-block=\"true\"");
    expect(html).toContain("border-l-2 border-border");
  });
});
