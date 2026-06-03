import { ThinkingText } from "@/components/feedback/ThinkingText";
import { DebugProfiler } from "@/components/diagnostics/DebugProfiler";
import { useDebugRenderCount } from "@/hooks/ui/debug/use-debug-render-count";

interface StreamingIndicatorProps {
  startedAt?: string | null;
}

export function StreamingIndicator({ startedAt: _startedAt }: StreamingIndicatorProps) {
  useDebugRenderCount("streaming-indicator");

  return (
    <DebugProfiler id="streaming-indicator">
      <div className="flex min-h-5 items-end py-1 text-muted-foreground">
        <ThinkingText />
      </div>
    </DebugProfiler>
  );
}
