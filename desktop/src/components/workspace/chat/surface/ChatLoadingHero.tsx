import { useChatLoadingSubstep } from "@/hooks/chat/derived/use-chat-loading-substep";
import { SkeletonBlock } from "@/components/feedback/Skeleton";
import { ThinkingText } from "@/components/feedback/ThinkingText";
import { DebugProfiler } from "@/components/ui/DebugProfiler";
import { useDebugRenderCount } from "@/hooks/ui/use-debug-render-count";

export function ChatLoadingHero() {
  useDebugRenderCount("chat-loading-hero");
  const { caption, substep, workspaceName } = useChatLoadingSubstep();
  const showThinking = substep === "awaiting-first-turn";

  return (
    <DebugProfiler id="chat-loading-hero">
      <div className="flex flex-col items-center text-center" data-chat-loading-hero>
        {showThinking ? (
          <ThinkingText className="text-sm leading-5" />
        ) : (
          <div className="flex w-36 flex-col items-center gap-2" aria-hidden="true">
            <SkeletonBlock className="h-2 w-24" />
            <SkeletonBlock className="h-2 w-36 bg-muted/45" />
          </div>
        )}
        {caption && (
          <p className="mt-4 text-sm font-medium text-muted-foreground">{caption}</p>
        )}
        {workspaceName && (
          <p className="mt-1 text-xs text-muted-foreground/70">{workspaceName}</p>
        )}
      </div>
    </DebugProfiler>
  );
}
