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
    // Opt this message body into the composer-matched prose size. Both the
    // stable and live MarkdownBody below inherit --prose-text-size from here,
    // so the reserved height is identical between streaming and settled states.
    <div className="[--prose-text-size:var(--text-message)] [--prose-text-line-height:var(--text-message--line-height)] text-[length:var(--prose-text-size)] leading-[var(--prose-text-line-height)] select-text text-foreground">
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

// ANCHOR INVARIANT (owner rule): the newest content must occupy its final
// layout position the INSTANT it exists. The word-level fade (revealText) is
// opacity-only — layout commits instantly — and React's positional
// reconciliation keeps previously-mounted word spans stable, so only
// newly-appended words mount fresh and animate; nothing replays. The
// stable/live split is kept for markdown-parse efficiency (the stable prefix
// parses once; only the small live tail re-parses per stream batch).
function AssistantMessageContent({
  content,
  isStreaming,
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
            revealText={isStreaming}
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

