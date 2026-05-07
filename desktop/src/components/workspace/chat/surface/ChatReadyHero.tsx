import { CHAT_PRE_MESSAGE_LABELS } from "@/copy/chat/chat-copy";
import { useChatReadyContext } from "@/hooks/chat/use-chat-ready-context";
import { formatChatReadyContextLine } from "@/lib/domain/chat/chat-ready-context";

/**
 * Hero variant shown when a session is hydrated but has no turns yet. The
 * braille loading sweep from ChatLoadingHero unmounts at its landed frame
 * (⣿⣿) and this hero mounts in its place — the brand mark resolves
 * outward from its center, so the loading → ready transition reads as
 * "the sweep settles into the brand" rather than a flat swap.
 *
 * The context line is intentionally muted text (workspace · branch · agent
 * · model) — it grounds the user in *this* session without competing with
 * the composer for attention.
 */
export function ChatReadyHero() {
  const context = useChatReadyContext();
  const contextLine = formatChatReadyContextLine(context);

  return (
    <div className="flex flex-col items-center text-center">
      <h2 className="mt-6 text-2xl font-semibold tracking-[-0.02em] text-foreground">
        {CHAT_PRE_MESSAGE_LABELS.readyTitle}
      </h2>
      {contextLine && (
        <p className="mt-2 text-sm text-muted-foreground" data-telemetry-mask>
          {contextLine}
        </p>
      )}
    </div>
  );
}
