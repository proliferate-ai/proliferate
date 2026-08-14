import { useChatLoadingSubstep } from "#product/hooks/chat/derived/use-chat-loading-substep";
import { DotCellLoader } from "#product/primitives/DotCellLoader";
import { ThinkingText } from "#product/primitives/patterns/ThinkingText";
import { DebugProfiler } from "#product/components/diagnostics/DebugProfiler";
import { useDebugRenderCount } from "#product/hooks/ui/debug/use-debug-render-count";

export function ChatLoadingHero() {
  useDebugRenderCount("chat-loading-hero");
  const { caption, substep, workspaceName } = useChatLoadingSubstep();
  const showThinking = substep === "awaiting-first-turn";

  return (
    <DebugProfiler id="chat-loading-hero">
      <div className="flex flex-col items-center text-center" data-chat-loading-hero>
        {showThinking ? (
          <ThinkingText />
        ) : (
          <DotCellLoader
            aria-hidden="true"
            className="text-muted-foreground"
            variant="wave"
          />
        )}
        {caption && (
          <p className="mt-4 text-chat font-medium text-muted-foreground">
            {caption}
          </p>
        )}
        {workspaceName && (
          <p className="mt-1 text-chat font-medium text-muted-foreground/80">
            {workspaceName}
          </p>
        )}
      </div>
    </DebugProfiler>
  );
}
