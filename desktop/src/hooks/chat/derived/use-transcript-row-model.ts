import { useMemo, useRef } from "react";
import type { PendingPromptEntry, TranscriptState } from "@anyharness/sdk";
import {
  buildTranscriptRowModel,
  createTranscriptRowModelCache,
  type TranscriptRow,
} from "@/lib/domain/chat/transcript/transcript-row-model";
import type { PromptOutboxEntry } from "@/lib/domain/sessions/intents/session-intent-model";
import { measureDebugComputation } from "@/lib/infra/measurement/debug-measurement";
import { useDebugValueChange } from "@/hooks/ui/use-debug-value-change";

export function useTranscriptRowModel(input: {
  activeSessionId: string;
  transcript: TranscriptState;
  visibleOptimisticPrompt: PendingPromptEntry | null;
  visibleOutboxEntries: readonly PromptOutboxEntry[];
  latestTurnId: string | null;
  latestTurnHasAssistantRenderableContent: boolean;
}): readonly TranscriptRow[] {
  const cacheRef = useRef(createTranscriptRowModelCache());

  useDebugValueChange("transcript_row_model.inputs", "dimensions", {
    activeSessionId: input.activeSessionId,
    turnCount: input.transcript.turnOrder.length,
    itemCount: Object.keys(input.transcript.itemsById).length,
    latestTurnId: input.latestTurnId,
    latestTurnHasAssistantRenderableContent: input.latestTurnHasAssistantRenderableContent,
    optimisticPromptId: input.visibleOptimisticPrompt?.promptId ?? null,
    outboxPromptCount: input.visibleOutboxEntries.length,
    outboxPromptIds: input.visibleOutboxEntries.map((entry) => entry.clientPromptId).join(","),
    cacheTurnCount: cacheRef.current.turnRowsById.size,
  });

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

  const rowSignature = useMemo(
    () => summarizeTranscriptRows(rows),
    [rows],
  );

  useDebugValueChange("transcript_row_model.outputs", "row_signature", {
    activeSessionId: input.activeSessionId,
    ...rowSignature,
  });

  return rows;
}

function summarizeTranscriptRows(rows: readonly TranscriptRow[]) {
  let turnRowCount = 0;
  let pendingPromptRowCount = 0;
  let outboxPromptRowCount = 0;
  for (const row of rows) {
    if (row.kind === "turn") {
      turnRowCount += 1;
    } else if (row.kind === "pending_prompt") {
      pendingPromptRowCount += 1;
    } else if (row.kind === "outbox_prompt") {
      outboxPromptRowCount += 1;
    }
  }
  return {
    rowCount: rows.length,
    firstRowKey: rows[0]?.key ?? null,
    lastRowKey: rows[rows.length - 1]?.key ?? null,
    turnRowCount,
    pendingPromptRowCount,
    outboxPromptRowCount,
  };
}
