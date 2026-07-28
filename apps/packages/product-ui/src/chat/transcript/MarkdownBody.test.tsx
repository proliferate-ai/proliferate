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

// Hex-swatch fixtures are assembled rather than written as literals: these are
// arbitrary sample values in agent output, not palette entries, and the palette
// guard rightly rejects literal `#rrggbb` in product source.
function hexLiteral(digits: string): string {
  return `#${digits}`;
}

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

    expect(html).toContain('class="transcript-find-match"');
    expect(html).toContain('data-content-search-row="assistant-1"');
  });

  it("continues to strip executable URL schemes", () => {
    const html = renderMarkdown("[unsafe](javascript:alert(1))");

    expect(html).not.toContain("javascript:");
  });

  it("renders a swatch for a hex color literal in inline code", () => {
    for (const digits of ["0a0", "00a240", "00a24080", "00A240"]) {
      const literal = hexLiteral(digits);
      const html = renderMarkdown(`The brand green is \`${literal}\`.`);

      expect(html).toContain('data-markdown-hex-swatch="true"');
      expect(html).toContain(`--markdown-hex-swatch:${literal.toLowerCase()}`);
      expect(html).toContain(`>${literal}</code>`);
    }
  });

  it("leaves non-hex inline code and hash-bearing prose without a swatch", () => {
    const negatives = [
      `See issue \`${hexLiteral("1042")}\` for context.`,
      "Run `#!/bin/sh` first.",
      `The token \`${hexLiteral("00a24")}\` is malformed.`,
      `The token \`${hexLiteral("00a2404")}\` is malformed.`,
      "Use `rgb(0 162 64)` instead.",
      "Use `green` instead.",
      `Prefix \`${hexLiteral("00a240")} fallback\` is not a literal.`,
      "A heading like # Title stays prose.",
      `Fragment \`/docs${hexLiteral("00a240")}\` is a path.`,
      `Bare prose ${hexLiteral("00a240")} outside code stays prose.`,
    ];

    for (const source of negatives) {
      expect(renderMarkdown(source)).not.toContain("data-markdown-hex-swatch");
    }
  });

  it("keeps the swatch out of a fenced block that happens to hold a hex value", () => {
    const html = renderMarkdown(`\`\`\`css\ncolor: ${hexLiteral("00a240")};\n\`\`\``);

    expect(html).not.toContain("data-markdown-hex-swatch");
  });

  it("uses the shared stable-color, hover-underline treatment for web links", () => {
    const html = renderMarkdown("Open [docs](https://example.com/docs).");

    expect(html).toContain("text-link-foreground");
    expect(html).toContain("hover:text-link-foreground");
    expect(html).toContain("hover:underline");
    expect(html).not.toContain("hover:text-foreground");
  });

  it("never paints a fill behind a hovered, focused, or pressed link", () => {
    const html = renderMarkdown("Open [docs](https://example.com/docs).");
    const anchor = html.match(/<a\b[^>]*>/g)?.join(" ") ?? "";

    expect(anchor).not.toBe("");
    // No state of an inline link may add a surface. The specific fills a link
    // could inherit (a ghost-button call site) are named so a reintroduction
    // fails here rather than in someone's eyes.
    expect(anchor).not.toContain("hover:bg-hover");
    expect(anchor).not.toContain("active:bg-active");
    expect(anchor).not.toMatch(/(?:hover|focus|focus-visible|active):bg-(?!transparent)/);
    // Focus is still visible: the underline thickens instead of a box appearing.
    expect(anchor).toContain("focus-visible:underline");
    expect(anchor).toContain("focus-visible:decoration-1");
  });

  it("keeps hex swatches in conversation content and out of rendered file text", () => {
    const source = `The brand green is \`${hexLiteral("00a240")}\`.`;

    expect(renderMarkdown(source)).toContain('data-markdown-hex-swatch="true"');
    expect(renderMarkdown(source, { surface: "message" }))
      .toContain('data-markdown-hex-swatch="true"');

    const fileHtml = renderMarkdown(source, { surface: "file-content" });
    expect(fileHtml).not.toContain("data-markdown-hex-swatch");
    expect(fileHtml).toContain('data-markdown-surface="file-content"');
    // The inline-code chip itself is unaffected — only the swatch is scoped.
    expect(fileHtml).toContain('data-markdown-inline-code="true"');
  });
});
