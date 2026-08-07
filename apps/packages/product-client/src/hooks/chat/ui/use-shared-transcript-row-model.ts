import { useMemo, useRef } from "react";
import type {
  PendingPromptEntry,
  TranscriptState,
} from "#product/domain/chats/transcript/chat-transcript-state";
import type { PromptOutboxEntry } from "#product/domain/sessions/intents/session-intent-model";
import {
  buildTranscriptRowModel,
  createTranscriptRowModelCache,
} from "#product/domain/chats/transcript/transcript-row-model";
import type { TranscriptVirtualRow } from "#product/domain/chats/transcript/transcript-virtual-rows";
import type { GoalTranscriptEvent } from "#product/domain/activity/goal-transcript-events";

export function useSharedTranscriptRowModel(input: {
  activeSessionId: string;
  transcript: TranscriptState;
  visibleOptimisticPrompt: PendingPromptEntry | null;
  visibleOutboxEntries: readonly PromptOutboxEntry[];
  latestTurnId: string | null;
  latestTurnHasAssistantRenderableContent: boolean;
  goalEvents?: readonly GoalTranscriptEvent[];
  workspaceReceiptKey?: string | null;
}): readonly TranscriptVirtualRow[] {
  const cacheRef = useRef(createTranscriptRowModelCache());

  return useMemo(
    () => buildTranscriptRowModel(input, cacheRef.current),
    [
      input.activeSessionId,
      input.latestTurnHasAssistantRenderableContent,
      input.latestTurnId,
      input.transcript,
      input.visibleOptimisticPrompt,
      input.visibleOutboxEntries,
      input.goalEvents,
      input.workspaceReceiptKey,
    ],
  );
}
