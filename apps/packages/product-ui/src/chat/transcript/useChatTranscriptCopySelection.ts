import { useCallback, type RefObject } from "react";
import type {
  PendingPromptEntry,
  TranscriptState,
} from "@proliferate/product-domain/chats/transcript/chat-transcript-state";
import { collectToolCallIdsWithProposedPlan } from "@proliferate/product-domain/chats/transcript/transcript-rendering";
import { buildTranscriptCopyText } from "@proliferate/product-domain/chats/transcript/transcript-copy";
import { useChatTranscriptSelection } from "./ChatTranscriptSelection";

export function useChatTranscriptCopySelection({
  selectionRootRef,
  transcript,
  visibleTurnIds,
  visibleOptimisticPrompt,
}: {
  selectionRootRef: RefObject<HTMLDivElement | null>;
  transcript: TranscriptState;
  visibleTurnIds: readonly string[];
  visibleOptimisticPrompt: PendingPromptEntry | null;
}): void {
  const getTranscriptCopyText = useCallback(() => buildTranscriptCopyText({
    transcript,
    visibleTurnIds,
    visibleOptimisticPrompt,
    proposedPlanToolCallIds: collectToolCallIdsWithProposedPlan(transcript),
  }), [
    transcript,
    visibleTurnIds,
    visibleOptimisticPrompt,
  ]);

  useChatTranscriptSelection({
    rootRef: selectionRootRef,
    getCopyText: getTranscriptCopyText,
  });
}
