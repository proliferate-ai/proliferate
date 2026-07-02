import { useMemo } from "react";
import {
  MarkdownBody,
  type MarkdownCodeBlockRenderer,
  type MarkdownInlineCodeRenderer,
  type MarkdownLinkRenderer,
} from "./MarkdownBody";

export type {
  MarkdownCodeBlockRenderInput,
  MarkdownCodeBlockRenderer,
  MarkdownInlineCodeRenderInput,
  MarkdownInlineCodeRenderer,
  MarkdownLinkRenderInput,
  MarkdownLinkRenderer,
} from "./MarkdownBody";

export interface AssistantMessageProps {
  content: string;
  isStreaming?: boolean;
  renderLink?: MarkdownLinkRenderer;
  renderInlineCode?: MarkdownInlineCodeRenderer;
  renderCodeBlock?: MarkdownCodeBlockRenderer;
}

export function AssistantMessage({
  content,
  isStreaming = false,
  renderLink,
  renderInlineCode,
  renderCodeBlock,
}: AssistantMessageProps) {
  return (
    <div className="text-chat leading-[var(--text-chat--line-height)] select-text text-foreground">
      <AssistantMessageContent
        content={content}
        isStreaming={isStreaming}
        renderLink={renderLink}
        renderInlineCode={renderInlineCode}
        renderCodeBlock={renderCodeBlock}
      />
    </div>
  );
}

// ANCHOR INVARIANT (owner rule): the newest content must occupy the bottom
// line the instant it exists — no typewriter reveal, no staggered fade. The
// previous reveal pacing meant a burst of text (or a reconnect backlog) played
// back over seconds, so the transcript's visible bottom kept crawling while
// the true content already existed. Content now renders immediately; the
// stable/live split is kept purely for markdown-parse efficiency (the stable
// prefix parses once; only the small live tail re-parses per stream batch).
function AssistantMessageContent({
  content,
  renderLink,
  renderInlineCode,
  renderCodeBlock,
}: {
  content: string;
  isStreaming?: boolean;
  renderLink?: MarkdownLinkRenderer;
  renderInlineCode?: MarkdownInlineCodeRenderer;
  renderCodeBlock?: MarkdownCodeBlockRenderer;
}) {
  const splitContent = useMemo(
    () => splitAssistantContent(content),
    [content],
  );
  const stableClassName = splitContent.liveContent
    ? "[&>*:first-child]:mt-0"
    : "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0";
  const liveClassName = splitContent.stableContent
    ? "[&>*:last-child]:mb-0"
    : "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0";

  return (
    <>
      {splitContent.stableContent && (
        <MarkdownBody
          content={splitContent.stableContent}
          className={stableClassName}
          renderLink={renderLink}
          renderInlineCode={renderInlineCode}
          renderCodeBlock={renderCodeBlock}
        />
      )}
      {splitContent.liveContent && (
        <div>
          <MarkdownBody
            content={splitContent.liveContent}
            className={liveClassName}
            renderLink={renderLink}
            renderInlineCode={renderInlineCode}
            renderCodeBlock={renderCodeBlock}
          />
        </div>
      )}
    </>
  );
}

function splitAssistantContent(content: string): {
  stableContent: string;
  liveContent: string;
} {
  if (!content) {
    return { stableContent: "", liveContent: "" };
  }

  // Always split at the last safe paragraph boundary — including for plain
  // prose. The live MarkdownBody re-parses on every reveal flush; without a
  // split, a long prose message re-parses in its entirety at the flush rate,
  // which starves the main thread and lags composer typing.
  const boundary = findStableBoundary(content);
  if (boundary < 0 || boundary + 2 >= content.length) {
    return {
      stableContent: "",
      liveContent: content,
    };
  }

  return {
    stableContent: content.slice(0, boundary + 2),
    liveContent: content.slice(boundary + 2),
  };
}

// A split boundary inside an open code fence breaks the markdown in both
// halves (the fence body leaks out as prose). Walk back to the nearest
// paragraph boundary whose prefix has balanced fences.
function findStableBoundary(content: string): number {
  let boundary = content.lastIndexOf("\n\n");
  while (boundary >= 0) {
    if (!hasOpenCodeFence(content.slice(0, boundary + 2))) {
      return boundary;
    }
    boundary = content.lastIndexOf("\n\n", boundary - 1);
  }
  return -1;
}

function hasOpenCodeFence(content: string): boolean {
  return (content.match(/```/g)?.length ?? 0) % 2 === 1;
}

