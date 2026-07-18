import {
  Profiler,
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ProfilerOnRenderCallback,
} from "react";
import {
  MarkdownBody,
  type MarkdownCodeBlockRenderer,
  type MarkdownInlineCodeRenderer,
  type MarkdownLinkRenderer,
} from "./MarkdownBody";
import {
  flushDevAssistantPerformanceBridge,
  isDevAssistantPerformanceEnabled,
  recordDevAssistantPerformance,
} from "./dev-assistant-performance";

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
  /** Force a newly completed response through the reveal instead of treating it as history. */
  animateReveal?: boolean;
  /** Resume a remounted live message from its last painted source prefix. */
  initialVisibleLength?: number;
  onRevealStateChange?: (state: AssistantMessageRevealState) => void;
  renderLink?: MarkdownLinkRenderer;
  renderInlineCode?: MarkdownInlineCodeRenderer;
  renderCodeBlock?: MarkdownCodeBlockRenderer;
}

export interface AssistantMessageRevealState {
  complete: boolean;
  phase: AssistantMessageRevealPhase;
  visibleLength: number;
  targetLength: number;
  isStreaming: boolean;
}

const STREAM_FLUSH_MS = 16;
export const STREAM_REVEAL_COMMIT_INTERVAL_MS = 32;
const STREAM_REVEAL_IDLE_MS = 240;
export const STREAM_REVEAL_FADE_MS = 320;
export const STREAM_REVEAL_HANDOFF_DELAY_MS = 160;
export const STREAM_REVEAL_SETTLE_MS =
  STREAM_REVEAL_FADE_MS + STREAM_REVEAL_HANDOFF_DELAY_MS;
export const MAX_STREAM_REVEAL_CHARACTERS_PER_SECOND = 360;

export type AssistantMessageRevealPhase = "idle" | "active" | "settling";

export const AssistantMessage = memo(function AssistantMessage({
  content,
  isStreaming = false,
  animateReveal,
  initialVisibleLength,
  onRevealStateChange,
  renderLink,
  renderInlineCode,
  renderCodeBlock,
}: AssistantMessageProps) {
  const debugProfilerId = useId();
  const debugPerformanceEnabled = isDevAssistantPerformanceEnabled();
  const wasStreamingRef = useRef(isStreaming);
  if (isStreaming) {
    wasStreamingRef.current = true;
  }
  const shouldAnimateReveal = animateReveal ?? wasStreamingRef.current;
  const reportDebugRender = useCallback<ProfilerOnRenderCallback>((
    id,
    phase,
    actualDuration,
    baseDuration,
    startTime,
    commitTime,
  ) => {
    recordDevAssistantPerformance({
      kind: "react-commit",
      id,
      phase,
      durationMs: actualDuration,
      baseDurationMs: baseDuration,
      startTimeMs: startTime,
      commitTimeMs: commitTime,
    });
  }, []);

  const message = (
    // Opt this message body into the composer-matched prose size. Both the
    // stable and live MarkdownBody below inherit --prose-text-size from here,
    // so the reserved height is identical between streaming and settled states.
    <div className="[--prose-text-size:var(--text-message)] [--prose-text-line-height:var(--text-message--line-height)] text-[length:var(--prose-text-size)] leading-[var(--prose-text-line-height)] select-text text-foreground">
      <AssistantMessageContent
        debugPerformanceEnabled={debugPerformanceEnabled}
        content={content}
        isStreaming={isStreaming}
        animateReveal={shouldAnimateReveal}
        initialVisibleLength={initialVisibleLength}
        onRevealStateChange={onRevealStateChange}
        renderLink={renderLink}
        renderInlineCode={renderInlineCode}
        renderCodeBlock={renderCodeBlock}
      />
    </div>
  );

  return debugPerformanceEnabled
    ? (
      <Profiler id={`assistant-message:${debugProfilerId}`} onRender={reportDebugRender}>
        {message}
      </Profiler>
    )
    : message;
});

// STREAMING INVARIANT: assistant prose has one source-ordered reveal frontier.
// The visible content is always a prefix, so a later wrapped/source line cannot
// appear before the frontier reaches it. Recent words keep independent opacity
// animations, allowing the next word to begin before earlier fades finish.
// Hydrated history opts out and is visible immediately;
// newly generated text always starts at zero and follows the same maximum rate,
// even when the transport delivers a large initial or reconnect batch. The
// stable/live split keeps high-frequency Markdown parsing bounded to the active
// paragraph.
function AssistantMessageContent({
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
  // A transport pause, row remount, or completed→live transition must never
  // put already-painted prose back into fresh opacity animations. This
  // absolute source frontier only moves backward when the source is corrected.
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
    if (flushFrameRef.current === null) {
      return;
    }
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
    if (revealPhaseRef.current === "idle") {
      return;
    }
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
    if (settleDelayRef.current !== null || revealPhaseRef.current === "idle") {
      return;
    }
    settleDelayRef.current = window.setTimeout(() => {
      settleDelayRef.current = null;
      beginSettle();
    }, STREAM_REVEAL_IDLE_MS);
  };

  const scheduleFlush = () => {
    if (flushFrameRef.current !== null) {
      return;
    }
    flushFrameRef.current = window.requestAnimationFrame((timestamp) => {
      flushFrameRef.current = null;
      const elapsedMs =
        lastFlushAtRef.current === 0
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
      const target = targetContentRef.current;
      const nextVisible = selectVisibleTarget(
        target,
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
    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const contentWasRewritten = !content.startsWith(visible);

    if (!animateReveal || reducedMotion) {
      cancelFlush();
      cancelSettle();
      lastFlushAtRef.current = 0;
      lastVisibleCommitAtRef.current = 0;
      revealCharacterBudgetRef.current = 0;
      settledVisibleLengthRef.current = content.length;
      if (visible !== content) {
        commitVisibleContent(content);
      }
      commitRevealPhase("idle");
      return;
    }

    if (contentWasRewritten) {
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
      // The visual frontier has caught the transport. Keep its measured word
      // mask mounted through the fade, so the final word reaches full opacity
      // before downstream transcript rows are released.
      if (revealPhaseRef.current !== "idle") {
        beginSettle();
      }
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

  useEffect(
    () => () => {
      cancelFlush();
      cancelSettle();
    },
    [],
  );

  const splitContent = useMemo(
    () => splitAssistantContent(visibleContent),
    [visibleContent],
  );
  const isRevealing = visibleContent.length < content.length;
  const showRevealTail =
    splitContent.animateLiveContent &&
    splitContent.liveContent.length > 0 &&
    revealPhase !== "idle";
  const revealWindowCharacters = Math.ceil(
    (MAX_STREAM_REVEAL_CHARACTERS_PER_SECOND * STREAM_REVEAL_FADE_MS) / 1_000,
  );
  const revealedLiveSourceUpTo = Math.max(
    Math.max(
      0,
      splitContent.liveContent.length - revealWindowCharacters,
    ),
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
        <div
          data-streaming-reveal={showRevealTail ? revealPhase : undefined}
        >
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

function splitAssistantContent(content: string): {
  stableContent: string;
  liveContent: string;
  animateLiveContent: boolean;
} {
  if (!content) {
    return { stableContent: "", liveContent: "", animateLiveContent: false };
  }

  // Always split at the last safe paragraph boundary — including for plain
  // prose. The live MarkdownBody re-parses on every reveal flush; without a
  // split, a long prose message re-parses in its entirety at the flush rate,
  // which starves the main thread and lags composer typing.
  const structuredTail = hasOpenCodeFence(content) || hasTrailingTable(content);
  const boundary = findStableBoundary(content);
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

export function selectVisibleTarget(
  content: string,
  currentLength: number,
  maximumCharacters = 1,
): string {
  if (content.length <= currentLength) {
    return content;
  }
  return content.slice(
    0,
    Math.min(content.length, currentLength + Math.max(1, maximumCharacters)),
  );
}

function findCommonPrefixLength(left: string, right: string): number {
  const maximumLength = Math.min(left.length, right.length);
  let index = 0;
  while (index < maximumLength && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function initialVisibleContent(
  content: string,
  animateReveal: boolean,
  initialVisibleLength = 0,
): string {
  if (!animateReveal) {
    return content;
  }
  return content.slice(0, Math.max(0, Math.min(content.length, initialVisibleLength)));
}
