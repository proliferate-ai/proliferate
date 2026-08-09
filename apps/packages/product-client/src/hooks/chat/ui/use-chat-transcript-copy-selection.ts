import { useCallback, type RefObject } from "react";
import type {
  PendingPromptEntry,
  TranscriptState,
} from "#product/domain/chats/transcript/chat-transcript-state";
import { collectToolCallIdsWithProposedPlan } from "#product/domain/chats/transcript/transcript-rendering";
import { buildTranscriptCopyText } from "#product/domain/chats/transcript/transcript-copy";
import {
  useChatTranscriptSelection,
  type ChatTranscriptSelectionState,
} from "./chat-transcript-selection";

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
}): ChatTranscriptSelectionState {
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

  return useChatTranscriptSelection({
    rootRef: selectionRootRef,
    getCopyText: getTranscriptCopyText,
  });
}
