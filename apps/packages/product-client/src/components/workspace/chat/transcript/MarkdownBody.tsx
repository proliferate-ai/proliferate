import {
  createContext,
  memo,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ProviderLinkMention } from "./ProviderLinkMention";
import { CHAT_TRANSCRIPT_LINK_CLASS } from "#product/config/transcript-link-styles";
import { MarkdownCodeBlockShell } from "./MarkdownCodeBlock";
import {
  MARKDOWN_INLINE_CODE_CLASS,
  MarkdownInlineCode,
  MarkdownSurfaceProvider,
  type MarkdownSurface,
} from "./MarkdownInlineCode";
import {
  ChatContentSearchQueryContext,
  useChatContentSearchPaint,
} from "./ChatContentSearchContext";
import { stabilizeStreamingMarkdown } from "#product/lib/domain/chat/transcript/streaming-markdown";
import { normalizeLocalFileLinkMarkdown } from "#product/lib/domain/chat/transcript/file-link-markdown";
import { MarkdownRevealContext } from "./MarkdownRevealText";
import {
  LI_CLASSNAME,
  mdHtmlElement,
  type MdElementProps,
  type MdTag,
} from "./MarkdownHtmlElement";
import { GridTaskListItem } from "./MarkdownTaskListItem";

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
  /**
   * What kind of text this body holds. Defaults to conversation content;
   * a file viewer rendering a file's own markdown must pass "file-content" so
   * message-only reading affordances (the inline-code hex swatch) stay out of
   * displayed file bytes. See MarkdownSurface for why the default points this
   * way.
   */
  surface?: MarkdownSurface;
}

/**
 * "inline" keeps GFM task-list checkboxes in the text flow (default chat
 * prose). "grid" restructures each task item into a two-column grid —
 * checkbox column auto, content column minmax(0,1fr) — so wrapped lines and
 * nested blocks stay aligned under the label (plan-view treatment).
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

type MdCodeProps = MdElementProps & {
  children?: ReactNode;
  className?: string;
  renderInlineCode?: MarkdownInlineCodeRenderer;
  renderCodeBlock?: MarkdownCodeBlockRenderer;
};

const MarkdownCodeBlockContext = createContext(false);

// Message prose reads at --prose-text-size, which the assistant/user message
// wrappers set to --text-message (the composer size). Every other MarkdownBody
// context — tool-row detail bodies, plan cards, work history — leaves the var
// unset, so the fallback keeps that secondary chrome on --text-chat while
// conversation bodies grow to match the composer. Authenticated CSS owns the
// scoped font-size and line-height so chat rules stay out of the login bundle.
//
// Prose elements (paragraphs, headings, lists, blockquotes) fill the full
// shared 40rem thread column — the same width as wide blocks (tables, code),
// the composer below, and the new-chat flow — so the measure does not change
// when a session starts. See the single-measure note on `markdownClassName`.
const PROSE_MEASURE_CLASSNAME = "max-w-full";

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
  h1: mdComponent("h1", `mb-2.5 mt-5 ${PROSE_MEASURE_CLASSNAME} text-title font-semibold text-foreground`),
  h2: mdComponent("h2", `mb-2.5 mt-5 ${PROSE_MEASURE_CLASSNAME} text-heading font-semibold text-foreground`),
  h3: mdComponent("h3", `mb-2.5 mt-5 ${PROSE_MEASURE_CLASSNAME} text-body-emphasis font-semibold text-foreground`),
  h4: mdComponent("h4", `mb-2 mt-4 ${PROSE_MEASURE_CLASSNAME} text-body-emphasis font-semibold text-foreground`),
  h5: mdComponent("h5", `mb-1.5 mt-4 ${PROSE_MEASURE_CLASSNAME} font-semibold uppercase tracking-wide text-muted-foreground`),
  h6: mdComponent("h6", `mb-1.5 mt-4 ${PROSE_MEASURE_CLASSNAME} font-semibold uppercase tracking-wide text-muted-foreground`),
  strong: mdComponent("strong", "font-semibold"),
  em: mdComponent("em", "italic"),
  del: mdComponent("del", "line-through"),
  p: mdComponent("p", `mb-[0.6875rem] mt-0 ${PROSE_MEASURE_CLASSNAME} text-foreground`),
  ul: mdComponent("ul", `mb-[0.6875rem] mt-0 ${PROSE_MEASURE_CLASSNAME} list-disc pl-[1.3125rem] text-foreground [&>li+li]:mt-2`),
  ol: mdComponent("ol", `mb-[0.6875rem] mt-0 ${PROSE_MEASURE_CLASSNAME} list-decimal pl-[1.3125rem] text-foreground [&>li+li]:mt-2`),
  li: mdComponent("li", LI_CLASSNAME),
  blockquote: mdComponent("blockquote", `my-3 ${PROSE_MEASURE_CLASSNAME} border-l-4 border-border pl-6 py-2 text-foreground`),
  hr: () => <hr className="my-3 border-border" />,
  table: (props: MdElementProps) => (
    // ui-foundation-escalation: [CHAT-04]'s RULED block adopts
    // --container-transcript-wide (56rem) for wide blocks like this table.
    // This table uses the full 48rem --container-transcript-thread column
    // (like all prose — see markdownClassName), but 56rem exceeds that column
    // — reaching it would need a breakout (negative-margin / container-
    // query) restructure applied at every MarkdownBody consumer (transcript
    // rows, plan cards, tool-detail panels). That restructure is out of
    // scope for this pass; this table stays at max-w-full
    // (container-relative to the 48rem shared chat column) as a conscious
    // partial adoption rather than an unreachable cap.
    <div
      className="my-4 min-w-0 max-w-full overflow-hidden rounded-lg border"
      data-markdown-table-shell="true"
      data-wide-markdown-block="true"
      data-wide-markdown-block-kind="table"
    >
      <div
        className="max-w-full overflow-x-auto overscroll-x-none"
        data-markdown-table-scroll="true"
      >
        {mdHtmlElement(
          "table",
          "w-max min-w-full max-w-none border-collapse [&_tbody_tr:nth-child(2n)]:bg-surface-elevated-secondary [&_tbody_tr:last-child_td]:border-b-0",
          props,
        )}
      </div>
    </div>
  ),
  th: mdComponent("th", "border-b bg-surface-elevated-secondary px-3 py-2 text-left font-medium text-foreground"),
  td: mdComponent("td", "border-b px-3 py-2 align-top"),
  pre: ({ children, dangerouslySetInnerHTML, node: _node, ...rest }: MdElementProps & { children?: ReactNode }) => {
    if (dangerouslySetInnerHTML) {
      return <pre {...rest} dangerouslySetInnerHTML={dangerouslySetInnerHTML} />;
    }
    return (
      <MarkdownCodeBlockContext.Provider value>
        {children}
      </MarkdownCodeBlockContext.Provider>
    );
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
      `${CHAT_TRANSCRIPT_LINK_CLASS}${anchorClassName ? ` ${anchorClassName}` : ""}`;
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
  taskListItems = "inline",
  isStreaming = false,
  revealText = false,
  revealedUpTo = 0,
  enableContentSearch = false,
  surface = "message",
}: MarkdownBodyProps) {
  const parsedContent = useMemo(() => {
    const source = isStreaming ? stabilizeStreamingMarkdown(content) : content;
    // The local-file link repair is a *message* affordance. A file viewer
    // renders a file's own bytes, so rewriting its destinations would corrupt
    // displayed content rather than fix agent prose.
    return surface === "file-content" ? source : normalizeLocalFileLinkMarkdown(source);
  }, [content, isStreaming, surface]);
  const markdownClassName = [
    // Single measure: the thread column (config/chat-layout.ts) uses the same 48rem
    // --container-transcript-thread token as the new-chat flow, and BOTH
    // wide blocks (tables, code — see the `table` override below) and prose fill it
    // (PROSE_MEASURE_CLASSNAME is max-w-full too), so an assistant message
    // reads at the same width the user is typing into before and after launch.
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
    <MarkdownSurfaceProvider value={surface}>
      <MarkdownRevealContext.Provider value={revealState}>
        <div
          className={markdownClassName}
          data-markdown-body="true"
          data-markdown-surface={surface}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            urlTransform={markdownUrlTransform}
            components={components}
          >
            {parsedContent}
          </ReactMarkdown>
        </div>
      </MarkdownRevealContext.Provider>
    </MarkdownSurfaceProvider>
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
  const isCodeBlock = useContext(MarkdownCodeBlockContext);
  if (dangerouslySetInnerHTML) {
    return (
      <code
        {...rest}
        className={MARKDOWN_INLINE_CODE_CLASS}
        data-markdown-inline-code="true"
        dangerouslySetInnerHTML={dangerouslySetInnerHTML}
      />
    );
  }
  const match = /language-([^\s]+)/.exec(codeClassName || "");
  const codeString = String(children ?? "").replace(/\n$/, "");
  if (isCodeBlock || match) {
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
  // Inline code owns its own presentation module, including the hex-colour
  // swatch that precedes a `#rgb`/`#rrggbb`/`#rrggbbaa` literal.
  return (
    <MarkdownInlineCode {...rest} code={codeString}>
      {children}
    </MarkdownInlineCode>
  );
}

function markdownUrlTransform(value: string): string {
  if (/^(?:javascript|data|vbscript):/i.test(value.trimStart())) {
    return "";
  }
  return value;
}
