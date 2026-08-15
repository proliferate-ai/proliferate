import { useChatLoadingSubstep } from "#product/hooks/chat/derived/use-chat-loading-substep";
import { ProliferateLivingMark } from "#product/components/brand/ProliferateLivingMark";
import { LoadingBoundary } from "#product/primitives/LoadingBoundary";
import { ThinkingText } from "#product/primitives/patterns/ThinkingText";
import { DebugProfiler } from "#product/components/diagnostics/DebugProfiler";
import { useDebugRenderCount } from "#product/hooks/ui/debug/use-debug-render-count";

/**
 * The chat pane's workspace-status/session-loading wait state (UX Latency +
 * Transitions ADR §4.3, Rung 3). The dispatcher (ChatView) only mounts this
 * component while `mode.kind` is `workspace-status` or `session-loading`, so
 * it holds `state="pending"` for its whole life and the parent unmounts it on
 * resolve, the same governs-its-own-life shape as `TranscriptSwitchingPlaceholder`.
 * Routing through `LoadingBoundary` still buys the 200ms show-delay so a
 * sub-200ms workspace-status/session-loading pass never flashes a treatment.
 *
 * `awaiting-first-turn` keeps `ThinkingText` (agent-thinking copy, not a
 * loading treatment): it renders immediately, outside `LoadingBoundary`,
 * because it is agent-activity feedback inside otherwise-ready content, not
 * a wait state that should be withheld for a show-delay or held for a
 * min-display floor. Every other substep renders the Class A
 * `ProliferateLivingMark` in place of the old `DotCellLoader` wave.
 */
export function ChatLoadingHero() {
  useDebugRenderCount("chat-loading-hero");
  const { caption, substep, workspaceName } = useChatLoadingSubstep();

  if (substep === "awaiting-first-turn") {
    return (
      <DebugProfiler id="chat-loading-hero">
        <div
          className="flex flex-col items-center text-center"
          data-chat-loading-hero
        >
          <ThinkingText />
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

  return (
    <DebugProfiler id="chat-loading-hero">
      <LoadingBoundary
        state="pending"
        diagnostics={{ flow: "chat_loading_hero" }}
        className="flex flex-col items-center text-center"
        data-chat-loading-hero
        treatment={
          <>
            <ProliferateLivingMark />
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
          </>
        }
      />
    </DebugProfiler>
  );
}
