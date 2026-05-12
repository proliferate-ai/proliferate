import { CHAT_PRE_MESSAGE_LABELS } from "@/copy/chat/chat-copy";

/**
 * Hero variant shown when a session is hydrated but has no turns yet. The
 * braille loading sweep from ChatLoadingHero unmounts at its landed frame
 * (⣿⣿) and this hero mounts in its place — the brand mark resolves
 * outward from its center, so the loading → ready transition reads as
 * "the sweep settles into the brand" rather than a flat swap.
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
