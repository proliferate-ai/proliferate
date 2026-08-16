import { CHAT_PRE_MESSAGE_LABELS } from "#product/copy/chat/chat-copy";

/**
 * Hero variant shown when a session is hydrated but has no turns yet. Loading
 * and agent-thinking affordances stay in their own surfaces, so this component
 * intentionally remains visually quiet. It renders inside workspace chrome
 * that already carries the pane hierarchy, so it uses the same pane-level
 * title treatment as ChatSurfaceCard — the `hero` display role stays reserved
 * for full-page surfaces.
 */
export function ChatReadyHero() {
  return (
    <div className="flex flex-col items-center text-center">
      <h2 className="text-title font-semibold text-foreground">
        {CHAT_PRE_MESSAGE_LABELS.readyTitle}
      </h2>
    </div>
  );
}
