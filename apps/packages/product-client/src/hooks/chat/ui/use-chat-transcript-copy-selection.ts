import { useCallback, type RefObject } from "react";
import type {
  PendingPromptEntry,
  TranscriptState,
} from "#product/domain/chats/transcript/chat-transcript-state";
import { collectToolCallIdsWithProposedPlan } from "#product/domain/chats/transcript/transcript-rendering";
import { buildTranscriptCopyText } from "#product/domain/chats/transcript/transcript-copy";
import { useChatTranscriptSelection } from "./chat-transcript-selection";

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
