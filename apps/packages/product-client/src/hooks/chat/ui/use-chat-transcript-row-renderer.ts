import { useCallback, useMemo, type ReactNode } from "react";
import type { PromptOutboxEntry } from "#product/domain/sessions/intents/session-intent-model";
import type {
  PendingPromptEntry,
  TranscriptState,
} from "#product/domain/chats/transcript/chat-transcript-state";
import type { SessionViewState } from "#product/domain/sessions/activity";
import type { TranscriptVirtualRow } from "#product/domain/chats/transcript/transcript-virtual-rows";
import type { TurnDisplayBlock } from "#product/domain/chats/transcript/transcript-presentation";
import type {
  ChatTranscriptBackgroundWorkRenderInput,
  ChatTranscriptCompletionReceiptRenderInput,
  ChatTranscriptGoalEventRenderInput,
  ChatTranscriptOutboxActions,
  ChatTranscriptPendingPromptRenderInput,
  ChatTranscriptTurnRowRenderInput,
} from "./chat-transcript-view-types";
import { resolvePendingPromptRenderTarget } from "#product/lib/domain/chat/transcript/chat-transcript-view-rules";

export interface ChatTranscriptRowRendering {
  renderRow: (row: TranscriptVirtualRow, rowIndex: number) => ReactNode;
  getRowRenderRevision: (row: TranscriptVirtualRow) => object;
}

export function useChatTranscriptRowRenderer({
  activeSessionId,
  latestLiveExplorationBlock,
  latestLiveStatus,
  latestCompletedTurnId,
  latestTurnId,
  optimisticPromptTrailingStatus,
  outboxActions,
  outboxStartedAtByPromptId,
  renderPendingPromptRow,
  renderTurnRow,
  renderGoalEventRow,
  renderCompletionReceiptRow,
  renderBackgroundWorkRow,
  selectedWorkspaceId,
  sessionViewState,
  transcript,
  visibleOutboxEntries,
  visibleOptimisticPrompt,
}: {
  activeSessionId: string;
  latestLiveExplorationBlock: Extract<TurnDisplayBlock, { kind: "collapsed_actions" }> | null;
  latestLiveStatus: ReactNode;
  latestCompletedTurnId: string | null;
  latestTurnId: string | null;
  optimisticPromptTrailingStatus: ReactNode;
  outboxActions: ChatTranscriptOutboxActions;
  outboxStartedAtByPromptId: ReadonlyMap<string, string>;
  renderPendingPromptRow: (input: ChatTranscriptPendingPromptRenderInput) => ReactNode;
  renderTurnRow: (input: ChatTranscriptTurnRowRenderInput) => ReactNode;
  renderGoalEventRow?: (input: ChatTranscriptGoalEventRenderInput) => ReactNode;
  renderCompletionReceiptRow?: (input: ChatTranscriptCompletionReceiptRenderInput) => ReactNode;
  renderBackgroundWorkRow?: (input: ChatTranscriptBackgroundWorkRenderInput) => ReactNode;
  selectedWorkspaceId: string | null;
  sessionViewState: SessionViewState;
  transcript: TranscriptState;
  visibleOutboxEntries: readonly PromptOutboxEntry[];
  visibleOptimisticPrompt: PendingPromptEntry | null;
}): ChatTranscriptRowRendering {
  const renderRow = useCallback((row: TranscriptVirtualRow, rowIndex: number) => {
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
        transcript,
        selectedWorkspaceId,
        row,
        rowIndex,
        prompt: target.prompt,
        outboxEntry: target.outboxEntry,
        optimisticTrailingStatus: optimisticPromptTrailingStatus,
        outboxActions,
        sessionViewState,
      });
    }

    if (row.kind === "goal_event") {
      return renderGoalEventRow?.({ row, rowIndex, event: row.event }) ?? null;
    }

    if (row.kind === "completion_receipt") {
      return renderCompletionReceiptRow?.({ row, rowIndex, receipt: row.receipt }) ?? null;
    }

    if (row.kind === "background_work") {
      return renderBackgroundWorkRow?.({ row, rowIndex, runningCount: row.runningCount }) ?? null;
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
      latestCompletedTurnId,
      latestLiveExplorationBlock,
      latestLiveStatus,
      outboxStartedAtByPromptId,
      selectedWorkspaceId,
      sessionViewState,
    });
  }, [
    activeSessionId,
    latestCompletedTurnId,
    latestLiveExplorationBlock,
    latestLiveStatus,
    latestTurnId,
    optimisticPromptTrailingStatus,
    outboxActions,
    outboxStartedAtByPromptId,
    renderPendingPromptRow,
    renderTurnRow,
    renderGoalEventRow,
    renderCompletionReceiptRow,
    renderBackgroundWorkRow,
    selectedWorkspaceId,
    sessionViewState,
    transcript,
    visibleOutboxEntries,
    visibleOptimisticPrompt,
  ]);

  // Row wrappers intentionally ignore renderRow's whole-transcript identity.
  // These explicit revisions carry only the external inputs that can change a
  // row whose immutable row model stayed the same. A streaming tail update now
  // repaints the tail row while historical rows retain their memoized subtree.
  const turnRenderRevision = useMemo(() => ({}), [
    outboxStartedAtByPromptId,
    renderTurnRow,
    selectedWorkspaceId,
    sessionViewState,
    transcript.linkCompletionsByCompletionId,
    transcript.sessionMeta.title,
  ]);
  const latestTurnRenderRevision = useMemo(() => ({}), [
    latestLiveExplorationBlock,
    latestLiveStatus,
    latestTurnId,
    turnRenderRevision,
  ]);
  const latestCompletedTurnRenderRevision = useMemo(() => ({}), [
    latestCompletedTurnId,
    turnRenderRevision,
  ]);
  const pendingPromptRenderRevision = useMemo(() => ({}), [
    activeSessionId,
    optimisticPromptTrailingStatus,
    outboxActions,
    renderPendingPromptRow,
    selectedWorkspaceId,
    sessionViewState,
    transcript.linkCompletionsByCompletionId,
    visibleOptimisticPrompt,
    visibleOutboxEntries,
  ]);
  const goalEventRenderRevision = useMemo(() => ({}), [renderGoalEventRow]);
  // Both background-work rows carry their state in the row model itself (a new
  // row object is minted whenever the receipt list or running count changes),
  // so a renderer-identity revision is all these need — the memo's own
  // `prev.row === next.row` check drives the re-render.
  const completionReceiptRenderRevision = useMemo(() => ({}), [renderCompletionReceiptRow]);
  const backgroundWorkRenderRevision = useMemo(() => ({}), [renderBackgroundWorkRow]);

  const getRowRenderRevision = useCallback((row: TranscriptVirtualRow): object => {
    if (row.kind === "pending_prompt" || row.kind === "outbox_prompt") {
      return pendingPromptRenderRevision;
    }
    if (row.kind === "goal_event") {
      return goalEventRenderRevision;
    }
    if (row.kind === "completion_receipt") {
      return completionReceiptRenderRevision;
    }
    if (row.kind === "background_work") {
      return backgroundWorkRenderRevision;
    }
    if (row.turnId === latestTurnId) {
      return latestTurnRenderRevision;
    }
    if (row.turnId === latestCompletedTurnId) {
      return latestCompletedTurnRenderRevision;
    }
    return turnRenderRevision;
  }, [
    backgroundWorkRenderRevision,
    completionReceiptRenderRevision,
    goalEventRenderRevision,
    latestCompletedTurnId,
    latestCompletedTurnRenderRevision,
    latestTurnId,
    latestTurnRenderRevision,
    pendingPromptRenderRevision,
    turnRenderRevision,
  ]);

  return { renderRow, getRowRenderRevision };
}
