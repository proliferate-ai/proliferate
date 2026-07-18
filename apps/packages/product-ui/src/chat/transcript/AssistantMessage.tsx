import {
  Profiler,
  memo,
  useCallback,
  useId,
  useRef,
  type ProfilerOnRenderCallback,
} from "react";
import {
  type MarkdownCodeBlockRenderer,
  type MarkdownInlineCodeRenderer,
  type MarkdownLinkRenderer,
} from "./MarkdownBody";
import { AssistantMessageContent } from "./AssistantMessageContent";
import {
  isDevAssistantPerformanceEnabled,
  recordDevAssistantPerformance,
} from "./dev-assistant-performance";
import type { AssistantMessageRevealState } from "./assistant-message-reveal";

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

export type {
  AssistantMessageRevealPhase,
  AssistantMessageRevealState,
} from "./assistant-message-reveal";

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
