import { useMemo, useRef } from "react";
import type { PendingPromptEntry, TranscriptState } from "@anyharness/sdk";
import {
  buildTranscriptRowModel,
  createTranscriptRowModelCache,
  type TranscriptRow,
} from "@proliferate/product-domain/chats/transcript/transcript-row-model";
import type { PromptOutboxEntry } from "@proliferate/product-domain/sessions/intents/session-intent-model";
import { measureDebugComputation } from "@/lib/infra/measurement/debug-measurement";

export function useTranscriptRowModel(input: {
  activeSessionId: string;
  transcript: TranscriptState;
  visibleOptimisticPrompt: PendingPromptEntry | null;
  visibleOutboxEntries: readonly PromptOutboxEntry[];
  latestTurnId: string | null;
  latestTurnHasAssistantRenderableContent: boolean;
}): readonly TranscriptRow[] {
  const cacheRef = useRef(createTranscriptRowModelCache());

  const rows = useMemo(
    () => measureDebugComputation({
      category: "transcript_row_model.derive",
      label: "rows",
      keys: [
        "activeSessionId",
        "latestTurnId",
        "transcript",
        "visibleOptimisticPrompt",
        "visibleOutboxEntries",
      ],
      count: (rows) => rows.length,
    }, () => buildTranscriptRowModel(input, cacheRef.current)),
    [
      input.activeSessionId,
      input.latestTurnHasAssistantRenderableContent,
      input.latestTurnId,
      input.transcript,
      input.visibleOptimisticPrompt,
      input.visibleOutboxEntries,
    ],
  );

  return rows;
}
