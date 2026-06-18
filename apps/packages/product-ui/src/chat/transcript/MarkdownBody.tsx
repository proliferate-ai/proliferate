import {
  createElement,
  memo,
  useMemo,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@proliferate/ui/primitives/Button";
import { Check, Copy } from "@proliferate/ui/icons";
import { ProviderLinkMention } from "./ProviderLinkMention";

interface MarkdownBodyProps {
  content: string;
  className?: string;
  renderLink?: MarkdownLinkRenderer;
  renderInlineCode?: MarkdownInlineCodeRenderer;
  renderCodeBlock?: MarkdownCodeBlockRenderer;
}

export interface MarkdownLinkRenderInput {
  href: string;
  children: ReactNode;
}

export type MarkdownLinkRenderer = (
  input: MarkdownLinkRenderInput,
) => ReactNode | null | undefined;

export interface MarkdownInlineCodeRenderInput {
  code: string;
  children: ReactNode;
}

export type MarkdownInlineCodeRenderer = (
  input: MarkdownInlineCodeRenderInput,
) => ReactNode | null | undefined;

export interface MarkdownCodeBlockRenderInput {
  code: string;
  language: string | null;
}

export type MarkdownCodeBlockRenderer = (
  input: MarkdownCodeBlockRenderInput,
) => ReactNode | null | undefined;

type MdElementProps = HTMLAttributes<HTMLElement> & {
  node?: unknown;
};

type MdTag =
  | "blockquote"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "li"
  | "ol"
  | "p"
  | "table"
  | "td"
  | "th"
  | "ul";

type MdCodeProps = MdElementProps & {
  children?: ReactNode;
  className?: string;
  renderInlineCode?: MarkdownInlineCodeRenderer;
  renderCodeBlock?: MarkdownCodeBlockRenderer;
};

// Markdown component overrides are the React element *types* for every
// rendered node. They must be referentially stable across renders: a fresh
// arrow function per render is a new component type, which makes React
// unmount and remount the whole markdown DOM (visible as transcript jumps
// while streams/sends re-render rows).
const STATIC_MARKDOWN_COMPONENTS = {
  h1: (props: MdElementProps) =>
    mdHtmlElement("h1", "mb-2.5 mt-5 text-[24px] font-semibold leading-[1.25] text-foreground", props),
  h2: (props: MdElementProps) =>
    mdHtmlElement("h2", "mb-2.5 mt-5 text-[20px] font-semibold leading-[1.25] text-foreground", props),
  h3: (props: MdElementProps) =>
    mdHtmlElement("h3", "mb-2.5 mt-5 text-[17px] font-semibold leading-[22px] text-foreground", props),
  h4: (props: MdElementProps) =>
    mdHtmlElement("h4", "mb-2 mt-4 text-[15px] font-semibold leading-[1.3] text-foreground", props),
  h5: (props: MdElementProps) =>
    mdHtmlElement("h5", "mb-1.5 mt-4 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground", props),
  h6: (props: MdElementProps) =>
    mdHtmlElement("h6", "mb-1.5 mt-4 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground", props),
  p: (props: MdElementProps) =>
    mdHtmlElement("p", "mb-[0.6875rem] mt-0 text-chat leading-[var(--text-chat--line-height)] text-foreground", props),
  ul: (props: MdElementProps) =>
    mdHtmlElement("ul", "my-0 list-disc pl-[1.3125rem] text-chat leading-[var(--text-chat--line-height)] text-foreground [&>li+li]:mt-2", props),
  ol: (props: MdElementProps) =>
    mdHtmlElement("ol", "my-0 list-decimal pl-[1.3125rem] text-chat leading-[var(--text-chat--line-height)] text-foreground [&>li+li]:mt-2", props),
  li: (props: MdElementProps) =>
    mdHtmlElement("li", "pl-0.5 text-chat leading-[var(--text-chat--line-height)]", props),
  blockquote: (props: MdElementProps) =>
    mdHtmlElement(
      "blockquote",
      "my-3 border-l-2 border-border pl-4 text-chat italic leading-[var(--text-chat--line-height)] text-foreground",
      props,
    ),
  hr: () => <hr className="my-3 border-border" />,
  table: (props: MdElementProps) => (
    <div
      className="my-4 overflow-hidden rounded-lg border border-border"
      data-wide-markdown-block="true"
      data-wide-markdown-block-kind="table"
    >
      <div className="overflow-x-auto">
        {mdHtmlElement(
          "table",
          "w-max min-w-full border-collapse text-chat leading-[var(--text-chat--line-height)] [&_tbody_tr:nth-child(2n)]:bg-foreground/[0.02] [&_tbody_tr:last-child_td]:border-b-0",
          props,
        )}
      </div>
    </div>
  ),
  th: (props: MdElementProps) =>
    mdHtmlElement("th", "border-b border-border bg-foreground/5 px-2.5 py-1.5 text-left text-chat font-semibold leading-[var(--text-chat--line-height)] text-foreground", props),
  td: (props: MdElementProps) =>
    mdHtmlElement("td", "border-b border-border px-2.5 py-1.5 align-top text-chat leading-[var(--text-chat--line-height)]", props),
  pre: ({ children, dangerouslySetInnerHTML, node: _node, ...rest }: MdElementProps & { children?: ReactNode }) => {
    if (dangerouslySetInnerHTML) {
      return <pre {...rest} dangerouslySetInnerHTML={dangerouslySetInnerHTML} />;
    }
    return <>{children}</>;
  },
};

function createMarkdownAnchor(renderLink: MarkdownLinkRenderer | undefined) {
  return function MarkdownAnchor(props: MdElementProps & { href?: string; children?: ReactNode }) {
    const {
      children,
      dangerouslySetInnerHTML,
      className: anchorClassName,
      node: _node,
      href,
      ...rest
    } = props;
    if (href && !dangerouslySetInnerHTML) {
      const renderedLink = renderLink?.({ href, children });
      if (renderedLink !== null && renderedLink !== undefined) {
        return <>{renderedLink}</>;
      }
    }
    const merged =
      `text-link-foreground underline decoration-current decoration-[0.5px] decoration-opacity-50 transition-colors hover:decoration-opacity-100${anchorClassName ? ` ${anchorClassName}` : ""}`;
    if (dangerouslySetInnerHTML) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          {...rest}
          className={merged}
          dangerouslySetInnerHTML={dangerouslySetInnerHTML}
        />
      );
    }
    // Default: render an inline provider-icon mention (brand SVG for known
    // hosts, favicon otherwise). Non-URL hrefs degrade to a plain link inside
    // ProviderLinkMention.
    if (href) {
      return <ProviderLinkMention href={href}>{children}</ProviderLinkMention>;
    }
    return (
      <a
        target="_blank"
        rel="noopener noreferrer"
        {...rest}
        className={merged}
      >
        {children}
      </a>
    );
  };
}

export const MarkdownBody = memo(function MarkdownBody({
  content,
  className = "",
  renderLink,
  renderInlineCode,
  renderCodeBlock,
}: MarkdownBodyProps) {
  const markdownClassName = [
    "text-chat leading-[var(--text-chat--line-height)] text-foreground break-words",
    "[&_li>p]:my-0",
    "[&_li>ol]:mt-2",
    "[&_li>ul]:mt-2",
    "[&>ol+p]:mt-4",
    "[&>ul+p]:mt-4",
    // GFM task lists: drop the stray disc bullet and align the checkbox inline.
    // Descendant selector (not `>input`) so it also matches loose lists where
    // the checkbox sits inside a <p>; avoid flex so nested blocks still stack.
    "[&_ul.contains-task-list]:list-none [&>ul.contains-task-list]:pl-0",
    "[&_li.task-list-item]:pl-0",
    "[&_li.task-list-item_input]:mr-2 [&_li.task-list-item_input]:size-3.5 [&_li.task-list-item_input]:align-middle [&_li.task-list-item_input]:accent-link-foreground",
    className,
  ].filter(Boolean).join(" ");

  const components = useMemo(() => ({
    ...STATIC_MARKDOWN_COMPONENTS,
    a: createMarkdownAnchor(renderLink),
    code: (props: MdCodeProps) => (
      <MarkdownCode
        {...props}
        renderInlineCode={renderInlineCode}
        renderCodeBlock={renderCodeBlock}
      />
    ),
  }), [renderCodeBlock, renderInlineCode, renderLink]);

  return (
    <div className={markdownClassName}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={markdownUrlTransform}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

function MarkdownCode({
  className: codeClassName,
  children,
  dangerouslySetInnerHTML,
  renderInlineCode,
  renderCodeBlock,
  node: _node,
  ...rest
}: MdCodeProps) {
  if (dangerouslySetInnerHTML) {
    return (
      <code
        {...rest}
        className="rounded-sm bg-[var(--color-code-block-background,var(--color-muted))] px-1.5 py-0.5 align-baseline font-mono text-[length:calc(var(--text-chat)-1px)] leading-none text-foreground"
        dangerouslySetInnerHTML={dangerouslySetInnerHTML}
      />
    );
  }
  const match = /language-(\w+)/.exec(codeClassName || "");
  const codeString = String(children).replace(/\n$/, "");
  if (match || codeString.includes("\n")) {
    const language = match?.[1] ?? null;
    const renderedCodeBlock = renderCodeBlock?.({ code: codeString, language });
    if (renderedCodeBlock !== null && renderedCodeBlock !== undefined) {
      return <>{renderedCodeBlock}</>;
    }
    return <MarkdownCodeBlockShell code={codeString} label={language} />;
  }
  const renderedInlineCode = renderInlineCode?.({ code: codeString, children });
  if (renderedInlineCode !== null && renderedInlineCode !== undefined) {
    return <>{renderedInlineCode}</>;
  }
  return (
    <code
      {...rest}
      className="rounded-sm bg-[var(--color-code-block-background,var(--color-muted))] px-1.5 py-0.5 align-baseline font-mono text-[length:calc(var(--text-chat)-1px)] leading-none text-foreground"
    >
      {children}
    </code>
  );
}

function markdownUrlTransform(value: string): string {
  if (/^(?:javascript|data|vbscript):/i.test(value.trimStart())) {
    return "";
  }
  return value;
}

/**
 * Codex-style code block card: bordered rounded shell with a header carrying
 * the language label and an always-visible copy icon button. `children`
 * overrides the rendered code content (e.g. app-injected highlighted HTML);
 * `code` remains the copy payload and the plain-text fallback.
 */
export function MarkdownCodeBlockShell({
  code,
  label,
  children,
}: {
  code: string;
  label?: string | null;
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  function copyCode() {
    void writeClipboardText(code)
      .then((copiedSuccessfully) => {
        if (!copiedSuccessfully) {
          return;
        }
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      });
  }

  return (
    <div className="relative my-[14px] w-full min-w-0 overflow-clip rounded-lg border border-transparent bg-[var(--color-code-block-background,var(--color-card))]">
      <div className="flex select-none items-center justify-between gap-2 py-1 pl-2 pr-1.5 text-[length:var(--text-chat-meta,11px)] text-muted-foreground">
        {label ? <span className="min-w-0 flex-1 truncate">{label}</span> : <span className="min-w-0 flex-1" />}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={copyCode}
          className="size-6 shrink-0 rounded-md bg-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Copy code"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
      <div className="overflow-x-auto overflow-y-auto p-2 font-mono text-[length:var(--text-chat)] font-normal leading-[1.5] [&_.shiki]:!bg-transparent [&_pre]:!m-0 [&_pre]:!p-0 [&_pre]:!bg-transparent [&_code]:text-[length:var(--text-chat)] [&_code]:leading-[1.5]">
        {children ?? (
          <pre className="m-0 p-0">
            <code className="whitespace-pre font-mono text-[length:var(--text-chat)] font-normal leading-[1.5] text-foreground">
              {code}
            </code>
          </pre>
        )}
      </div>
    </div>
  );
}

async function writeClipboardText(value: string): Promise<boolean> {
  if (writeClipboardTextFallback(value)) {
    return true;
  }
  const clipboard = navigator.clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(value);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function writeClipboardTextFallback(value: string): boolean {
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "true");
  input.style.position = "fixed";
  input.style.left = "-9999px";
  input.style.top = "0";
  document.body.appendChild(input);
  input.focus();
  input.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(input);
  }
}

function mdHtmlElement(tag: MdTag, baseClassName: string, props: MdElementProps) {
  const {
    children,
    dangerouslySetInnerHTML,
    className,
    node: _node,
    ...rest
  } = props;
  const mergedClassName = [baseClassName, className].filter(Boolean).join(" ");

  if (dangerouslySetInnerHTML) {
    return createElement(tag, {
      ...rest,
      className: mergedClassName,
      dangerouslySetInnerHTML,
    });
  }
  return createElement(tag, { ...rest, className: mergedClassName }, children);
}
