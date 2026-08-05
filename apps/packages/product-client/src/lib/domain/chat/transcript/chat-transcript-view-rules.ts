import type {
  PendingPromptEntry,
  TranscriptState,
  TurnRecord,
} from "@proliferate/product-domain/chats/transcript/chat-transcript-state";
import { outboxEntryToPendingPromptEntry } from "@proliferate/product-domain/sessions/intents/session-intent-selectors";
import type { PromptOutboxEntry } from "@proliferate/product-domain/sessions/intents/session-intent-model";
import type { TranscriptVirtualRow } from "@proliferate/product-domain/chats/transcript/transcript-virtual-rows";

type PendingPromptVirtualRow =
  Extract<TranscriptVirtualRow, { kind: "pending_prompt" | "outbox_prompt" }>;
type TurnVirtualRow = Extract<TranscriptVirtualRow, { kind: "turn" }>;

export type LatestTurnPresentation = TurnVirtualRow["presentation"];

export interface PendingPromptRenderTarget {
  prompt: PendingPromptEntry;
  outboxEntry: PromptOutboxEntry | null;
}

export function collectVisibleTurnIds(
  virtualRows: readonly TranscriptVirtualRow[],
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const row of virtualRows) {
    if (row.kind !== "turn" || seen.has(row.turnId)) {
      continue;
    }
    seen.add(row.turnId);
    ids.push(row.turnId);
  }
  return ids;
}

export function findLatestTurnPresentation(
  virtualRows: readonly TranscriptVirtualRow[],
  latestTurnId: string | null,
): LatestTurnPresentation | null {
  if (!latestTurnId) {
    return null;
  }

  const latestRow = virtualRows.find((row): row is TurnVirtualRow =>
    row.kind === "turn" && row.turnId === latestTurnId
  );
  return latestRow?.presentation ?? null;
}

export function resolvePendingPromptRenderTarget({
  row,
  visibleOptimisticPrompt,
  visibleOutboxEntries,
}: {
  row: PendingPromptVirtualRow;
  visibleOptimisticPrompt: PendingPromptEntry | null;
  visibleOutboxEntries: readonly PromptOutboxEntry[];
}): PendingPromptRenderTarget | null {
  if (row.kind === "pending_prompt") {
    return visibleOptimisticPrompt
      ? { prompt: visibleOptimisticPrompt, outboxEntry: null }
      : null;
  }

  const outboxEntry = visibleOutboxEntries.find((entry) =>
    entry.clientPromptId === row.clientPromptId
  ) ?? null;
  if (!outboxEntry) {
    return null;
  }

  return {
    prompt: outboxEntryToPendingPromptEntry(outboxEntry),
    outboxEntry,
  };
}

export function turnHasActiveToolWork(
  turn: Pick<TurnRecord, "itemOrder">,
  transcript: TranscriptState,
): boolean {
  return turn.itemOrder.some((itemId) => {
    const item = transcript.itemsById[itemId];
    return item?.kind === "tool_call"
      && item.status !== "completed"
      && item.status !== "failed";
  });
}
