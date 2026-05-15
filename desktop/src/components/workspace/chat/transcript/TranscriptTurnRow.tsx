import type {
  TranscriptState,
  TurnRecord,
} from "@anyharness/sdk";
import type { ReactNode } from "react";
import { TurnDiffPanel } from "./TurnDiffPanel";
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
} from "@/lib/domain/chat/transcript/transcript-rendering";
import {
  lastTopLevelItemIsAssistantProseWithText,
  latestTransientStatusText,
  shouldAllowTurnTrailingStatus,
} from "@/lib/domain/chat/transcript/transcript-trailing-status";
import {
  resolveAssistantTurnActionTime,
} from "@/lib/domain/chat/transcript/transcript-action-time";
import type { TranscriptVirtualRow } from "@/lib/domain/chat/transcript/transcript-virtual-rows";
import type { TurnDisplayBlock } from "@/lib/domain/chat/transcript/transcript-presentation";
import type { PromptPlanAttachmentDescriptor } from "@/lib/domain/chat/composer/prompt-plan-attachments";
import type { SessionViewState } from "@/lib/domain/sessions/activity";

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
  const hasFileBadges = turn.fileBadges.length > 0;
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
  const trailingStatus = !row.isLastTurnRow
    ? null
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

  return (
    <TurnShell isFirst={rowIndex === 0}>
      <div className={`flex flex-col gap-2 ${tailAssistantCopyContent ? "group/turn" : ""}`}>
        <TurnItemSequence
          turn={turn}
          transcript={transcript}
          isTurnComplete={!!turn.completedAt}
          presentation={renderPresentation}
          forceExpandedCollapsedActionBlockId={liveExplorationBlock?.blockId ?? null}
          tailAssistantProseRootId={tailAssistantProseRootId}
          showCompletedArtifactFallback={row.isLastTurnRow}
          workspaceId={selectedWorkspaceId}
          onOpenArtifact={onOpenArtifact}
          onHandOffPlanToNewSession={onHandOffPlanToNewSession}
        />
        {row.isLastTurnRow && turn.completedAt && hasFileBadges && (
          <TurnDiffPanel
            turn={turn}
            transcript={transcript}
            onOpenFile={onOpenFile}
            onOpenReviewPane={onOpenTurnChanges}
          />
        )}
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
