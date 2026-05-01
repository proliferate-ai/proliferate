import type { PendingPromptEntry, TranscriptState } from "@anyharness/sdk";

export type TranscriptVirtualRow =
  | {
    kind: "turn";
    key: `turn:${string}`;
    turnId: string;
  }
  | {
    kind: "pending_prompt";
    key: `pending-prompt:${string}`;
  };

export interface BuildTranscriptVirtualRowsInput {
  activeSessionId: string;
  transcript: TranscriptState;
  visibleOptimisticPrompt: PendingPromptEntry | null;
  latestTurnId: string | null;
  latestTurnHasAssistantRenderableContent: boolean;
}

export function buildTranscriptVirtualRows({
  activeSessionId,
  transcript,
  visibleOptimisticPrompt,
  latestTurnId,
  latestTurnHasAssistantRenderableContent,
}: BuildTranscriptVirtualRowsInput): TranscriptVirtualRow[] {
  const rows: TranscriptVirtualRow[] = [];

  for (const turnId of transcript.turnOrder) {
    const turn = transcript.turnsById[turnId];
    if (!turn) {
      continue;
    }

    const isLatestTurn = turnId === latestTurnId;
    const isLatestTurnInProgress = isLatestTurn && !turn.completedAt;
    if (
      visibleOptimisticPrompt !== null
      && isLatestTurnInProgress
      && !latestTurnHasAssistantRenderableContent
    ) {
      continue;
    }

    rows.push({
      kind: "turn",
      key: `turn:${turnId}`,
      turnId,
    });
  }

  if (visibleOptimisticPrompt) {
    rows.push({
      kind: "pending_prompt",
      key: `pending-prompt:${activeSessionId}`,
    });
  }

  return rows;
}

export function resolveVirtualBottomDistance(input: {
  scrollOffset: number;
  viewportSize: number;
  totalVirtualSize: number;
}): number {
  return Math.max(
    input.totalVirtualSize - input.scrollOffset - input.viewportSize,
    0,
  );
}

export function shouldStickToVirtualBottom(input: {
  scrollOffset: number;
  viewportSize: number;
  totalVirtualSize: number;
  thresholdPx: number;
}): boolean {
  return resolveVirtualBottomDistance(input) <= input.thresholdPx;
}
