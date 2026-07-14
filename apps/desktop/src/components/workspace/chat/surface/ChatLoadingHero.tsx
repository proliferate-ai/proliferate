import { useChatLoadingSubstep } from "#product/hooks/chat/derived/use-chat-loading-substep";
import { SkeletonBlock } from "#product/components/feedback/Skeleton";
import { ThinkingText } from "#product/components/feedback/ThinkingText";
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
          <div className="flex w-36 flex-col items-center gap-2" aria-hidden="true">
            <SkeletonBlock className="h-2 w-24" />
            <SkeletonBlock className="h-2 w-36 bg-muted/45" />
          </div>
        )}
        {caption && (
          <p className="mt-4 text-chat font-medium leading-[var(--text-chat--line-height)] text-muted-foreground">
            {caption}
          </p>
        )}
        {workspaceName && (
          <p className="mt-1 text-chat font-medium leading-[var(--text-chat--line-height)] text-muted-foreground/80">
            {workspaceName}
          </p>
        )}
      </div>
    </DebugProfiler>
  );
}
