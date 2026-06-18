import {
  createElement,
  isValidElement,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { HighlightedCodePanel } from "./HighlightedCodePanel";
import { FilePathLink } from "./FilePathLink";
import { GitHubLinkChip } from "./GitHubLinkChip";
import { looksLikePath } from "@/lib/domain/files/path-detection";
import { parseGitHubLink } from "@/lib/domain/links/github-link";

type MdElementProps = HTMLAttributes<HTMLElement> & {
  node?: unknown;
};

type MdTag =
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
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
    // GFM task lists: drop the stray disc bullet and align the checkbox inline.
    // Descendant selector (not `>input`) so it also matches loose lists where
    // the checkbox sits inside a <p>; avoid flex so nested blocks still stack.
    "[&_ul.contains-task-list]:list-none [&_ul.contains-task-list]:pl-0",
    "[&_li.task-list-item]:pl-0",
    "[&_li.task-list-item_input]:mr-2 [&_li.task-list-item_input]:size-3.5 [&_li.task-list-item_input]:align-middle [&_li.task-list-item_input]:accent-link-foreground",
    className,
  ].filter(Boolean).join(" ");

  return (
    <div className={markdownClassName}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (props) =>
            mdHtmlElement("h1", "mb-3 mt-6 border-b border-border pb-1.5 text-[24px] font-semibold leading-[1.25] text-foreground first:mt-0", props),
          h2: (props) =>
            mdHtmlElement("h2", "mb-2.5 mt-5 border-b border-border pb-1 text-[20px] font-semibold leading-[1.25] text-foreground", props),
          h3: (props) =>
            mdHtmlElement("h3", "mb-2 mt-5 text-[17px] font-semibold leading-[1.3] text-foreground", props),
          h4: (props) =>
            mdHtmlElement("h4", "mb-2 mt-4 text-[15px] font-semibold leading-[1.3] text-foreground", props),
          h5: (props) =>
            mdHtmlElement("h5", "mb-1.5 mt-4 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground", props),
          h6: (props) =>
            mdHtmlElement("h6", "mb-1.5 mt-4 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground", props),
          p: (props) =>
            mdHtmlElement("p", "my-2 text-chat leading-[var(--text-chat--line-height)] text-foreground", props),
          ul: (props) =>
            mdHtmlElement("ul", "mt-0 mb-4 list-disc pl-4 text-chat leading-[var(--text-chat--line-height)] text-foreground", props),
          ol: (props) =>
            mdHtmlElement("ol", "mt-1.5 mb-3 list-decimal pl-8 text-chat leading-[var(--text-chat--line-height)] text-foreground", props),
          li: (props) => mdHtmlElement("li", "mb-1.5 text-chat leading-[var(--text-chat--line-height)]", props),
          blockquote: (props) =>
            mdHtmlElement(
              "blockquote",
              "my-3 border-l-2 border-border pl-4 text-chat leading-[var(--text-chat--line-height)] italic text-foreground",
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
            if (href && !dangerouslySetInnerHTML) {
              const githubLink = parseGitHubLink(href);
              if (githubLink && isAutolinkText(href, children)) {
                return <GitHubLinkChip link={githubLink} />;
              }
              if (looksLikePath(href)) {
                return (
                  <FilePathLink rawPath={href}>
                    {children}
                  </FilePathLink>
                );
              }
            }
            const merged =
              `text-link-foreground underline decoration-current decoration-[0.5px] decoration-opacity-50 transition-colors hover:decoration-opacity-100${className ? ` ${className}` : ""}`;
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
                  "min-w-full w-max border-collapse text-chat leading-[var(--text-chat--line-height)] [&_tbody_tr:nth-child(2n)]:bg-foreground/[0.02] [&_tbody_tr:last-child_td]:border-b-0",
                  props,
                )}
              </div>
            </div>
          ),
          th: (props) =>
            mdHtmlElement("th", "border-b border-border bg-foreground/5 px-2.5 py-1.5 text-left text-chat leading-[var(--text-chat--line-height)] font-semibold text-foreground", props),
          td: (props) => mdHtmlElement("td", "border-b border-border px-2.5 py-1.5 align-top text-chat leading-[var(--text-chat--line-height)]", props),
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
                  className="rounded-sm bg-[var(--color-code-block-background,var(--color-muted))] px-1.5 py-0.5 align-baseline font-mono text-[length:var(--readable-code-font-size)] leading-none text-foreground"
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
            return (
              <code
                {...rest}
                className="rounded-sm bg-[var(--color-code-block-background,var(--color-muted))] px-1.5 py-0.5 align-baseline font-mono text-[length:var(--readable-code-font-size)] leading-none text-foreground"
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

function isAutolinkText(href: string, children: ReactNode): boolean {
  const text = markdownChildrenText(children);
  if (!text) {
    return false;
  }
  return normalizeLinkText(text) === normalizeLinkText(href);
}

function markdownChildrenText(children: ReactNode): string | null {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (children === null || children === undefined || typeof children === "boolean") {
    return "";
  }
  if (Array.isArray(children)) {
    const parts = children.map(markdownChildrenText);
    return parts.every((part): part is string => part !== null) ? parts.join("") : null;
  }
  if (isValidElement<{ children?: ReactNode }>(children)) {
    return markdownChildrenText(children.props.children);
  }
  return null;
}

function normalizeLinkText(value: string): string {
  return value.trim().replace(/\/$/, "");
}
