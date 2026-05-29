import { ThinkingText } from "@/components/feedback/ThinkingText";
import { DebugProfiler } from "@/components/ui/DebugProfiler";
import { useDebugRenderCount } from "@/hooks/ui/use-debug-render-count";

interface StreamingIndicatorProps {
  startedAt?: string | null;
}

export function StreamingIndicator({ startedAt: _startedAt }: StreamingIndicatorProps) {
  useDebugRenderCount("thinking-text");

  return (
    <DebugProfiler id="thinking-text">
      <div className="flex min-h-5 items-end py-1 text-muted-foreground">
        <ThinkingText />
      </div>
    </DebugProfiler>
  );
}
