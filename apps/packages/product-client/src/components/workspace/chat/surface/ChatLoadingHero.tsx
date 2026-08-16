import { useChatLoadingSubstep } from "#product/hooks/chat/derived/use-chat-loading-substep";
import { DotCellLoader } from "#product/primitives/DotCellLoader";
import { LoadingBoundary } from "#product/primitives/LoadingBoundary";
import { ThinkingText } from "#product/primitives/patterns/ThinkingText";
import { DebugProfiler } from "#product/components/diagnostics/DebugProfiler";
import { useDebugRenderCount } from "#product/hooks/ui/debug/use-debug-render-count";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { hasWorkspaceBootstrappedInSession } from "#product/hooks/workspaces/lifecycle/workspace-bootstrap-memory";

export interface ChatLoadingHeroProps {
  /**
   * Fires the instant the DotCellLoader mark actually mounts (show-delay
   * elapsed). `ChatView` uses this to time its own exit hold (R16): the
   * hero mark must stay visible for `motion.loading.heroMinDisplayMs` once
   * shown, then fade over `motion.duration.exitMs`, even though `ChatView`
   * may switch `mode.kind` away from this component before that window
   * closes. This component cannot honor that hold itself — once `ChatView`
   * stops rendering it, it is gone — so `ChatView` keeps a frozen exit
   * overlay mounted past this component's own lifetime instead.
   */
  onTreatmentShown?: () => void;
}

/**
 * The chat pane's workspace-status/session-loading wait state (UX Latency +
 * Transitions ADR §4.3, Rung 3, R16). The dispatcher (ChatView) only mounts
 * this component while `mode.kind` is `workspace-status` or `session-loading`,
 * so it holds `state="pending"` for its whole life and the parent unmounts it
 * on resolve, the same governs-its-own-life shape as
 * `TranscriptSwitchingPlaceholder`. Routing through `LoadingBoundary` still
 * buys the 200ms show-delay so a sub-200ms workspace-status/session-loading
 * pass never flashes a treatment.
 *
 * The hero's minimum-display + fade-out (R16) is owned by `ChatView`, not this
 * component or `LoadingBoundary`: this component hardcodes `state="pending"`
 * for its whole life, so `LoadingBoundary`'s own min-display/fade-out
 * machinery (which only engages on a transition away from `pending`) never
 * fires here — resolution is `ChatView` unmounting this component
 * synchronously when `mode.kind` changes, not a local state change. This
 * component only reports the moment its treatment becomes visible via
 * `onTreatmentShown`; `ChatView` uses that instant to run its own exit-hold
 * timer past this component's unmount.
 *
 * A workspace that has already bootstrapped in this session never mounts the
 * mark: `hasWorkspaceBootstrappedInSession` short-circuits to `null` so a
 * revisit doesn't re-show a loading treatment for a workspace that already
 * settled.
 *
 * `awaiting-first-turn` keeps `ThinkingText` (agent-thinking copy, not a
 * loading treatment): it renders immediately, outside `LoadingBoundary`,
 * because it is agent-activity feedback inside otherwise-ready content, not
 * a wait state that should be withheld for a show-delay or held for a
 * min-display floor. Every other substep renders the DotCellLoader hero mark,
 * mark-only (no caption/workspace-name copy).
 */
export function ChatLoadingHero({ onTreatmentShown }: ChatLoadingHeroProps = {}) {
  useDebugRenderCount("chat-loading-hero");
  const { substep } = useChatLoadingSubstep();
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);

  if (substep === "awaiting-first-turn") {
    return (
      <DebugProfiler id="chat-loading-hero">
        <div
          className="flex flex-col items-center text-center"
          data-chat-loading-hero
        >
          <ThinkingText />
        </div>
      </DebugProfiler>
    );
  }

  if (selectedWorkspaceId && hasWorkspaceBootstrappedInSession(selectedWorkspaceId)) {
    return null;
  }

  return (
    <DebugProfiler id="chat-loading-hero">
      <LoadingBoundary
        state="pending"
        diagnostics={{ flow: "chat_loading_hero" }}
        onTreatmentShown={onTreatmentShown}
        className="flex flex-col items-center text-center"
        data-chat-loading-hero
        treatment={<DotCellLoader size="hero" />}
      />
    </DebugProfiler>
  );
}
