import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MarkdownRenderer } from "@/components/ui/content/MarkdownRenderer";
import { CopyMessageButton } from "./CopyMessageButton";

const STREAM_FLUSH_MS = 32;
const MIN_STREAM_STEP = 20;
const MAX_STREAM_STEP = 120;

export interface AssistantMessageProps {
  content: string;
  isStreaming?: boolean;
  showCopyButton?: boolean;
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

function splitAssistantContent(content: string): {
  stableContent: string;
  liveContent: string;
  animateLiveContent: boolean;
} {
  if (!content) {
    return { stableContent: "", liveContent: "", animateLiveContent: false };
  }

  const structuredTail = hasOpenCodeFence(content) || hasTrailingTable(content);
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

function AssistantMessageContent({
  content,
  isStreaming = false,
}: {
  content: string;
  isStreaming?: boolean;
}) {
  const [visibleContent, setVisibleContent] = useState(content);
  const visibleContentRef = useRef(content);
  const targetContentRef = useRef(content);
  const isStreamingRef = useRef(isStreaming);
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
    isStreamingRef.current = isStreaming;

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

  // Restart `animate-streaming-fade` on the live-tail div only when a new
  // paragraph is starting — either the very first paragraph of the turn
  // (prev.live was empty) or a `\n\n` boundary was just crossed (stable
  // grew). Within a paragraph, the div stays mounted and the MarkdownRenderer
  // inside it (including any HighlightedCodePanel children) is never
  // remounted, so Shiki state is preserved and no code-flash can occur.
  useLayoutEffect(() => {
    const el = liveRef.current;
    const prev = prevSplitRef.current;
    const nextStable = splitContent.stableContent;
    const nextLive = splitContent.liveContent;

    const active =
      splitContent.animateLiveContent && (isStreaming || isRevealing);
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
      {splitContent.stableContent && (
        <MarkdownRenderer
          content={splitContent.stableContent}
          className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
        />
      )}
      {splitContent.liveContent && (
        <div ref={liveRef}>
          <MarkdownRenderer
            content={splitContent.liveContent}
            className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
          />
        </div>
      )}
    </>
  );
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

export function AssistantMessage({
  content,
  isStreaming = false,
  showCopyButton = false,
}: AssistantMessageProps) {
  return (
    <div
      data-chat-selection-unit
      className={showCopyButton ? "group/msg" : undefined}
    >
      <div
        className="text-chat leading-relaxed select-text text-foreground"
      >
        <AssistantMessageContent content={content} isStreaming={isStreaming} />
      </div>
      {content && (
        // NOTE: `h-6` is load-bearing and the slot is rendered for *every*
        // assistant prose with content, not just the one that will host the
        // copy button. Three invariants depend on this:
        //   1. It reserves the copy-button slot during streaming so that
        //      mounting the button on turn completion doesn't shift layout.
        //   2. It keeps the slot anchored to the prose that renders it, so
        //      when a later prose becomes "last" mid-turn the slot on the
        //      earlier prose doesn't unmount and cause a layout jump.
        //   3. It is part of the TRAILING_STATUS_MIN_HEIGHT derivation in
        //      MessageList.tsx (text-chat line-height + this slot = 42px),
        //      which keeps the StreamingIndicator→first-prose-line swap a
        //      zero-delta transition. If you change this value, update
        //      TRAILING_STATUS_MIN_HEIGHT in MessageList.tsx to match.
        // The actual CopyMessageButton is only mounted on the last prose of
        // a completed turn (see `showCopyButton` flow from MessageList).
        <div className="pl-1 pt-0.5 h-6">
          {showCopyButton && !isStreaming && <CopyMessageButton content={content} />}
        </div>
      )}
    </div>
  );
}
