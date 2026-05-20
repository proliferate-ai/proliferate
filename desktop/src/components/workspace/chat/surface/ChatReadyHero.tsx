import { CHAT_PRE_MESSAGE_LABELS } from "@/copy/chat/chat-copy";

/**
 * Hero variant shown when a session is hydrated but has no turns yet. Loading
 * and agent-thinking affordances stay in their own surfaces, so this component
 * intentionally remains visually quiet.
 */
export function ChatReadyHero() {
  return (
    <div className="flex flex-col items-center text-center">
      <h2 className="mt-6 text-2xl font-semibold tracking-[-0.02em] text-foreground">
        {CHAT_PRE_MESSAGE_LABELS.readyTitle}
      </h2>
    </div>
  );
}
