import { createElement, type HTMLAttributes } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { HighlightedCodePanel } from "./HighlightedCodePanel";
import { FilePathLink } from "./FilePathLink";
import { looksLikePath } from "@/lib/domain/files/path-detection";

type MdElementProps = HTMLAttributes<HTMLElement> & {
  node?: unknown;
};

type MdTag =
  | "h1"
  | "h2"
  | "h3"
  | "p"
  | "ul"
  | "ol"
  | "li"
  | "blockquote"
  | "th"
  | "td"
  | "table";

/**
 * react-markdown may pass `dangerouslySetInnerHTML` for raw HTML in markdown (`skipHtml` default).
 * React forbids using both that and `children` on the same DOM node.
 */
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

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({
  content,
  className = "",
}: MarkdownRendererProps) {
  const markdownClassName = [
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
            mdHtmlElement("h1", "mb-2 mt-3 text-chat leading-relaxed font-bold text-foreground", props),
          h2: (props) =>
            mdHtmlElement("h2", "mb-2 mt-3 text-chat leading-relaxed font-bold text-foreground", props),
          h3: (props) =>
            mdHtmlElement("h3", "mb-1 mt-2 text-chat leading-relaxed font-semibold text-foreground", props),
          p: (props) =>
            mdHtmlElement("p", "my-2 text-chat leading-relaxed text-foreground", props),
          ul: (props) =>
            mdHtmlElement("ul", "mt-0 mb-4 list-disc pl-4 text-chat leading-relaxed text-foreground", props),
          ol: (props) =>
            mdHtmlElement("ol", "mt-1.5 mb-3 list-decimal pl-8 text-chat leading-relaxed text-foreground", props),
          li: (props) => mdHtmlElement("li", "mb-1.5 text-chat leading-relaxed", props),
          blockquote: (props) =>
            mdHtmlElement(
              "blockquote",
              "my-2 border-l-2 border-border pl-3 text-chat leading-relaxed text-muted-foreground",
              props,
            ),
          a: (props) => {
            const {
              children,
              dangerouslySetInnerHTML,
              className,
              node: _node,
              href,
              ...rest
            } = props;
            const merged =
              `underline text-foreground hover:text-muted-foreground transition-colors${className ? ` ${className}` : ""}`;
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
            <div className="overflow-x-auto my-2">
              {mdHtmlElement("table", "table-auto w-full", props)}
            </div>
          ),
          th: (props) =>
            mdHtmlElement("th", "border border-border px-3 py-1 text-[11px] leading-relaxed font-medium text-left", props),
          td: (props) => mdHtmlElement("td", "border border-border px-3 py-1 text-[11px] leading-relaxed", props),
          code: ({
            className: codeClassName,
            children,
            dangerouslySetInnerHTML,
            node: _node,
            ...rest
          }) => {
            if (dangerouslySetInnerHTML) {
              return (
                <code
                  {...rest}
                  className="rounded-sm bg-foreground/[0.06] px-1 py-0 align-baseline font-mono text-[inherit] leading-[inherit] font-medium text-foreground"
                  dangerouslySetInnerHTML={dangerouslySetInnerHTML}
                />
              );
            }
            const match = /language-(\w+)/.exec(codeClassName || "");
            const codeString = String(children).replace(/\n$/, "");
            const isBlock = codeString.includes("\n");
            if (match) {
              return (
                <HighlightedCodePanel
                  code={codeString}
                  language={match[1]}
                  className="my-2"
                />
              );
            }
            if (isBlock) {
              return (
                <HighlightedCodePanel
                  code={codeString}
                  language="text"
                  showLanguageLabel={false}
                  className="my-2"
                />
              );
            }
            if (looksLikePath(codeString)) {
              return <FilePathLink rawPath={codeString} />;
            }
            return (
              <code
                {...rest}
                className="rounded-sm bg-foreground/[0.06] px-1 py-0 align-baseline font-mono text-[inherit] leading-[inherit] font-medium text-foreground"
              >
                {children}
              </code>
            );
          },
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
