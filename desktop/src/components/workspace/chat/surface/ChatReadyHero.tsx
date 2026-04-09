import { CHAT_PRE_MESSAGE_LABELS } from "@/config/chat";
import { ProliferateIconResolve } from "@/components/ui/icons";
import { useChatReadyContext } from "@/hooks/chat/use-chat-ready-context";

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
  const { workspaceName, branchLabel, agentDisplayName, modelDisplayName } = useChatReadyContext();

  const contextSegments = [workspaceName, branchLabel, agentDisplayName, modelDisplayName]
    .filter((segment): segment is string => !!segment);

  return (
    <div className="flex flex-col items-center text-center">
      <ProliferateIconResolve className="size-[3rem] text-foreground" />
      <h2 className="mt-6 text-2xl font-semibold tracking-[-0.02em] text-foreground">
        {CHAT_PRE_MESSAGE_LABELS.readyTitle}
      </h2>
      {contextSegments.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground/70">
          {contextSegments.join(" · ")}
        </p>
      )}
    </div>
  );
}
