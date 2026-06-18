import type {
  TranscriptState,
  TurnRecord,
} from "@anyharness/sdk";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useRevertGitPatchesMutation } from "@anyharness/sdk-react";
import { TurnDiffPanel } from "./TurnDiffPanel";
import { TranscriptPatchTurnDiffPanel } from "./TranscriptPatchTurnDiffPanel";
import {
  TRAILING_STATUS_MIN_HEIGHT,
  TurnAssistantActionRow,
  TurnShell,
  resolveTurnTrailingStatus,
} from "./TranscriptTurnChrome";
import { TurnItemSequence } from "./TurnItemSequence";
import {
  findTailAssistantProseRootId,
  getAssistantProseContent,
  resolveTurnPromptTiming,
} from "@proliferate/product-domain/chats/transcript/transcript-rendering";
import {
  lastTopLevelItemIsAssistantProseWithText,
  latestTransientStatusText,
  shouldAllowTurnTrailingStatus,
} from "@proliferate/product-domain/chats/transcript/transcript-trailing-status";
import {
  resolveAssistantTurnActionTime,
} from "@proliferate/product-domain/chats/transcript/transcript-action-time";
import {
  collectTurnFileRevertPatchEntries,
} from "@proliferate/product-domain/chats/transcript/turn-file-patches";
import {
  latestCompletedTurn,
} from "@proliferate/product-domain/chats/transcript/last-turn-file-changes";
import type { TranscriptVirtualRow } from "@proliferate/product-domain/chats/transcript/transcript-virtual-rows";
import type { TurnDisplayBlock } from "@proliferate/product-domain/chats/transcript/transcript-presentation";
import type { PromptPlanAttachmentDescriptor } from "@proliferate/product-domain/chats/composer/prompt-plan-attachments";
import type { SessionViewState } from "@proliferate/product-domain/sessions/activity";
import { useToastStore } from "@/stores/toast/toast-store";

type PlanHandoffHandler = (plan: PromptPlanAttachmentDescriptor) => void;

export function TranscriptTurnRow({
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
  onOpenFile,
  onOpenTurnChanges,
  onOpenArtifact,
  onHandOffPlanToNewSession,
}: {
  row: Extract<TranscriptVirtualRow, { kind: "turn" }>;
  rowIndex: number;
  turn: TurnRecord;
  transcript: TranscriptState;
  latestTurnId: string | null;
  latestLiveExplorationBlock: Extract<TurnDisplayBlock, { kind: "collapsed_actions" }> | null;
  latestLiveStatus: ReactNode;
  outboxStartedAtByPromptId: ReadonlyMap<string, string>;
  selectedWorkspaceId: string | null;
  sessionViewState: SessionViewState;
  onOpenFile: (filePath: string) => void;
  onOpenTurnChanges?: () => void;
  onOpenArtifact: (workspaceId: string, artifactId: string) => void;
  onHandOffPlanToNewSession?: PlanHandoffHandler;
}) {
  const isLatestTurn = row.turnId === latestTurnId;
  const isLatestTurnInProgress = isLatestTurn && !turn.completedAt;
  const latestCompletedTurnId = useMemo(
    () => latestCompletedTurn(transcript)?.turnId ?? null,
    [transcript],
  );
  const diffPanelKind = resolveTranscriptTurnDiffPanelKind({
    rowIsLastTurnRow: row.isLastTurnRow,
    turnCompleted: !!turn.completedAt,
    turnId: turn.turnId,
    latestCompletedTurnId,
    hasFileBadges: turn.fileBadges.length > 0,
  });
  const isLatestCompletedTurnRow = diffPanelKind === "current";
  const presentation = row.presentation;
  const renderPresentation = row.renderPresentation;
  const liveExplorationBlock = isLatestTurn ? latestLiveExplorationBlock : null;
  const tailAssistantProseRootId = findTailAssistantProseRootId(
    presentation,
    transcript,
  );
  const tailAssistantCopyContent = getAssistantProseContent(
    tailAssistantProseRootId,
    transcript,
  );
  const tailAssistantItem = tailAssistantProseRootId
    ? transcript.itemsById[tailAssistantProseRootId]
    : null;
  const tailAssistantActionTime = resolveAssistantTurnActionTime({
    assistantItem: tailAssistantItem?.kind === "assistant_prose" ? tailAssistantItem : null,
    turn,
  });
  // Hide the trailing indicator only while the assistant prose item itself is
  // actively streaming. If the agent closes prose but keeps working internally,
  // the trailing indicator should return.
  const turnTiming = resolveTurnPromptTiming(
    turn,
    transcript,
    outboxStartedAtByPromptId,
  );
  // A cancelled turn settles to a completed row, so neither the live status nor
  // the per-row resolver paints anything — surface the muted "You stopped"
  // trailing label instead, keyed off the authoritative turn stop reason.
  const cancelledElapsedSeconds = resolveCancelledTurnElapsedSeconds(
    turn,
    turnTiming.startedAt,
  );
  const trailingStatus = !row.isLastTurnRow
    ? null
    : cancelledElapsedSeconds !== null
    ? resolveTurnTrailingStatus(turnTiming.startedAt, sessionViewState, null, cancelledElapsedSeconds)
    : isLatestTurn
    ? latestLiveStatus
    : shouldAllowTurnTrailingStatus({
        turn,
        transcript,
        isLatestTurnInProgress,
      })
        ? resolveTurnTrailingStatusForRow({
            turn,
            transcript,
            startedAt: turnTiming.startedAt,
            sessionViewState,
          })
        : null;
  const shouldReserveTurnAssistantActionSlot =
    isLatestTurnInProgress
    && !!tailAssistantCopyContent
    && !trailingStatus
    && lastTopLevelItemIsAssistantProseWithText(turn, transcript);
  const trailingStatusClassName = tailAssistantCopyContent
    ? undefined
    : TRAILING_STATUS_MIN_HEIGHT;
  const revertPatchesMutation = useRevertGitPatchesMutation({ workspaceId: selectedWorkspaceId });
  const showToast = useToastStore((state) => state.show);
  const [undoneTurnIds, setUndoneTurnIds] = useState<ReadonlySet<string>>(() => new Set());
  const turnRevertPatches = useMemo(
    () => isLatestCompletedTurnRow
      ? collectTurnFileRevertPatchEntries(turn, transcript)
      : { entries: [], blockedReason: null },
    [isLatestCompletedTurnRow, transcript, turn],
  );
  const turnUndoCompleted = undoneTurnIds.has(turn.turnId);
  const undoDisabledReason = turnUndoCompleted
    ? "Undo has already been applied for this turn."
    : turnRevertPatches.blockedReason
    ?? (!selectedWorkspaceId ? "Undo is unavailable until a workspace is selected." : null)
    ?? (turnRevertPatches.entries.length === 0
      ? "Undo is unavailable because this turn has no complete file patches."
      : null);
  const handleUndoTurnChanges = useCallback(() => {
    if (undoDisabledReason || turnRevertPatches.entries.length === 0) {
      return;
    }
    const fileCount = new Set(turnRevertPatches.entries.map((entry) => entry.path)).size;
    const confirmed = typeof window === "undefined"
      || window.confirm(`Undo file changes from the last turn? This will reverse ${fileCount} file${fileCount === 1 ? "" : "s"} as one operation.`);
    if (!confirmed) {
      return;
    }
    void revertPatchesMutation.mutateAsync({
      sourceLabel: "last turn",
      entries: turnRevertPatches.entries,
    }).then(() => {
      setUndoneTurnIds((current) => {
        if (current.has(turn.turnId)) {
          return current;
        }
        const next = new Set(current);
        next.add(turn.turnId);
        return next;
      });
      showToast("Undid last turn file changes.", "info");
      onOpenTurnChanges?.();
    }).catch((error) => {
      showToast(formatUndoError(error));
    });
  }, [
    onOpenTurnChanges,
    revertPatchesMutation,
    showToast,
    turn.turnId,
    turnRevertPatches.entries,
    undoDisabledReason,
  ]);

  return (
    <TurnShell isFirst={rowIndex === 0}>
      <div className={`flex flex-col gap-2 ${tailAssistantCopyContent ? "group/turn" : ""}`}>
        <TurnItemSequence
          turn={turn}
          transcript={transcript}
          isTurnComplete={!!turn.completedAt}
          presentation={renderPresentation}
          autoFollowCollapsedActionBlockId={liveExplorationBlock?.blockId ?? null}
          tailAssistantProseRootId={tailAssistantProseRootId}
          showCompletedArtifactFallback={row.isLastTurnRow}
          workspaceId={selectedWorkspaceId}
          onOpenArtifact={onOpenArtifact}
          onHandOffPlanToNewSession={onHandOffPlanToNewSession}
        />
        {diffPanelKind === "current" ? (
          <TurnDiffPanel
            turn={turn}
            transcript={transcript}
            workspaceId={selectedWorkspaceId}
            onOpenFile={onOpenFile}
            onOpenReviewPane={onOpenTurnChanges}
            onUndoTurnChanges={undoDisabledReason ? undefined : handleUndoTurnChanges}
            undoDisabledReason={undoDisabledReason}
            undoBusy={revertPatchesMutation.isPending}
          />
        ) : diffPanelKind === "transcript" ? (
          <TranscriptPatchTurnDiffPanel
            turn={turn}
            transcript={transcript}
            onOpenFile={onOpenFile}
          />
        ) : null}
        <TurnAssistantActionRow
          content={tailAssistantCopyContent}
          showCopyButton={row.isLastTurnRow && !!turn.completedAt}
          reserveSlot={row.isLastTurnRow && shouldReserveTurnAssistantActionSlot}
          timestampLabel={tailAssistantActionTime}
        />
        {trailingStatus && (
          <div className={trailingStatusClassName}>{trailingStatus}</div>
        )}
      </div>
    </TurnShell>
  );
}

export function resolveTranscriptTurnDiffPanelKind({
  rowIsLastTurnRow,
  turnCompleted,
  turnId,
  latestCompletedTurnId,
  hasFileBadges,
}: {
  rowIsLastTurnRow: boolean;
  turnCompleted: boolean;
  turnId: string;
  latestCompletedTurnId: string | null;
  hasFileBadges: boolean;
}): "current" | "transcript" | null {
  if (!rowIsLastTurnRow || !turnCompleted || !hasFileBadges) {
    return null;
  }
  return turnId === latestCompletedTurnId ? "current" : "transcript";
}

function formatUndoError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Could not undo last turn file changes.";
}

function resolveCancelledTurnElapsedSeconds(
  turn: TurnRecord,
  startedAt: string,
): number | null {
  if (turn.stopReason !== "cancelled" || !turn.completedAt) {
    return null;
  }
  const startedMs = Date.parse(startedAt);
  const completedMs = Date.parse(turn.completedAt);
  if (Number.isNaN(startedMs) || Number.isNaN(completedMs)) {
    return null;
  }
  return Math.max(0, Math.round((completedMs - startedMs) / 1000));
}

function resolveTurnTrailingStatusForRow({
  turn,
  transcript,
  startedAt,
  sessionViewState,
}: {
  turn: TurnRecord;
  transcript: TranscriptState;
  startedAt: string;
  sessionViewState: SessionViewState;
}) {
  return resolveTurnTrailingStatus(
    startedAt,
    sessionViewState,
    latestTransientStatusText(turn, transcript),
  );
}
