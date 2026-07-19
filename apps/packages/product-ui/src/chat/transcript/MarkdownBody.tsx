import {
  Children,
  cloneElement,
  createElement,
  isValidElement,
  memo,
  useContext,
  useMemo,
  type ContextType,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ProviderLinkMention } from "./ProviderLinkMention";
import { MarkdownCodeBlockShell } from "./MarkdownCodeBlock";
import {
  ChatContentSearchQueryContext,
  useChatContentSearchPaint,
  type ChatContentSearchPaint,
} from "./ChatContentSearchContext";
import { markSearchChildren } from "./MarkdownContentSearchMarks";
import { stabilizeStreamingMarkdown } from "./streaming-markdown";
import {
  type HastNode,
  MarkdownRevealContext,
  revealChildren,
} from "./MarkdownRevealText";

interface MarkdownBodyProps {
  content: string;
  className?: string;
  renderLink?: MarkdownLinkRenderer;
  renderInlineCode?: MarkdownInlineCodeRenderer;
  renderCodeBlock?: MarkdownCodeBlockRenderer;
  taskListItems?: MarkdownTaskListItemPresentation;
  /** Parse an incomplete live tail defensively while source text is streaming. */
  isStreaming?: boolean;
  /** Fade words in the live source suffix independently. */
  revealText?: boolean;
  /** Live-source offset before which word fades have completed. */
  revealedUpTo?: number;
  /**
   * Opt this body into the chat content-search paint layer. Only the
   * conversation prose (user/assistant messages) sets this; secondary chrome
   * (tool detail bodies, plan cards) leaves it false so its text isn't
   * highlighted and never appears in the search index.
   */
  enableContentSearch?: boolean;
}

/**
 * "inline" keeps GFM task-list checkboxes in the text flow (default chat
 * prose). "grid" restructures each task item into a two-column grid —
 * checkbox column auto, content column minmax(0,1fr) — so wrapped lines and
 * nested blocks stay aligned under the label (codex plan treatment).
 */
export type MarkdownTaskListItemPresentation = "inline" | "grid";

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
  | "del"
  | "em"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "li"
  | "ol"
  | "p"
  | "strong"
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

// Message prose reads at --prose-text-size, which the assistant/user message
// wrappers set to --text-message (the composer size). Every other MarkdownBody
// context — tool-row detail bodies, plan cards, work history — leaves the var
// unset, so the fallback keeps that secondary chrome on --text-chat while
// conversation bodies grow to match the composer. Authenticated CSS owns the
// scoped font-size and line-height so chat rules stay out of the login bundle.
const LI_CLASSNAME = "pl-0.5";

// Markdown component overrides are the React element *types* for every
// rendered node. They must be referentially stable across renders: a fresh
// arrow function per render is a new component type, which makes React
// unmount and remount the whole markdown DOM (visible as transcript jumps
// while streams/sends re-render rows).

// Factory: creates a stable component that reads the search context and
// delegates without rebuilding the components map (see the identity comment).
function mdComponent(tag: MdTag, className: string) {
  return (props: MdElementProps) => {
    const revealState = useContext(MarkdownRevealContext);
    const searchPaint = useChatContentSearchPaint();
    return mdHtmlElement(tag, className, props, revealState, searchPaint);
  };
}

const STATIC_MARKDOWN_COMPONENTS = {
  h1: mdComponent("h1", "mb-2.5 mt-5 font-semibold leading-[1.25] text-foreground"),
  h2: mdComponent("h2", "mb-2.5 mt-5 font-semibold leading-[1.3] text-foreground"),
  h3: mdComponent("h3", "mb-2.5 mt-5 font-semibold leading-[1.35] text-foreground"),
  h4: mdComponent("h4", "mb-2 mt-4 font-semibold leading-[1.4] text-foreground"),
  h5: mdComponent("h5", "mb-1.5 mt-4 font-semibold uppercase tracking-wide text-muted-foreground"),
  h6: mdComponent("h6", "mb-1.5 mt-4 font-semibold uppercase tracking-wide text-muted-foreground"),
  strong: mdComponent("strong", "font-semibold"),
  em: mdComponent("em", "italic"),
  del: mdComponent("del", "line-through"),
  p: mdComponent("p", "mb-[0.6875rem] mt-0 text-foreground"),
  ul: mdComponent("ul", "mb-[0.6875rem] mt-0 list-disc pl-[1.3125rem] text-foreground [&>li+li]:mt-2"),
  ol: mdComponent("ol", "mb-[0.6875rem] mt-0 list-decimal pl-[1.3125rem] text-foreground [&>li+li]:mt-2"),
  li: mdComponent("li", LI_CLASSNAME),
  blockquote: mdComponent("blockquote", "my-3 border-l pl-4 text-foreground"),
  hr: () => <hr className="my-3 border-border" />,
  table: (props: MdElementProps) => (
    <div
      className="my-4 min-w-0 max-w-full overflow-hidden rounded-lg border"
      data-markdown-table-shell="true"
      data-wide-markdown-block="true"
      data-wide-markdown-block-kind="table"
    >
      <div
        className="max-w-full overflow-x-auto overscroll-x-contain"
        data-markdown-table-scroll="true"
      >
        {mdHtmlElement(
          "table",
          "w-max min-w-full max-w-none border-collapse [&_tbody_tr:nth-child(2n)]:bg-foreground/[0.018] [&_tbody_tr:last-child_td]:border-b-0",
          props,
        )}
      </div>
    </div>
  ),
  th: mdComponent("th", "border-b bg-foreground/[0.035] px-3 py-2 text-left font-medium text-foreground"),
  td: mdComponent("td", "border-b px-3 py-2 align-top"),
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

// Codex plan task-list grid: checkbox column sized auto, content column
// minmax(0,1fr). react-markdown emits tight task items as
// `li > input + <inline content>` (and loose ones with the input inside the
// leading <p>), so a pure-CSS grid would scatter the inline runs across
// cells; instead the item is restructured into checkbox + content wrapper.
function GridTaskListItem(props: MdElementProps & { children?: ReactNode }) {
  const { children, dangerouslySetInnerHTML, className, node: _node, ...rest } = props;
  const isTaskListItem =
    typeof className === "string" && className.includes("task-list-item");
  const split = isTaskListItem && !dangerouslySetInnerHTML
    ? splitTaskListItemChildren(children)
    : null;
  if (!split) {
    return mdHtmlElement("li", LI_CLASSNAME, props);
  }
  const mergedClassName = [
    LI_CLASSNAME,
    "grid grid-cols-[auto_minmax(0,1fr)]",
    className,
  ].filter(Boolean).join(" ");
  return (
    <li {...rest} className={mergedClassName}>
      {cloneElement(split.checkbox, {
        // Codex nudge: drop the checkbox 0.25rem so it optically centers on
        // the first text line.
        className: [split.checkbox.props.className, "mt-1"].filter(Boolean).join(" "),
      })}
      <div className="min-w-0">{split.content}</div>
    </li>
  );
}

interface SplitTaskListItem {
  checkbox: ReactElement<{ className?: string }>;
  content: ReactNode[];
}

function splitTaskListItemChildren(children: ReactNode): SplitTaskListItem | null {
  const nodes = Children.toArray(children);
  // Tight items: the checkbox input is a direct child of the <li>.
  const inputIndex = nodes.findIndex(isCheckboxElement);
  if (inputIndex >= 0) {
    return {
      checkbox: nodes[inputIndex] as SplitTaskListItem["checkbox"],
      content: [...nodes.slice(0, inputIndex), ...nodes.slice(inputIndex + 1)],
    };
  }
  // Loose items: the checkbox sits at the head of the leading paragraph.
  const paragraphIndex = nodes.findIndex(
    (node) => isValidElement(node) && hastTagName(node) === "p",
  );
  if (paragraphIndex < 0) {
    return null;
  }
  const paragraph = nodes[paragraphIndex] as ReactElement<{ children?: ReactNode }>;
  const paragraphChildren = Children.toArray(paragraph.props.children);
  const nestedInputIndex = paragraphChildren.findIndex(isCheckboxElement);
  if (nestedInputIndex < 0) {
    return null;
  }
  const strippedParagraph = cloneElement(paragraph, undefined, ...[
    ...paragraphChildren.slice(0, nestedInputIndex),
    ...paragraphChildren.slice(nestedInputIndex + 1),
  ]);
  return {
    checkbox: paragraphChildren[nestedInputIndex] as SplitTaskListItem["checkbox"],
    content: [
      ...nodes.slice(0, paragraphIndex),
      strippedParagraph,
      ...nodes.slice(paragraphIndex + 1),
    ],
  };
}

function isCheckboxElement(node: ReactNode): boolean {
  return isValidElement(node) && node.type === "input";
}

function hastTagName(node: ReactElement): string | null {
  const hast = (node.props as { node?: { tagName?: unknown } }).node;
  return typeof hast?.tagName === "string" ? hast.tagName : null;
}

export const MarkdownBody = memo(function MarkdownBody({
  content,
  className = "",
  renderLink,
  renderInlineCode,
  renderCodeBlock,
  taskListItems = "inline",
  isStreaming = false,
  revealText = false,
  revealedUpTo = 0,
  enableContentSearch = false,
}: MarkdownBodyProps) {
  const parsedContent = useMemo(
    () => (isStreaming ? stabilizeStreamingMarkdown(content) : content),
    [content, isStreaming],
  );
  const markdownClassName = [
    "chat-markdown min-w-0 max-w-full text-foreground break-words",
    "[&_li>p]:my-0",
    "[&_li>ol]:mt-2 [&_li>ol]:mb-0",
    "[&_li>ul]:mt-2 [&_li>ul]:mb-0",
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
    ...(taskListItems === "grid" ? { li: GridTaskListItem } : null),
    a: createMarkdownAnchor(renderLink),
    code: (props: MdCodeProps) => (
      <MarkdownCode
        {...props}
        renderInlineCode={renderInlineCode}
        renderCodeBlock={renderCodeBlock}
      />
    ),
  }), [renderCodeBlock, renderInlineCode, renderLink, taskListItems]);

  const revealState = useMemo(
    () => revealText ? { enabled: true, revealedUpTo } : null,
    [revealText, revealedUpTo],
  );

  const body = (
    <MarkdownRevealContext.Provider value={revealState}>
      <div className={markdownClassName} data-markdown-body="true">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          urlTransform={markdownUrlTransform}
          components={components}
        >
          {parsedContent}
        </ReactMarkdown>
      </div>
    </MarkdownRevealContext.Provider>
  );

  // Secondary chrome (tool detail bodies, plan cards) reuses MarkdownBody but
  // must stay out of chat content-search. Shadow the query context to null so
  // the highlighter is inert regardless of the ambient transcript query.
  if (!enableContentSearch) {
    return (
      <ChatContentSearchQueryContext.Provider value={null}>
        {body}
      </ChatContentSearchQueryContext.Provider>
    );
  }

  return body;
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
        className="rounded-sm bg-[var(--color-code-block-background,var(--color-muted))] px-1 align-baseline font-mono text-foreground"
        data-markdown-inline-code="true"
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
      className="rounded-sm bg-[var(--color-code-block-background,var(--color-muted))] px-1 align-baseline font-mono text-foreground"
      data-markdown-inline-code="true"
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

// Re-export for downstream consumers that import from this module.
export { MarkdownCodeBlockShell } from "./MarkdownCodeBlock";

// mdHtmlElement is called from within STATIC_MARKDOWN_COMPONENTS entries,
// which ARE React component functions (hooks-valid call site).
function mdHtmlElement(
  tag: MdTag,
  baseClassName: string,
  props: MdElementProps,
  revealState: ContextType<typeof MarkdownRevealContext> = null,
  searchPaint: ChatContentSearchPaint | null = null,
) {
  const {
    children,
    dangerouslySetInnerHTML,
    className,
    node,
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
  const finalChildren = searchPaint
    ? markSearchChildren(children, searchPaint.query, searchPaint.rowUnitId)
    : revealChildren(children, node as HastNode | undefined, revealState);
  return createElement(tag, { ...rest, className: mergedClassName }, finalChildren);
}
