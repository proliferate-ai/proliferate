import { useEffect, useMemo, useState } from "react";
import { ThinkingText } from "@/components/feedback/ThinkingText";
import { CHAT_STREAMING_STATUS_LABELS } from "@/copy/chat/chat-copy";
import { DebugProfiler } from "@/components/diagnostics/DebugProfiler";
import { useDebugRenderCount } from "@/hooks/ui/debug/use-debug-render-count";

// Only surface the elapsed suffix once a wait is long enough to be worth
// acknowledging — short "Thinking" flashes stay clean.
const ELAPSED_SUFFIX_THRESHOLD_SECONDS = 10;

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
  const elapsedSeconds = useStreamingElapsedSeconds(startedMs);

  return (
    <DebugProfiler id="streaming-indicator">
      <div className="flex min-h-5 items-end gap-1.5 py-1 text-muted-foreground">
        <ThinkingText
          text={label}
          motionOriginMs={startedMs}
          className="text-[length:var(--text-message)] leading-[var(--text-message--line-height)]"
        />
        {elapsedSeconds !== null && (
          <span className="text-ui-sm leading-[var(--text-ui-sm--line-height)] tabular-nums text-faint">
            {"· "}
            {elapsedSeconds}s
          </span>
        )}
      </div>
    </DebugProfiler>
  );
}

// Ticks once per second while mounted; returns null until the wait crosses the
// threshold so the suffix appears — and then advances — in step with the clock.
function useStreamingElapsedSeconds(startedMs: number | null): number | null {
  const [elapsedSeconds, setElapsedSeconds] = useState<number | null>(() =>
    computeElapsedSuffixSeconds(startedMs),
  );

  useEffect(() => {
    if (startedMs === null) {
      setElapsedSeconds(null);
      return;
    }
    setElapsedSeconds(computeElapsedSuffixSeconds(startedMs));
    const interval = window.setInterval(() => {
      setElapsedSeconds(computeElapsedSuffixSeconds(startedMs));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [startedMs]);

  return elapsedSeconds;
}

function parseStartedAtMs(startedAt: string | null): number | null {
  if (!startedAt) return null;
  const parsed = Date.parse(startedAt);
  return Number.isFinite(parsed) ? parsed : null;
}

function computeElapsedSuffixSeconds(startedMs: number | null): number | null {
  if (startedMs === null) return null;
  const seconds = Math.floor((Date.now() - startedMs) / 1000);
  return seconds >= ELAPSED_SUFFIX_THRESHOLD_SECONDS ? seconds : null;
}
