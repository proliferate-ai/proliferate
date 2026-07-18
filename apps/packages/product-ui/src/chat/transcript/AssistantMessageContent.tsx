import { useEffect, useMemo, useRef, useState } from "react";
import {
  MarkdownBody,
  type MarkdownCodeBlockRenderer,
  type MarkdownInlineCodeRenderer,
  type MarkdownLinkRenderer,
} from "./MarkdownBody";
import { flushDevAssistantPerformanceBridge } from "./dev-assistant-performance";
import {
  findCommonPrefixLength,
  initialVisibleContent,
  MAX_STREAM_REVEAL_CHARACTERS_PER_SECOND,
  selectVisibleTarget,
  splitAssistantContent,
  STREAM_FLUSH_MS,
  STREAM_REVEAL_COMMIT_INTERVAL_MS,
  STREAM_REVEAL_FADE_MS,
  STREAM_REVEAL_IDLE_MS,
  STREAM_REVEAL_SETTLE_MS,
  type AssistantMessageRevealPhase,
  type AssistantMessageRevealState,
} from "./assistant-message-reveal";

// Assistant prose has one source-ordered reveal frontier. The visible content
// is always a prefix, while recent words keep independent opacity animations.
export function AssistantMessageContent({
  debugPerformanceEnabled,
  content,
  isStreaming,
  animateReveal,
  initialVisibleLength,
  onRevealStateChange,
  renderLink,
  renderInlineCode,
  renderCodeBlock,
}: {
  debugPerformanceEnabled: boolean;
  content: string;
  isStreaming?: boolean;
  animateReveal: boolean;
  initialVisibleLength?: number;
  onRevealStateChange?: (state: AssistantMessageRevealState) => void;
  renderLink?: MarkdownLinkRenderer;
  renderInlineCode?: MarkdownInlineCodeRenderer;
  renderCodeBlock?: MarkdownCodeBlockRenderer;
}) {
  const [visibleContent, setVisibleContent] = useState(() =>
    initialVisibleContent(content, animateReveal, initialVisibleLength),
  );
  const visibleContentRef = useRef(visibleContent);
  const settledVisibleLengthRef = useRef(
    animateReveal ? visibleContent.length : content.length,
  );
  const targetContentRef = useRef(content);
  const isStreamingRef = useRef(Boolean(isStreaming));
  const flushFrameRef = useRef<number | null>(null);
  const lastFlushAtRef = useRef(0);
  const lastVisibleCommitAtRef = useRef(0);
  const revealCharacterBudgetRef = useRef(0);
  const [revealPhase, setRevealPhase] = useState<AssistantMessageRevealPhase>(() =>
    visibleContent.length < content.length ? "active" : "idle",
  );
  const revealPhaseRef = useRef(revealPhase);
  const settleDelayRef = useRef<number | null>(null);
  const settleFinishRef = useRef<number | null>(null);

  const commitRevealPhase = (phase: AssistantMessageRevealPhase) => {
    revealPhaseRef.current = phase;
    setRevealPhase(phase);
  };
  const cancelFlush = () => {
    if (flushFrameRef.current === null) return;
    window.cancelAnimationFrame(flushFrameRef.current);
    flushFrameRef.current = null;
  };
  const commitVisibleContent = (nextContent: string) => {
    visibleContentRef.current = nextContent;
    setVisibleContent(nextContent);
  };
  const cancelSettle = () => {
    if (settleDelayRef.current !== null) {
      window.clearTimeout(settleDelayRef.current);
      settleDelayRef.current = null;
    }
    if (settleFinishRef.current !== null) {
      window.clearTimeout(settleFinishRef.current);
      settleFinishRef.current = null;
    }
  };
  const beginSettle = () => {
    cancelSettle();
    if (revealPhaseRef.current === "idle") return;
    commitRevealPhase("settling");
    settleFinishRef.current = window.setTimeout(() => {
      settleFinishRef.current = null;
      settledVisibleLengthRef.current = Math.max(
        settledVisibleLengthRef.current,
        visibleContentRef.current.length,
      );
      commitRevealPhase("idle");
    }, STREAM_REVEAL_SETTLE_MS);
  };
  const scheduleSettle = () => {
    if (settleDelayRef.current !== null || revealPhaseRef.current === "idle") return;
    settleDelayRef.current = window.setTimeout(() => {
      settleDelayRef.current = null;
      beginSettle();
    }, STREAM_REVEAL_IDLE_MS);
  };
  const scheduleFlush = () => {
    if (flushFrameRef.current !== null) return;
    flushFrameRef.current = window.requestAnimationFrame((timestamp) => {
      flushFrameRef.current = null;
      const elapsedMs = lastFlushAtRef.current === 0
        ? STREAM_FLUSH_MS
        : Math.min(32, Math.max(0, timestamp - lastFlushAtRef.current));
      lastFlushAtRef.current = timestamp;
      revealCharacterBudgetRef.current +=
        (elapsedMs * MAX_STREAM_REVEAL_CHARACTERS_PER_SECOND) / 1_000;
      const revealCharacters = Math.floor(revealCharacterBudgetRef.current);
      const commitElapsedMs = timestamp - lastVisibleCommitAtRef.current;
      if (
        revealCharacters < 1
        || (
          lastVisibleCommitAtRef.current !== 0
          && commitElapsedMs < STREAM_REVEAL_COMMIT_INTERVAL_MS
        )
      ) {
        scheduleFlush();
        return;
      }

      revealCharacterBudgetRef.current -= revealCharacters;
      const nextVisible = selectVisibleTarget(
        targetContentRef.current,
        visibleContentRef.current.length,
        revealCharacters,
      );
      if (nextVisible.length !== visibleContentRef.current.length) {
        lastVisibleCommitAtRef.current = timestamp;
        commitVisibleContent(nextVisible);
      }
      if (visibleContentRef.current.length < targetContentRef.current.length) {
        scheduleFlush();
      } else if (!isStreamingRef.current) {
        beginSettle();
      } else {
        scheduleSettle();
      }
    });
  };

  useEffect(() => {
    targetContentRef.current = content;
    isStreamingRef.current = Boolean(isStreaming);

    let visible = visibleContentRef.current;
    const reducedMotion = typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!animateReveal || reducedMotion) {
      cancelFlush();
      cancelSettle();
      lastFlushAtRef.current = 0;
      lastVisibleCommitAtRef.current = 0;
      revealCharacterBudgetRef.current = 0;
      settledVisibleLengthRef.current = content.length;
      if (visible !== content) commitVisibleContent(content);
      commitRevealPhase("idle");
      return;
    }

    if (!content.startsWith(visible)) {
      cancelFlush();
      cancelSettle();
      lastFlushAtRef.current = 0;
      lastVisibleCommitAtRef.current = 0;
      revealCharacterBudgetRef.current = 0;
      const commonPrefixLength = findCommonPrefixLength(visible, content);
      settledVisibleLengthRef.current = Math.min(
        settledVisibleLengthRef.current,
        commonPrefixLength,
      );
      visible = content.slice(0, commonPrefixLength);
      commitVisibleContent(visible);
    }

    if (!isStreaming) {
      if (visible !== content) {
        cancelSettle();
        commitRevealPhase("active");
        scheduleFlush();
        return cancelFlush;
      }
      if (revealPhaseRef.current !== "idle") beginSettle();
      return;
    }
    if (content.length === visible.length) {
      scheduleSettle();
      return;
    }

    cancelSettle();
    if (revealPhaseRef.current === "idle") {
      lastFlushAtRef.current = 0;
      lastVisibleCommitAtRef.current = 0;
      revealCharacterBudgetRef.current = 0;
    }
    commitRevealPhase("active");
    scheduleFlush();
    return cancelFlush;
  }, [animateReveal, content, isStreaming]);

  useEffect(() => () => {
    cancelFlush();
    cancelSettle();
  }, []);

  const splitContent = useMemo(
    () => splitAssistantContent(visibleContent),
    [visibleContent],
  );
  const isRevealing = visibleContent.length < content.length;
  const showRevealTail = splitContent.animateLiveContent
    && splitContent.liveContent.length > 0
    && revealPhase !== "idle";
  const revealWindowCharacters = Math.ceil(
    (MAX_STREAM_REVEAL_CHARACTERS_PER_SECOND * STREAM_REVEAL_FADE_MS) / 1_000,
  );
  const revealedLiveSourceUpTo = Math.max(
    Math.max(0, splitContent.liveContent.length - revealWindowCharacters),
    Math.max(
      0,
      Math.min(
        splitContent.liveContent.length,
        settledVisibleLengthRef.current - splitContent.stableContent.length,
      ),
    ),
  );
  const revealComplete =
    revealPhase === "idle" && visibleContent.length >= content.length;

  useEffect(() => {
    onRevealStateChange?.({
      complete: revealComplete,
      phase: revealPhase,
      visibleLength: visibleContent.length,
      targetLength: content.length,
      isStreaming: Boolean(isStreaming),
    });
    if (debugPerformanceEnabled && revealComplete) {
      flushDevAssistantPerformanceBridge();
    }
  }, [
    content.length,
    debugPerformanceEnabled,
    isStreaming,
    onRevealStateChange,
    revealComplete,
    revealPhase,
    visibleContent.length,
  ]);

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
          enableContentSearch
        />
      )}
      {splitContent.liveContent && (
        <div data-streaming-reveal={showRevealTail ? revealPhase : undefined}>
          <MarkdownBody
            content={splitContent.liveContent}
            className={liveClassName}
            renderLink={renderLink}
            renderInlineCode={renderInlineCode}
            renderCodeBlock={renderCodeBlock}
            isStreaming={isStreaming || isRevealing}
            revealText={showRevealTail}
            revealedUpTo={revealedLiveSourceUpTo}
            enableContentSearch
          />
        </div>
      )}
    </>
  );
}
