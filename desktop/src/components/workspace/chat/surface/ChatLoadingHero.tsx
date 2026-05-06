import { useChatLoadingSubstep } from "@/hooks/chat/use-chat-loading-substep";
import { DebugProfiler } from "@/components/ui/DebugProfiler";
import { BrailleSweepBadge } from "@/components/ui/icons";
import { useDebugRenderCount } from "@/hooks/ui/use-debug-render-count";

/**
 * Hero variant of the chat surface shown while a session is being prepared.
 * The braille sweep is the same animation the in-transcript StreamingIndicator
 * uses (via useBrailleSweep), so the loading vocabulary stays consistent
 * across the surface — only the scale changes.
 *
 * Caption + workspace context come from useChatLoadingSubstep, which
 * disambiguates the four sub-states that funnel into `session-loading` in
 * useChatSurfaceState.
 */
export function ChatLoadingHero() {
  useDebugRenderCount("loading-braille");
  const { caption, workspaceName } = useChatLoadingSubstep();

  return (
    <DebugProfiler id="loading-braille">
      <div className="flex flex-col items-center text-center" data-chat-loading-hero>
      <BrailleSweepBadge className="text-6xl text-foreground" />
      {caption && (
        <p className="mt-6 text-sm font-medium text-muted-foreground">{caption}</p>
      )}
      {workspaceName && (
        <p className="mt-1 text-xs text-muted-foreground/70">{workspaceName}</p>
      )}
      </div>
    </DebugProfiler>
  );
}
