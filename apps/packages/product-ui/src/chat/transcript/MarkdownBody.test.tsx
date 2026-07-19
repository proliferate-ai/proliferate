import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CodeBlock } from "../../code/CodeBlock";
import {
  ChatContentSearchQueryContext,
  ChatTranscriptRowProvider,
} from "./ChatContentSearchContext";
import {
  MarkdownBody,
  type MarkdownLinkRenderInput,
} from "./MarkdownBody";

const COMPLETE_MARKDOWN = `# Heading one

## Heading two

### Heading three

#### Heading four

##### Heading five

###### Heading six

Paragraph with **strong**, *emphasis*, [web](https://example.com), and \`inline code\`.

- First
  - Second
    - Third

1. Ordered
   1. Nested ordered

> A quoted paragraph.

\`\`\`ts
const readable = true;
\`\`\`

| First column | Second column |
| --- | --- |
| One | Two |`;

function renderMarkdown(
  content: string,
  props: Partial<Parameters<typeof MarkdownBody>[0]> = {},
): string {
  return renderToStaticMarkup(createElement(MarkdownBody, {
    content,
    ...props,
  }));
}

describe("MarkdownBody presentation", () => {
  it("renders the complete presentation fixture without rewriting its source", () => {
    const source = COMPLETE_MARKDOWN;
    const html = renderMarkdown(source);

    expect(source).toBe(COMPLETE_MARKDOWN);
    expect(html).toContain('data-markdown-body="true"');
    expect(html).toMatch(/<h1[^>]*>Heading one<\/h1>/);
    expect(html).toMatch(/<h6[^>]*>Heading six<\/h6>/);
    expect(html).toContain("<strong");
    expect(html).toContain("<em");
    expect(html).toContain("<blockquote");
    expect(html).toContain("<ol");
    expect(html).toContain("<ul");
    expect(html).toContain('data-markdown-inline-code="true"');
    expect(html).toContain('data-markdown-code-block="true"');
    expect(html).toContain('data-markdown-table-shell="true"');
    expect(html).toContain('data-markdown-table-scroll="true"');
    expect(html).toContain("overflow-x-auto overscroll-x-none");
    expect(html).not.toContain("overscroll-x-contain");
  });

  it("keeps inline, fallback fenced, and highlighted code on the prose-size contract", () => {
    const html = renderMarkdown("Text with `value`.\n\n```ts\nconst value = true;\n```");
    const highlightedHtml = renderToStaticMarkup(createElement(CodeBlock, {
      code: "const value = true;",
      label: "ts",
      tokens: [[{ content: "const value = true;" }]],
    }));

    expect(html).toContain('data-markdown-code-content="true"');
    expect(html).not.toContain("calc(var(--text-chat)-1px)");
    expect(highlightedHtml).toContain('data-markdown-code-content="true"');
  });

  it("preserves injected workspace links while stabilizing only the render copy", () => {
    const source = "Open [config](/tmp/project/config";
    const renderLink = vi.fn(({ href }: MarkdownLinkRenderInput) => (
      <span data-workspace-file={href}>config</span>
    ));
    const html = renderMarkdown(source, { isStreaming: true, renderLink });

    expect(source).toBe("Open [config](/tmp/project/config");
    expect(renderLink).toHaveBeenCalledWith(expect.objectContaining({
      href: "/tmp/project/config",
    }));
    expect(html).toContain('data-workspace-file="/tmp/project/config"');
    expect(html).not.toContain("(/tmp/project/config");
  });

  it("keeps content-search marks inside the presentation DOM", () => {
    const html = renderToStaticMarkup(
      <ChatContentSearchQueryContext.Provider value="readable">
        <ChatTranscriptRowProvider value={{ rowUnitId: "assistant-1", rowIndex: 0 }}>
          <MarkdownBody content="Readable Markdown remains searchable." enableContentSearch />
        </ChatTranscriptRowProvider>
      </ChatContentSearchQueryContext.Provider>,
    );

    expect(html).toContain('class="codex-thread-find-match"');
    expect(html).toContain('data-content-search-row="assistant-1"');
  });

  it("continues to strip executable URL schemes", () => {
    const html = renderMarkdown("[unsafe](javascript:alert(1))");

    expect(html).not.toContain("javascript:");
  });
});
