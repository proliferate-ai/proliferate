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
  useMarkdownFencedCodeStart,
  useMarkdownStreamingSource,
  type MarkdownLinkRenderInput,
} from "./MarkdownBody";
import { CHAT_TRANSCRIPT_LINK_CLASS } from "#product/config/transcript-link-styles";

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

  it("repairs a settled local-file link in the render copy only", () => {
    const source = "Open [notes](/repo/My Notes.md \"Read it\")";
    const renderLink = vi.fn(({ href }: MarkdownLinkRenderInput) => (
      <span data-workspace-file={href}>notes</span>
    ));
    const html = renderMarkdown(source, { renderLink });

    expect(source).toBe("Open [notes](/repo/My Notes.md \"Read it\")");
    expect(renderLink).toHaveBeenCalledWith(expect.objectContaining({
      href: "/repo/My%20Notes.md",
    }));
    expect(html).toContain('data-workspace-file="/repo/My%20Notes.md"');
  });

  it("repairs a streaming local-file link after stabilizing it", () => {
    const source = "Open [notes](/repo/My Notes.md";
    const renderLink = vi.fn(({ href }: MarkdownLinkRenderInput) => (
      <span data-workspace-file={href}>notes</span>
    ));
    const html = renderMarkdown(source, { isStreaming: true, renderLink });

    expect(source).toBe("Open [notes](/repo/My Notes.md");
    expect(html).toContain('data-workspace-file="/repo/My%20Notes.md"');
  });

  it.each([false, true])(
    "runs neither transformation on the file-content surface (streaming: %s)",
    (isStreaming) => {
      const renderLink = vi.fn(() => null);
      const html = renderMarkdown("Open [notes](/repo/My Notes.md \"Read it\")", {
        surface: "file-content",
        isStreaming,
        renderLink,
      });

      // The viewer shows the file's own bytes: no repair, no synthetic close.
      expect(html).toContain("(/repo/My Notes.md &quot;Read it&quot;)");
      expect(renderLink).not.toHaveBeenCalled();
      expect(html).not.toContain("%20");
    },
  );

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

  it("exposes the streaming render copy to fenced code renderers", () => {
    const source = "```ts\nconst ready = true;\n```";
    const html = renderMarkdown(source, {
      isStreaming: true,
      renderCodeBlock: () => createElement(StreamingSourceProbe),
    });

    expect(html).toContain('data-markdown-streaming="true"');
    expect(html).toContain(`data-markdown-source="${escapeHtmlAttr(source)}"`);
  });

  it("exposes settled markdown as a non-streaming render copy", () => {
    const source = "```ts\nconst ready = true;\n```";
    const html = renderMarkdown(source, {
      renderCodeBlock: () => createElement(StreamingSourceProbe),
    });

    expect(html).toContain('data-markdown-streaming="false"');
    expect(html).toContain(`data-markdown-source="${escapeHtmlAttr(source)}"`);
  });

  it("publishes the stabilized render copy into fenced-code context", () => {
    const source = "```ts\nconst ready = true;\n```\n\nOpen [config](/tmp/project/config";
    const html = renderMarkdown(source, {
      isStreaming: true,
      renderCodeBlock: () => createElement(StreamingSourceProbe),
    });

    expect(html).toContain('data-markdown-streaming="true"');
    expect(html).toContain("Open [config](/tmp/project/config)");
    expect(html).not.toMatch(/data-markdown-source="[^"]*Open \[config\]\(\/tmp\/project\/config"/);
  });

  it("exposes fenced-code start position to fenced code renderers", () => {
    const first = "```mermaid\nflowchart LR\n  A --> B\n```";
    const second = "```mermaid\nflowchart LR\n  A --> B";
    const html = renderMarkdown(`${first}\n\n${second}`, {
      isStreaming: true,
      renderCodeBlock: () => createElement(FencedCodeStartProbe),
    });

    expect(html).toMatch(/data-start-line="[1-9]\d*"/);
    expect(html).toMatch(/data-start-offset="\d+"/);
    const lines = [...html.matchAll(/data-start-line="(\d+)"/g)].map((match) => Number(match[1]));
    const offsets = [...html.matchAll(/data-start-offset="(\d+)"/g)].map((match) => Number(match[1]));
    expect(lines).toHaveLength(2);
    expect(offsets).toHaveLength(2);
    expect(lines[0]).toBeLessThan(lines[1]);
    expect(offsets[0]).toBeLessThan(offsets[1]);
  });
});

function StreamingSourceProbe() {
  const streaming = useMarkdownStreamingSource();
  return createElement("span", {
    "data-markdown-streaming": streaming.isStreaming ? "true" : "false",
    "data-markdown-source": streaming.source,
  });
}

function FencedCodeStartProbe() {
  const start = useMarkdownFencedCodeStart();
  return createElement("span", {
    "data-start-line": start.startLine == null ? "" : String(start.startLine),
    "data-start-offset": start.startOffset == null ? "" : String(start.startOffset),
  });
}

function escapeHtmlAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
