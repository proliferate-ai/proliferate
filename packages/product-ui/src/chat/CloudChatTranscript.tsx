import {
  AlertTriangle,
  Bot,
  Brain,
  CheckCircle2,
  Clock3,
  Copy,
  Loader2,
  Terminal,
  User,
  Wrench,
} from "lucide-react";
import {
  createElement,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@proliferate/ui/primitives/Button";

const STREAM_FLUSH_MS = 32;
const MIN_STREAM_STEP = 20;
const MAX_STREAM_STEP = 120;

export type CloudChatTranscriptRowKind =
  | "assistant"
  | "error"
  | "system"
  | "thought"
  | "tool"
  | "tool_group"
  | "user";

export interface CloudChatTranscriptRowView {
  id: string;
  kind: CloudChatTranscriptRowKind;
  title?: string | null;
  body?: string | null;
  detail?: string | null;
  status?: string | null;
  streaming?: boolean;
}

export interface CloudChatTranscriptProps {
  rows: readonly CloudChatTranscriptRowView[];
  emptyTitle: string;
  emptyDescription?: string;
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

export function CloudChatTranscript({
  rows,
  emptyTitle,
  emptyDescription,
}: CloudChatTranscriptProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-5 text-sm">
        <div className="font-medium text-foreground">{emptyTitle}</div>
        {emptyDescription ? (
          <p className="mt-1 text-muted-foreground">{emptyDescription}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <CloudChatTranscriptRow key={row.id} row={row} />
      ))}
    </div>
  );
}

function CloudChatTranscriptRow({ row }: { row: CloudChatTranscriptRowView }) {
  if (row.kind === "user") {
    return (
      <CloudChatUserMessage
        content={row.body ?? ""}
        status={row.status}
        streaming={row.streaming}
      />
    );
  }

  if (row.kind === "assistant") {
    return (
      <article className="flex justify-start">
        <div className="flex min-w-0 max-w-full flex-col break-words" data-telemetry-mask>
          {row.title ? (
            <div className="mb-1 text-xs font-medium text-muted-foreground">{row.title}</div>
          ) : null}
          <CloudChatAssistantMessage
            content={row.body ?? ""}
            isStreaming={row.streaming}
          />
          {row.streaming ? (
            <div className="mt-1 inline-flex min-h-6 items-center gap-1 text-xs text-muted-foreground">
              <Loader2 size={12} className="animate-spin" />
              Streaming
            </div>
          ) : null}
        </div>
      </article>
    );
  }

  const Icon = iconForRow(row);
  return (
    <article className="flex justify-start">
      <div className="flex min-w-0 max-w-full items-start gap-2 rounded-lg border border-border bg-card/70 px-3 py-2 text-sm">
        <Icon size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium text-foreground">
              {row.title ?? titleForRow(row)}
            </span>
            {row.status ? (
              <span className="shrink-0 text-xs text-muted-foreground">{row.status}</span>
            ) : null}
          </div>
          {row.detail ? (
            <div className="mt-0.5 truncate text-xs text-muted-foreground" data-telemetry-mask>
              {row.detail}
            </div>
          ) : null}
          {row.body ? (
            <div className="mt-2 max-h-72 overflow-auto" data-telemetry-mask>
              {row.kind === "thought" ? (
                <pre className="whitespace-pre-wrap rounded-md bg-background px-2 py-1.5 text-xs leading-5 text-muted-foreground">
                  {row.body}
                </pre>
              ) : (
                <CloudChatMarkdownRenderer
                  content={row.body}
                  className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 text-muted-foreground"
                />
              )}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function CloudChatUserMessage({
  content,
  status = null,
  streaming = false,
}: {
  content: string;
  status?: string | null;
  streaming?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [needsToggle, setNeedsToggle] = useState(false);
  const [copied, setCopied] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  const hasContent = content.trim().length > 0;

  useLayoutEffect(() => {
    if (!hasContent) {
      setNeedsToggle(false);
      return;
    }
    const el = textRef.current;
    if (!el) return;
    setNeedsToggle(el.scrollHeight > el.clientHeight);
  }, [content, hasContent]);

  function copyMessage() {
    if (!content) {
      return;
    }
    void navigator.clipboard.writeText(content)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      });
  }

  return (
    <article className="group/msg flex justify-end" data-chat-user-message>
      <div className="flex w-full flex-col items-end justify-end gap-1">
        {hasContent ? (
          <div
            className="max-w-[77%] break-words rounded-2xl bg-foreground/5 px-3 py-2 text-foreground"
            data-telemetry-mask
          >
            <div
              ref={textRef}
              className={`break-words select-text text-chat leading-[var(--text-chat--line-height)]${
                !expanded ? " line-clamp-5" : ""
              }`}
            >
              {content}
            </div>
            {needsToggle ? (
              <div className="mt-1 flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-chat-transcript-ignore
                  onClick={() => setExpanded((value) => !value)}
                  className="h-auto px-1 py-0 text-[11px] text-muted-foreground hover:bg-transparent hover:text-foreground"
                >
                  {expanded ? "Show less" : "Show more"}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
        {(status || streaming) ? (
          <div className="inline-flex items-center gap-1 pr-1 text-xs text-muted-foreground">
            {streaming ? <Loader2 size={12} className="animate-spin" /> : null}
            {status ?? "Sending"}
          </div>
        ) : null}
        {hasContent ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-chat-transcript-ignore
            aria-label="Copy message"
            onClick={copyMessage}
            className="h-6 gap-1 px-1.5 py-0 text-[11px] text-muted-foreground opacity-0 hover:bg-transparent hover:text-foreground group-hover/msg:opacity-100"
          >
            <Copy size={12} />
            {copied ? "Copied" : "Copy"}
          </Button>
        ) : null}
      </div>
    </article>
  );
}

export interface CloudChatAssistantMessageProps {
  content: string;
  isStreaming?: boolean;
}

export function CloudChatAssistantMessage({
  content,
  isStreaming = false,
}: CloudChatAssistantMessageProps) {
  return (
    <div className="select-text text-chat leading-[var(--text-chat--line-height)] text-foreground">
      <CloudChatAssistantMessageContent content={content} isStreaming={isStreaming} />
    </div>
  );
}

function CloudChatAssistantMessageContent({
  content,
  isStreaming = false,
}: {
  content: string;
  isStreaming?: boolean;
}) {
  const [visibleContent, setVisibleContent] = useState(content);
  const visibleContentRef = useRef(content);
  const targetContentRef = useRef(content);
  const flushFrameRef = useRef<number | null>(null);
  const lastFlushAtRef = useRef(0);
  const liveRef = useRef<HTMLDivElement>(null);
  const prevSplitRef = useRef({ stable: "", live: "" });

  const scheduleFlush = () => {
    if (flushFrameRef.current !== null) {
      return;
    }
    flushFrameRef.current = window.requestAnimationFrame((timestamp) => {
      flushFrameRef.current = null;
      if (timestamp - lastFlushAtRef.current < STREAM_FLUSH_MS) {
        scheduleFlush();
        return;
      }

      lastFlushAtRef.current = timestamp;
      const nextVisible = selectVisibleTarget(
        targetContentRef.current,
        visibleContentRef.current.length,
      );
      if (nextVisible.length !== visibleContentRef.current.length) {
        visibleContentRef.current = nextVisible;
        setVisibleContent(nextVisible);
      }
      if (visibleContentRef.current.length < targetContentRef.current.length) {
        scheduleFlush();
      }
    });
  };

  useEffect(() => {
    targetContentRef.current = content;

    if (content.length < visibleContentRef.current.length) {
      if (flushFrameRef.current !== null) {
        window.cancelAnimationFrame(flushFrameRef.current);
        flushFrameRef.current = null;
      }
      lastFlushAtRef.current = 0;
      visibleContentRef.current = content;
      setVisibleContent(content);
      return;
    }

    if (content.length === visibleContentRef.current.length) {
      return;
    }

    scheduleFlush();
    return () => {
      if (flushFrameRef.current !== null) {
        window.cancelAnimationFrame(flushFrameRef.current);
        flushFrameRef.current = null;
      }
    };
  }, [content, isStreaming]);

  const splitContent = useMemo(
    () => splitAssistantContent(visibleContent),
    [visibleContent],
  );
  const isRevealing = visibleContent.length < content.length;
  const stableClassName = splitContent.liveContent
    ? "[&>*:first-child]:mt-0"
    : "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0";
  const liveClassName = splitContent.stableContent
    ? "[&>*:last-child]:mb-0"
    : "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0";

  useLayoutEffect(() => {
    const el = liveRef.current;
    const prev = prevSplitRef.current;
    const nextStable = splitContent.stableContent;
    const nextLive = splitContent.liveContent;
    const active = splitContent.animateLiveContent && (isStreaming || isRevealing);
    const isFirstLive = prev.live.length === 0 && nextLive.length > 0;
    const isBoundaryCrossed = nextStable.length > prev.stable.length;

    prevSplitRef.current = { stable: nextStable, live: nextLive };

    if (!el) return;
    if (!active) {
      el.classList.remove("animate-streaming-fade");
      return;
    }
    if (isFirstLive || isBoundaryCrossed) {
      el.classList.remove("animate-streaming-fade");
      void el.offsetHeight;
      el.classList.add("animate-streaming-fade");
    }
  }, [
    splitContent.stableContent,
    splitContent.liveContent,
    splitContent.animateLiveContent,
    isStreaming,
    isRevealing,
  ]);

  return (
    <>
      {splitContent.stableContent ? (
        <CloudChatMarkdownRenderer
          content={splitContent.stableContent}
          className={stableClassName}
        />
      ) : null}
      {splitContent.liveContent ? (
        <div ref={liveRef}>
          <CloudChatMarkdownRenderer
            content={splitContent.liveContent}
            className={liveClassName}
          />
        </div>
      ) : null}
    </>
  );
}

export function CloudChatMarkdownRenderer({
  content,
  className = "",
}: {
  content: string;
  className?: string;
}) {
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
            if (match || codeString.includes("\n")) {
              return (
                <CloudCodeBlock
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

function CloudCodeBlock({
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
    void navigator.clipboard.writeText(code)
      .then(() => {
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
          className="h-6 rounded-md bg-transparent px-1.5 py-0 text-sm text-muted-foreground opacity-0 transition-colors hover:bg-muted hover:text-foreground group-hover/code:opacity-100"
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

function splitAssistantContent(content: string): {
  stableContent: string;
  liveContent: string;
  animateLiveContent: boolean;
} {
  if (!content) {
    return { stableContent: "", liveContent: "", animateLiveContent: false };
  }

  const structuredTail = hasOpenCodeFence(content) || hasTrailingTable(content);
  if (!needsStableStreamingSplit(content)) {
    return {
      stableContent: "",
      liveContent: content,
      animateLiveContent: true,
    };
  }

  const boundary = content.lastIndexOf("\n\n");
  if (boundary < 0 || boundary + 2 >= content.length) {
    return {
      stableContent: "",
      liveContent: content,
      animateLiveContent: !structuredTail,
    };
  }

  return {
    stableContent: content.slice(0, boundary + 2),
    liveContent: content.slice(boundary + 2),
    animateLiveContent: !structuredTail,
  };
}

function selectVisibleTarget(content: string, currentLength: number): string {
  if (content.length <= currentLength) {
    return content;
  }

  const nextLength = Math.min(
    content.length,
    currentLength + resolveRevealStep(content.length - currentLength),
  );

  if (!hasOpenCodeFence(content) && !hasTrailingTable(content)) {
    return content.slice(0, findTextBoundary(content, currentLength, nextLength));
  }

  const nextNewlineIndex = content.indexOf("\n", nextLength);
  if (nextNewlineIndex !== -1 && nextNewlineIndex < currentLength + MAX_STREAM_STEP * 2) {
    return content.slice(0, nextNewlineIndex + 1);
  }

  const priorNewlineIndex = content.lastIndexOf("\n", nextLength);
  if (priorNewlineIndex > currentLength) {
    return content.slice(0, priorNewlineIndex + 1);
  }

  return content.slice(0, nextLength);
}

function resolveRevealStep(remainingLength: number): number {
  return Math.max(
    MIN_STREAM_STEP,
    Math.min(MAX_STREAM_STEP, Math.ceil(remainingLength / 4)),
  );
}

function findTextBoundary(
  content: string,
  currentLength: number,
  targetLength: number,
): number {
  if (targetLength >= content.length) {
    return content.length;
  }

  const paragraphBoundary = content.lastIndexOf("\n\n", targetLength);
  if (paragraphBoundary >= currentLength + MIN_STREAM_STEP) {
    return paragraphBoundary + 2;
  }

  const lineBoundary = content.lastIndexOf("\n", targetLength);
  if (lineBoundary >= currentLength + Math.floor(MIN_STREAM_STEP / 2)) {
    return lineBoundary + 1;
  }

  const whitespaceBoundary = content.lastIndexOf(" ", targetLength);
  if (whitespaceBoundary >= currentLength + Math.floor(MIN_STREAM_STEP / 2)) {
    return whitespaceBoundary + 1;
  }

  return targetLength;
}

function needsStableStreamingSplit(content: string): boolean {
  return content.includes("```") || hasTrailingTable(content);
}

function hasOpenCodeFence(content: string): boolean {
  return (content.match(/```/g)?.length ?? 0) % 2 === 1;
}

function hasTrailingTable(content: string): boolean {
  const lines = content.trimEnd().split("\n");
  if (lines.length < 2) return false;
  const tail = lines.slice(-3);
  const tableLikeLines = tail.filter((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith("|") && trimmed.endsWith("|");
  });
  return tableLikeLines.length >= 2;
}

function iconForRow(row: CloudChatTranscriptRowView) {
  switch (row.kind) {
    case "error":
      return AlertTriangle;
    case "system":
      return Bot;
    case "thought":
      return Brain;
    case "tool":
      return row.status === "completed" ? CheckCircle2 : Terminal;
    case "tool_group":
      return Wrench;
    case "user":
      return User;
    case "assistant":
    default:
      return row.streaming ? Clock3 : Bot;
  }
}

function titleForRow(row: CloudChatTranscriptRowView): string {
  switch (row.kind) {
    case "error":
      return "Error";
    case "system":
      return "System";
    case "thought":
      return "Reasoning";
    case "tool_group":
      return "Actions";
    case "tool":
      return "Tool call";
    case "user":
      return "User";
    case "assistant":
    default:
      return "Assistant";
  }
}
