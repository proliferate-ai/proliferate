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
} from "./ChatContentSearchContext";
import { stabilizeStreamingMarkdown } from "#product/lib/domain/chat/transcript/streaming-markdown";
import { repairTranscriptFileLinks } from "#product/lib/domain/chat/transcript/file-link-markdown";
import {
  type HastNode,
  MarkdownRevealContext,
} from "./MarkdownRevealText";
import {
  MarkdownCodeBlockContext,
  STATIC_MARKDOWN_COMPONENTS,
  type MdElementProps,
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

/**
 * Streaming render-copy available to fenced-code renderers. Completeness
 * decisions (e.g. mermaid) belong in those renderers, not a second Markdown
 * parser here.
 */
export interface MarkdownStreamingSource {
  isStreaming: boolean;
  source: string;
}

const MarkdownStreamingSourceContext = createContext<MarkdownStreamingSource>({
  isStreaming: false,
  source: "",
});

export function useMarkdownStreamingSource(): MarkdownStreamingSource {
  return useContext(MarkdownStreamingSourceContext);
}

/**
 * Start of the current fenced code node in the render-copy source. Completeness
 * helpers (mermaid) use this to tell a closed fence from a later unclosed
 * fence that happens to have the same body.
 */
export interface MarkdownFencedCodeStart {
  startOffset: number | null;
  startLine: number | null;
}

const MarkdownFencedCodeStartContext = createContext<MarkdownFencedCodeStart>({
  startOffset: null,
  startLine: null,
});

export function useMarkdownFencedCodeStart(): MarkdownFencedCodeStart {
  return useContext(MarkdownFencedCodeStartContext);
}

type MdCodeProps = MdElementProps & {
  children?: ReactNode;
  className?: string;
  renderInlineCode?: MarkdownInlineCodeRenderer;
  renderCodeBlock?: MarkdownCodeBlockRenderer;
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
    // A file viewer displays the file's own bytes: neither transformation may
    // run there, settled or streaming. This bypass is explicit rather than an
    // accident of which surface happens to pass isStreaming.
    if (surface !== "message") return content;
    // Render copy only. `content` is the authoritative transcript text and is
    // never mutated; both passes are pure and return a new string.
    const stabilized = isStreaming ? stabilizeStreamingMarkdown(content) : content;
    return repairTranscriptFileLinks(stabilized);
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

  const streamingSource = useMemo(
    (): MarkdownStreamingSource => ({
      isStreaming,
      source: parsedContent,
    }),
    [isStreaming, parsedContent],
  );

  const body = (
    <MarkdownStreamingSourceContext.Provider value={streamingSource}>
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
    </MarkdownStreamingSourceContext.Provider>
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
  node,
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
    const block = renderedCodeBlock !== null && renderedCodeBlock !== undefined
      ? renderedCodeBlock
      : <MarkdownCodeBlockShell code={codeString} label={language} />;
    return (
      <MarkdownFencedCodeStartContext.Provider value={readFencedCodeStart(node)}>
        {block}
      </MarkdownFencedCodeStartContext.Provider>
    );
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

function readFencedCodeStart(node: unknown): MarkdownFencedCodeStart {
  const start = (node as HastNode | undefined)?.position?.start;
  return {
    startOffset: typeof start?.offset === "number" ? start.offset : null,
    startLine: typeof start?.line === "number" ? start.line : null,
  };
}
