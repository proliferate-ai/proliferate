import { useCallback, type ReactNode } from "react";
import type { PromptOutboxEntry } from "@proliferate/product-domain/sessions/intents/session-intent-model";
import type {
  PendingPromptEntry,
  TranscriptState,
} from "@proliferate/product-domain/chats/transcript/chat-transcript-state";
import type { SessionViewState } from "@proliferate/product-domain/sessions/activity";
import type { TranscriptVirtualRow } from "@proliferate/product-domain/chats/transcript/transcript-virtual-rows";
import type { TurnDisplayBlock } from "@proliferate/product-domain/chats/transcript/transcript-presentation";
import type {
  ChatTranscriptGoalEventRenderInput,
  ChatTranscriptOutboxActions,
  ChatTranscriptPendingPromptRenderInput,
  ChatTranscriptTurnRowRenderInput,
} from "./ChatTranscriptViewTypes";
import { resolvePendingPromptRenderTarget } from "./ChatTranscriptViewRules";

export function useChatTranscriptRowRenderer({
  activeSessionId,
  latestLiveExplorationBlock,
  latestLiveStatus,
  latestTurnId,
  optimisticPromptTrailingStatus,
  outboxActions,
  outboxStartedAtByPromptId,
  renderPendingPromptRow,
  renderTurnRow,
  renderGoalEventRow,
  selectedWorkspaceId,
  sessionViewState,
  transcript,
  visibleOutboxEntries,
  visibleOptimisticPrompt,
}: {
  activeSessionId: string;
  latestLiveExplorationBlock: Extract<TurnDisplayBlock, { kind: "collapsed_actions" }> | null;
  latestLiveStatus: ReactNode;
  latestTurnId: string | null;
  optimisticPromptTrailingStatus: ReactNode;
  outboxActions: ChatTranscriptOutboxActions;
  outboxStartedAtByPromptId: ReadonlyMap<string, string>;
  renderPendingPromptRow: (input: ChatTranscriptPendingPromptRenderInput) => ReactNode;
  renderTurnRow: (input: ChatTranscriptTurnRowRenderInput) => ReactNode;
  renderGoalEventRow?: (input: ChatTranscriptGoalEventRenderInput) => ReactNode;
  selectedWorkspaceId: string | null;
  sessionViewState: SessionViewState;
  transcript: TranscriptState;
  visibleOutboxEntries: readonly PromptOutboxEntry[];
  visibleOptimisticPrompt: PendingPromptEntry | null;
}): (row: TranscriptVirtualRow, rowIndex: number) => ReactNode {
  return useCallback((row: TranscriptVirtualRow, rowIndex: number) => {
    if (row.kind === "pending_prompt" || row.kind === "outbox_prompt") {
      const target = resolvePendingPromptRenderTarget({
        row,
        visibleOptimisticPrompt,
        visibleOutboxEntries,
      });
      if (!target) {
        return null;
      }
      return renderPendingPromptRow({
        activeSessionId,
        row,
        rowIndex,
        prompt: target.prompt,
        outboxEntry: target.outboxEntry,
        optimisticTrailingStatus: optimisticPromptTrailingStatus,
        outboxActions,
      });
    }

    if (row.kind === "goal_event") {
      return renderGoalEventRow?.({ row, rowIndex, event: row.event }) ?? null;
    }

    const turn = transcript.turnsById[row.turnId];
    if (!turn) {
      return null;
    }

    return renderTurnRow({
      row,
      rowIndex,
      turn,
      transcript,
      latestTurnId,
      latestLiveExplorationBlock,
      latestLiveStatus,
      outboxStartedAtByPromptId,
      selectedWorkspaceId,
      sessionViewState,
    });
  }, [
    activeSessionId,
    latestLiveExplorationBlock,
    latestLiveStatus,
    latestTurnId,
    optimisticPromptTrailingStatus,
    outboxActions,
    outboxStartedAtByPromptId,
    renderPendingPromptRow,
    renderTurnRow,
    renderGoalEventRow,
    selectedWorkspaceId,
    sessionViewState,
    transcript,
    visibleOutboxEntries,
    visibleOptimisticPrompt,
  ]);
}
