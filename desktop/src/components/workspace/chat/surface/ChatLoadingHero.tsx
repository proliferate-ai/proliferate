import { useBrailleSweep } from "@/hooks/ui/use-braille-sweep";
import { useChatLoadingSubstep } from "@/hooks/chat/use-chat-loading-substep";

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
  const frame = useBrailleSweep();
  const { caption, workspaceName } = useChatLoadingSubstep();

  return (
    <div className="flex flex-col items-center text-center">
      <span
        aria-hidden
        className="font-mono text-6xl leading-none tracking-[-0.18em] text-foreground"
      >
        {frame}
      </span>
      <p className="mt-6 text-sm font-medium text-muted-foreground">{caption}</p>
      {workspaceName && (
        <p className="mt-1 text-xs text-muted-foreground/70">{workspaceName}</p>
      )}
    </div>
  );
}
