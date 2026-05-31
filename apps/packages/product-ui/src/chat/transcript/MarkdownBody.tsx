import {
  createElement,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@proliferate/ui/primitives/Button";

interface MarkdownBodyProps {
  content: string;
  className?: string;
}

type MdElementProps = HTMLAttributes<HTMLElement> & {
  node?: unknown;
};

type MdTag =
  | "blockquote"
  | "h1"
  | "h2"
  | "h3"
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
};

export function MarkdownBody({
  content,
  className = "",
}: MarkdownBodyProps) {
  const markdownClassName = [
    "text-chat leading-[var(--text-chat--line-height)] text-foreground",
    "[&_li>p]:my-0",
    "[&_li>ol]:mt-2",
    "[&_li>ul]:mt-2",
    className,
  ].filter(Boolean).join(" ");

  return (
    <div className={markdownClassName}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (props) =>
            mdHtmlElement("h1", "mb-2 mt-3 text-chat font-bold leading-[var(--text-chat--line-height)] text-foreground", props),
          h2: (props) =>
            mdHtmlElement("h2", "mb-2 mt-3 text-chat font-bold leading-[var(--text-chat--line-height)] text-foreground", props),
          h3: (props) =>
            mdHtmlElement("h3", "mb-1 mt-2 text-chat font-semibold leading-[var(--text-chat--line-height)] text-foreground", props),
          p: (props) =>
            mdHtmlElement("p", "my-2 text-chat leading-[var(--text-chat--line-height)] text-foreground", props),
          ul: (props) =>
            mdHtmlElement("ul", "mb-4 mt-0 list-disc pl-4 text-chat leading-[var(--text-chat--line-height)] text-foreground", props),
          ol: (props) =>
            mdHtmlElement("ol", "mb-3 mt-1.5 list-decimal pl-8 text-chat leading-[var(--text-chat--line-height)] text-foreground", props),
          li: (props) =>
            mdHtmlElement("li", "mb-1.5 text-chat leading-[var(--text-chat--line-height)]", props),
          blockquote: (props) =>
            mdHtmlElement(
              "blockquote",
              "my-3 border-l-2 border-border pl-4 text-chat italic leading-[var(--text-chat--line-height)] text-foreground",
              props,
            ),
          a: (props) => {
            const {
              children,
              dangerouslySetInnerHTML,
              className: anchorClassName,
              node: _node,
              href,
              ...rest
            } = props;
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
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                {...rest}
                className={merged}
              >
                {children}
              </a>
            );
          },
          hr: () => <hr className="my-3 border-border" />,
          table: (props) => (
            <div
              className="my-4 overflow-hidden rounded-lg border border-border"
              data-wide-markdown-block="true"
              data-wide-markdown-block-kind="table"
            >
              <div className="overflow-x-auto">
                {mdHtmlElement(
                  "table",
                  "w-max min-w-full border-collapse text-chat leading-[var(--text-chat--line-height)]",
                  props,
                )}
              </div>
            </div>
          ),
          th: (props) =>
            mdHtmlElement("th", "border-b border-border bg-foreground/5 p-1 text-left text-chat font-semibold leading-[var(--text-chat--line-height)] text-foreground", props),
          td: (props) =>
            mdHtmlElement("td", "border-b border-border p-1 text-chat leading-[var(--text-chat--line-height)]", props),
          code: (props) => <MarkdownCode {...props} />,
          pre: ({ children, dangerouslySetInnerHTML, node: _node, ...rest }) => {
            if (dangerouslySetInnerHTML) {
              return <pre {...rest} dangerouslySetInnerHTML={dangerouslySetInnerHTML} />;
            }
            return <>{children}</>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function MarkdownCode({
  className: codeClassName,
  children,
  dangerouslySetInnerHTML,
  node: _node,
  ...rest
}: MdCodeProps) {
  if (dangerouslySetInnerHTML) {
    return (
      <code
        {...rest}
        className="rounded-sm bg-[var(--color-code-block-background,var(--color-muted))] px-1.5 py-0.5 align-baseline font-mono text-[length:var(--readable-code-font-size)] leading-none text-foreground"
        dangerouslySetInnerHTML={dangerouslySetInnerHTML}
      />
    );
  }
  const match = /language-(\w+)/.exec(codeClassName || "");
  const codeString = String(children).replace(/\n$/, "");
  if (match || codeString.includes("\n")) {
    return (
      <MarkdownCodeBlock
        code={codeString}
        language={match?.[1] ?? "text"}
        showLanguageLabel={Boolean(match?.[1])}
      />
    );
  }
  return (
    <code
      {...rest}
      className="rounded-sm bg-[var(--color-code-block-background,var(--color-muted))] px-1.5 py-0.5 align-baseline font-mono text-[length:var(--readable-code-font-size)] leading-none text-foreground"
    >
      {children}
    </code>
  );
}

function MarkdownCodeBlock({
  code,
  language,
  showLanguageLabel,
}: {
  code: string;
  language: string;
  showLanguageLabel: boolean;
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
    <div className="group/code relative my-2 overflow-clip rounded-lg border border-input bg-[var(--color-code-block-background,var(--color-card))]">
      <div className="sticky top-0 z-10 flex select-none items-center justify-between px-2 py-1 text-sm text-muted-foreground">
        {showLanguageLabel ? <span className="min-w-0 truncate">{language}</span> : <span />}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={copyCode}
          className="h-6 rounded-md bg-transparent px-1.5 py-0 text-sm text-muted-foreground opacity-0 transition-colors hover:bg-muted hover:text-foreground group-focus-within/code:opacity-100 group-hover/code:opacity-100"
          aria-label="Copy"
        >
          {copied ? "Copied!" : "Copy"}
        </Button>
      </div>
      <div className="overflow-x-auto overflow-y-auto p-2 font-mono text-[length:var(--readable-code-font-size)] font-medium leading-[var(--readable-code-line-height)]">
        <pre className="m-0 p-0">
          <code className="font-mono text-[length:var(--readable-code-font-size)] font-medium leading-[var(--readable-code-line-height)] text-foreground">
            {code}
          </code>
        </pre>
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
