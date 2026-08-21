// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodeBlock } from "#product/components/content/ui/CodeBlock";
import {
  MarkdownBody,
  type MarkdownCodeBlockRenderInput,
} from "./MarkdownBody";
import { MermaidDiagram } from "./MermaidDiagram";
import { isMermaidLanguage } from "#product/lib/domain/chat/transcript/mermaid-fence";

const renderMermaidDiagram = vi.hoisted(() => vi.fn());

vi.mock("#product/lib/infra/mermaid/mermaid-renderer", () => ({
  renderMermaidDiagram,
  resetMermaidRendererForTests: vi.fn(),
}));

vi.mock("#product/hooks/ui/highlighting/use-highlighted-tokens", () => ({
  useHighlightedTokens: () => null,
}));

const FLOWCHART = [
  "flowchart TB",
  "  subgraph Pipeline",
  "    Frontend --> API",
  "    API -->|auth| Runtime",
  "  end",
  "  Runtime --> Decision{Ready?}",
  "  Decision -->|yes| Done",
  "  Decision -->|no| Wait",
].join("\n");

function mermaidMarkdown(body: string, closer = true): string {
  return closer ? `\`\`\`mermaid\n${body}\n\`\`\`` : `\`\`\`mermaid\n${body}`;
}

function renderedSvg(id: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" id="${id}" aria-hidden="true"><path d="M0 0" /></svg>`;
}

function renderCodeBlock({ code, language }: MarkdownCodeBlockRenderInput) {
  if (isMermaidLanguage(language)) {
    return <MermaidDiagram code={code} language={language} />;
  }
  return <CodeBlock code={code} label={language} />;
}

describe("Mermaid transcript dispatch", () => {
  beforeEach(() => {
    renderMermaidDiagram.mockReset();
    renderMermaidDiagram.mockResolvedValue(renderedSvg("p-mermaid-1"));
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(async () => undefined) },
    });
    document.execCommand = vi.fn(() => false) as typeof document.execCommand;
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps typescript, javascript, python, unlabeled, and text on CodeBlock", () => {
    const samples = [
      ["typescript", "const ready = true;"],
      ["javascript", "const ready = true;"],
      ["python", "print(1)"],
      [null, "plain"],
      ["text", "plain"],
    ] as const;

    for (const [language, code] of samples) {
      const fence = language
        ? `\`\`\`${language}\n${code}\n\`\`\``
        : `\`\`\`\n${code}\n\`\`\``;
      const { container } = render(
        <MarkdownBody content={fence} renderCodeBlock={renderCodeBlock} />,
      );
      expect(container.querySelector("[data-markdown-code-block='true']")).not.toBeNull();
      expect(container.querySelector("[data-mermaid-diagram='true']")).toBeNull();
      expect(renderMermaidDiagram).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("does not dispatch on inline mermaid", () => {
    const { container } = render(
      <MarkdownBody
        content="I like the `mermaid` language."
        renderCodeBlock={renderCodeBlock}
      />,
    );
    expect(container.querySelector("[data-mermaid-diagram='true']")).toBeNull();
    expect(renderMermaidDiagram).not.toHaveBeenCalled();
  });

  it("A: incomplete mermaid stays a code block and never calls mermaid.render", async () => {
    const { container } = render(
      <MarkdownBody
        content={mermaidMarkdown(FLOWCHART, false)}
        isStreaming
        renderCodeBlock={renderCodeBlock}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(renderMermaidDiagram).not.toHaveBeenCalled();
    expect(container.querySelector("[data-mermaid-diagram='true']")).toBeNull();
    expect(container.querySelector("[data-markdown-code-block='true']")).not.toBeNull();
    expect(container.textContent).toContain("flowchart TB");
  });

  it("B: a closed mermaid diagram keeps its host while later prose streams", async () => {
    const { container, rerender } = render(
      <MarkdownBody
        content={`${mermaidMarkdown(FLOWCHART)}\n\nHere is`}
        isStreaming
        renderCodeBlock={renderCodeBlock}
      />,
    );
    await waitFor(() => {
      expect(container.querySelector("[data-mermaid-diagram='true']")).not.toBeNull();
    });
    const host = container.querySelector("[data-mermaid-diagram='true']");
    rerender(
      <MarkdownBody
        content={`${mermaidMarkdown(FLOWCHART)}\n\nHere is what this means`}
        isStreaming
        renderCodeBlock={renderCodeBlock}
      />,
    );
    expect(container.querySelector("[data-mermaid-diagram='true']")).toBe(host);
  });

  it("C: a growing mermaid body stays a code block until the closer arrives", async () => {
    const { container, rerender } = render(
      <MarkdownBody
        content={mermaidMarkdown("flowchart TB\n  Frontend --> API", false)}
        isStreaming
        renderCodeBlock={renderCodeBlock}
      />,
    );
    expect(renderMermaidDiagram).not.toHaveBeenCalled();
    rerender(
      <MarkdownBody
        content={mermaidMarkdown("flowchart TB\n  Frontend --> API\n  API --> Runtime", false)}
        isStreaming
        renderCodeBlock={renderCodeBlock}
      />,
    );
    expect(renderMermaidDiagram).not.toHaveBeenCalled();
    rerender(
      <MarkdownBody
        content={mermaidMarkdown("flowchart TB\n  Frontend --> API\n  API --> Runtime")}
        isStreaming
        renderCodeBlock={renderCodeBlock}
      />,
    );
    await waitFor(() => {
      expect(renderMermaidDiagram).toHaveBeenCalledTimes(1);
      expect(container.querySelector("[data-mermaid-diagram='true']")).not.toBeNull();
    });
  });

  it("ignores a stale render after the source changes", async () => {
    let resolveFirst!: (svg: string) => void;
    renderMermaidDiagram
      .mockImplementationOnce(() => new Promise<string>((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValueOnce(renderedSvg("p-mermaid-2"));

    const { container, rerender } = render(
      <MarkdownBody
        content={mermaidMarkdown("flowchart LR\n  A --> B")}
        renderCodeBlock={renderCodeBlock}
      />,
    );
    rerender(
      <MarkdownBody
        content={mermaidMarkdown("flowchart LR\n  C --> D")}
        renderCodeBlock={renderCodeBlock}
      />,
    );
    await waitFor(() => {
      expect(renderMermaidDiagram).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      resolveFirst(renderedSvg("stale"));
    });
    await waitFor(() => {
      expect(container.querySelector("[data-mermaid-diagram='true']")?.innerHTML).toContain("p-mermaid-2");
    });
    expect(container.innerHTML).not.toContain("stale");
  });

  it("does not setState after unmount during an in-flight render", async () => {
    let resolveRender!: (svg: string) => void;
    renderMermaidDiagram.mockImplementationOnce(() => new Promise<string>((resolve) => {
      resolveRender = resolve;
    }));
    const { unmount } = render(
      <MarkdownBody
        content={mermaidMarkdown(FLOWCHART)}
        renderCodeBlock={renderCodeBlock}
      />,
    );
    unmount();
    await act(async () => {
      resolveRender(renderedSvg("unmounted"));
    });
  });

  it("renders two mermaid blocks with independent copy payloads", async () => {
    renderMermaidDiagram
      .mockResolvedValueOnce(renderedSvg("p-mermaid-1"))
      .mockResolvedValueOnce(renderedSvg("p-mermaid-2"));
    const first = "flowchart LR\n  A --> B";
    const second = "flowchart LR\n  C --> D";
    const { container } = render(
      <MarkdownBody
        content={`${mermaidMarkdown(first)}\n\nprose\n\n${mermaidMarkdown(second)}`}
        renderCodeBlock={renderCodeBlock}
      />,
    );
    await waitFor(() => {
      expect(container.querySelectorAll("[data-mermaid-diagram='true']")).toHaveLength(2);
    });
    const buttons = container.querySelectorAll('[aria-label="Copy code"]');
    expect(buttons).toHaveLength(2);
    await userEvent.click(buttons[0] as HTMLElement);
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(first);
    await userEvent.click(buttons[1] as HTMLElement);
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(second);
  });

  it("keeps a closed mermaid diagram when a later identical fence is still open", async () => {
    const body = "flowchart LR\n  A --> B";
    const { container } = render(
      <MarkdownBody
        content={`${mermaidMarkdown(body)}\n\n${mermaidMarkdown(body, false)}`}
        isStreaming
        renderCodeBlock={renderCodeBlock}
      />,
    );
    await waitFor(() => {
      expect(container.querySelectorAll("[data-mermaid-diagram='true']")).toHaveLength(1);
    });
    expect(renderMermaidDiagram).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll("[data-markdown-code-block='true']")).toHaveLength(2);
    expect(container.textContent).toContain(body);
  });

  it("falls back to a code block when mermaid source is invalid", async () => {
    renderMermaidDiagram.mockResolvedValueOnce(null);
    const { container } = render(
      <MarkdownBody
        content={'```mermaid\nnot a diagram\n```\n\nStill here.'}
        renderCodeBlock={renderCodeBlock}
      />,
    );
    await waitFor(() => {
      expect(renderMermaidDiagram).toHaveBeenCalled();
    });
    expect(container.querySelector("[data-mermaid-diagram='true']")).toBeNull();
    expect(container.querySelector("[data-markdown-code-block='true']")).not.toBeNull();
    expect(container.textContent).toContain("Still here.");
  });

  it("names the diagram on the wrapper and hides the svg", async () => {
    const { container } = render(
      <MarkdownBody
        content={mermaidMarkdown(FLOWCHART)}
        renderCodeBlock={renderCodeBlock}
      />,
    );
    await waitFor(() => {
      expect(container.querySelector("[data-mermaid-diagram='true']")).not.toBeNull();
    });
    const wrapper = container.querySelector("[data-mermaid-diagram='true']");
    expect(wrapper?.getAttribute("role")).toBe("img");
    expect(wrapper?.getAttribute("aria-label")).toBe("Mermaid diagram");
    expect(wrapper?.getAttribute("aria-hidden")).toBeNull();
    expect(wrapper?.innerHTML).toContain('aria-hidden="true"');
  });
});
