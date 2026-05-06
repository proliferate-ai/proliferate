import { useMemo, useRef } from "react";
import type { PendingPromptEntry, TranscriptState } from "@anyharness/sdk";
import {
  buildTranscriptRowModel,
  createTranscriptRowModelCache,
  type TranscriptRow,
} from "@/lib/domain/chat/transcript-row-model";
import type { PromptOutboxEntry } from "@/lib/domain/chat/prompt-outbox";

export function useTranscriptRowModel(input: {
  activeSessionId: string;
  transcript: TranscriptState;
  visibleOptimisticPrompt: PendingPromptEntry | null;
  visibleOutboxEntries: readonly PromptOutboxEntry[];
  latestTurnId: string | null;
  latestTurnHasAssistantRenderableContent: boolean;
}): readonly TranscriptRow[] {
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
    ],
  );
}
