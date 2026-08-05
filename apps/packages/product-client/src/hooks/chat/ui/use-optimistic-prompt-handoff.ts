import { useLayoutEffect, useState } from "react";
import type {
  PendingPromptEntry,
  TurnRecord,
} from "@proliferate/product-domain/chats/transcript/chat-transcript-state";
import { resolveOptimisticPromptHandoff } from "@proliferate/product-domain/chats/pending-prompts/pending-prompts";
import type { SessionViewState } from "@proliferate/product-domain/sessions/activity";

interface RetainedPromptState {
  sessionId: string;
  prompt: PendingPromptEntry;
}

/** Owns the committed pending-prompt → materialized-turn visual handoff. */
export function useOptimisticPromptHandoff({
  activeSessionId,
  optimisticPrompt,
  latestTurn,
  latestTurnHasAssistantRenderableContent,
  sessionViewState,
}: {
  activeSessionId: string;
  optimisticPrompt: PendingPromptEntry | null;
  latestTurn: TurnRecord | null;
  latestTurnHasAssistantRenderableContent: boolean;
  sessionViewState: SessionViewState;
}): PendingPromptEntry | null {
  const [retainedPromptState, setRetainedPromptState] = useState<RetainedPromptState | null>(
    () => optimisticPrompt
      ? { sessionId: activeSessionId, prompt: optimisticPrompt }
      : null,
  );
  const retainedOptimisticPrompt = retainedPromptState?.sessionId === activeSessionId
    ? retainedPromptState.prompt
    : null;
  const handoffPrompt = resolveOptimisticPromptHandoff({
    optimisticPrompt,
    retainedOptimisticPrompt,
    latestTurn,
    latestTurnHasAssistantRenderableContent,
    sessionViewState,
  });

  useLayoutEffect(() => {
    setRetainedPromptState((current) => {
      if (!handoffPrompt) {
        return current === null ? current : null;
      }
      if (current?.sessionId === activeSessionId && current.prompt === handoffPrompt) {
        return current;
      }
      return { sessionId: activeSessionId, prompt: handoffPrompt };
    });
  }, [activeSessionId, handoffPrompt]);

  return handoffPrompt;
}
