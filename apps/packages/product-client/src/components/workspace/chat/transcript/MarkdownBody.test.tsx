import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CodeBlock } from "#product/components/content/ui/CodeBlock";
import {
  ChatContentSearchQueryContext,
  ChatTranscriptRowProvider,
} from "./ChatContentSearchContext";
import {
  MarkdownBody,
  type MarkdownLinkRenderInput,
} from "./MarkdownBody";
import { CHAT_TRANSCRIPT_LINK_CLASS } from "#product/config/transcript-link-styles";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { makeTestProductHost } from "#product/test/product-host-fixtures";

const markdownTestHost = makeTestProductHost({ desktop: null });

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
  return renderToStaticMarkup(
    <ProductHostProvider host={markdownTestHost}>
      {createElement(MarkdownBody, { content, ...props })}
    </ProductHostProvider>,
  );
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

  it("renders an unlabeled single-line fence as a code block", () => {
    const html = renderMarkdown("```\nconst ready = true;\n```");

    expect(html).toContain('data-markdown-code-block="true"');
    expect(html).toContain("const ready = true;");
    expect(html).not.toContain('data-markdown-inline-code="true"');
  });

  it("keeps an empty fence distinct from inline code", () => {
    const html = renderMarkdown("```\n```");

    expect(html).toContain('data-markdown-code-block="true"');
    expect(html).not.toContain('data-markdown-inline-code="true"');
    expect(html).not.toContain("undefined");
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

  it("repairs settled local file links containing literal spaces in the render copy", () => {
    const source = "Open [the draft](/Users/pablo/My Project/Final Draft.md).";
    const renderLink = vi.fn(({ href }: MarkdownLinkRenderInput) => (
      <span data-workspace-file={href}>the draft</span>
    ));
    const html = renderMarkdown(source, { renderLink });

    expect(source).toBe("Open [the draft](/Users/pablo/My Project/Final Draft.md).");
    expect(renderLink).toHaveBeenCalledWith(expect.objectContaining({
      href: "/Users/pablo/My%20Project/Final%20Draft.md",
    }));
    expect(html).not.toContain("[the draft](");
  });

  it("keeps content-search marks inside the presentation DOM", () => {
    const html = renderToStaticMarkup(
      <ChatContentSearchQueryContext.Provider value="readable">
        <ChatTranscriptRowProvider value={{ rowUnitId: "assistant-1", rowIndex: 0 }}>
          <MarkdownBody content="Readable Markdown remains searchable." enableContentSearch />
        </ChatTranscriptRowProvider>
      </ChatContentSearchQueryContext.Provider>,
    );

    expect(html).toContain('class="content-find-match"');
    expect(html).toContain('data-content-search-row="assistant-1"');
  });

  it("continues to strip executable URL schemes", () => {
    const html = renderMarkdown("[unsafe](javascript:alert(1))");

    expect(html).not.toContain("javascript:");
  });

  it("uses the shared stable-color, hover-underline treatment for web links", () => {
    const html = renderMarkdown("Open [docs](https://example.com/docs).");

    // The shared constant itself, not a copy: the property under test is that
    // the anchor wears the one shared treatment, so a retune of that treatment
    // must not fail here — only the anchor abandoning it should.
    expect(html).toContain(CHAT_TRANSCRIPT_LINK_CLASS);
    expect(html).not.toContain("hover:text-foreground");
  });
});
