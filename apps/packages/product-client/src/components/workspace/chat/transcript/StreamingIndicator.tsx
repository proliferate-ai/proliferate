import { useMemo } from "react";
import { ThinkingText } from "#product/components/feedback/ThinkingText";
import { CHAT_STREAMING_STATUS_LABELS } from "#product/copy/chat/chat-copy";
import { DebugProfiler } from "#product/components/diagnostics/DebugProfiler";
import { useDebugRenderCount } from "#product/hooks/ui/debug/use-debug-render-count";

interface StreamingIndicatorProps {
  startedAt?: string | null;
  /** Context label for the animated status; defaults to agent-work "Thinking". */
  label?: string;
}

export function StreamingIndicator({
  startedAt = null,
  label = CHAT_STREAMING_STATUS_LABELS.thinking,
}: StreamingIndicatorProps) {
  useDebugRenderCount("streaming-indicator");
  const startedMs = useMemo(() => parseStartedAtMs(startedAt), [startedAt]);

  return (
    <DebugProfiler id="streaming-indicator">
      <div className="flex min-h-5 items-baseline gap-1.5 py-1 text-muted-foreground">
        <ThinkingText
          text={label}
          motionOriginMs={startedMs}
          className="text-message"
        />
      </div>
    </DebugProfiler>
  );
}

function parseStartedAtMs(startedAt: string | null): number | null {
  if (!startedAt) return null;
  const parsed = Date.parse(startedAt);
  return Number.isFinite(parsed) ? parsed : null;
}
