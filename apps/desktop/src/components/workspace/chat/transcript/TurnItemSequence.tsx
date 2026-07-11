import type {
  ToolCallItem,
  TranscriptState,
  TurnRecord,
} from "@anyharness/sdk";
import { CoworkArtifactTurnCard } from "@/components/workspace/chat/tool-calls/CoworkArtifactTurnCard";
import { ToolCallSummary } from "@/components/workspace/chat/tool-calls/ToolCallSummary";
import type { PromptPlanAttachmentDescriptor } from "@proliferate/product-domain/chats/composer/prompt-plan-attachments";
import {
  collectTurnCoworkArtifactToolCalls,
} from "@proliferate/product-domain/chats/tools/cowork-artifact-tool-presentation";
import {
  blockBelongsToCompletedHistory,
} from "@proliferate/product-domain/chats/transcript/transcript-rendering";
import { formatWorkedForDuration } from "@proliferate/product-domain/chats/transcript/transcript-work-duration";
import type { TurnPresentation } from "@proliferate/product-domain/chats/transcript/transcript-presentation";
import {
  getTurnDisplayBlockKey,
  TurnDisplayBlockNode,
} from "./ScopedTranscriptBlocks";
import { TranscriptTreeNode } from "./TranscriptTreeNode";
import {
  formatCollapsedSummary,
} from "./TranscriptToolGroupUtils";

type PlanHandoffHandler = (plan: PromptPlanAttachmentDescriptor) => void;

export function TurnItemSequence({
  turn,
  transcript,
  isTurnComplete,
  presentation,
  autoFollowCollapsedActionBlockId,
  tailAssistantProseRootId,
  completedHistoryLabel,
  animateActivityEntry,
  showCompletedArtifactFallback,
  workspaceId,
  onOpenArtifact,
  onHandOffPlanToNewSession,
}: {
  turn: TurnRecord;
  transcript: TranscriptState;
  isTurnComplete: boolean;
  presentation: TurnPresentation;
  autoFollowCollapsedActionBlockId?: string | null;
  tailAssistantProseRootId: string | null;
  completedHistoryLabel?: string | null;
  animateActivityEntry: boolean;
  showCompletedArtifactFallback: boolean;
  workspaceId: string | null;
  onOpenArtifact: (workspaceId: string, artifactId: string) => void;
  onHandOffPlanToNewSession?: PlanHandoffHandler;
}) {
  const artifactToolCalls = collectTurnCoworkArtifactToolCalls(turn, transcript);
  const completedArtifactToolCalls = isTurnComplete
    ? artifactToolCalls.filter((item) => item.status === "completed")
    : [];
  const completedHistoryRootIdSet = new Set(presentation.completedHistoryRootIds);
  // The ExitPlanMode suppression index is derived transcript-wide once (see
  // MessageList → ProposedPlanToolCallIdsProvider) so a proposed_plan landing in
  // a different turn than its ExitPlanMode tool call still suppresses the
  // footerless fallback card. This sequence only consumes that index.
  let hasRenderedCompletedHistory = false;

  return (
    <>
      {presentation.displayBlocks.map((block) => {
        if (
          presentation.completedHistorySummary
          && blockBelongsToCompletedHistory(block, completedHistoryRootIdSet)
        ) {
          if (hasRenderedCompletedHistory) {
            return null;
          }
          hasRenderedCompletedHistory = true;
          return (
            <ToolCallSummary
              key={`${turn.turnId}-completed-history`}
              label={resolveCompletedHistoryDisclosureLabel(turn, completedHistoryLabel)}
              summary={formatCollapsedSummary(presentation.completedHistorySummary)}
              showWorkDivider={tailAssistantProseRootId !== null}
              renderChildren={() => (
                <div className="space-y-1">
                  {presentation.displayBlocks
                    .filter((historyBlock) =>
                      blockBelongsToCompletedHistory(historyBlock, completedHistoryRootIdSet)
                    )
                    .map((historyBlock) => (
                      <TurnDisplayBlockNode
                        key={`history-${getTurnDisplayBlockKey(historyBlock)}`}
                        block={historyBlock}
                        transcript={transcript}
                        autoFollowCollapsedActionBlockId={null}
                        animateActivityEntry={false}
                        renderItem={(itemId) => (
                          <FragmentWithArtifacts
                            itemId={itemId}
                            transcript={transcript}
                            childrenByParentId={presentation.childrenByParentId}
                            animateActivityEntry={false}
                            artifactToolCalls={null}
                            workspaceId={workspaceId}
                            onOpenArtifact={onOpenArtifact}
                            onHandOffPlanToNewSession={onHandOffPlanToNewSession}
                          />
                        )}
                      />
                    ))}
                </div>
              )}
            />
          );
        }

        return (
          <TurnDisplayBlockNode
            key={getTurnDisplayBlockKey(block)}
            block={block}
            transcript={transcript}
            autoFollowCollapsedActionBlockId={autoFollowCollapsedActionBlockId}
            animateActivityEntry={animateActivityEntry}
            renderItem={(itemId) => (
              <FragmentWithArtifacts
                itemId={itemId}
                transcript={transcript}
                childrenByParentId={presentation.childrenByParentId}
                animateActivityEntry={animateActivityEntry}
                artifactToolCalls={
                  itemId === tailAssistantProseRootId ? completedArtifactToolCalls : null
                }
                workspaceId={workspaceId}
                onOpenArtifact={onOpenArtifact}
                onHandOffPlanToNewSession={onHandOffPlanToNewSession}
              />
            )}
          />
        );
      })}
      {showCompletedArtifactFallback && tailAssistantProseRootId === null && completedArtifactToolCalls.length > 0 && (
        <div className="space-y-1.5">
          {completedArtifactToolCalls.map((item) => (
            <CoworkArtifactTurnCard
              key={`turn-artifact-${item.itemId}`}
              item={item}
              onOpenArtifact={
                workspaceId ? (artifactId) => onOpenArtifact(workspaceId, artifactId) : undefined
              }
            />
          ))}
        </div>
      )}
    </>
  );
}

export function resolveCompletedHistoryDisclosureLabel(
  turn: Pick<TurnRecord, "startedAt" | "completedAt">,
  override: string | null | undefined,
): string {
  return override
    ?? formatWorkedForDuration(turn.startedAt, turn.completedAt)
    ?? "Worked";
}

function FragmentWithArtifacts({
  itemId,
  transcript,
  childrenByParentId,
  animateActivityEntry,
  artifactToolCalls,
  workspaceId,
  onOpenArtifact,
  onHandOffPlanToNewSession,
}: {
  itemId: string;
  transcript: TranscriptState;
  childrenByParentId: Map<string, string[]>;
  animateActivityEntry: boolean;
  artifactToolCalls: ToolCallItem[] | null;
  workspaceId: string | null;
  onOpenArtifact: (workspaceId: string, artifactId: string) => void;
  onHandOffPlanToNewSession?: PlanHandoffHandler;
}) {
  return (
    <>
      <TranscriptTreeNode
        itemId={itemId}
        transcript={transcript}
        childrenByParentId={childrenByParentId}
        animateActivityEntry={animateActivityEntry}
        workspaceId={workspaceId}
        onOpenArtifact={onOpenArtifact}
        onHandOffPlanToNewSession={onHandOffPlanToNewSession}
      />
      {artifactToolCalls && artifactToolCalls.length > 0 && (
        <div className="space-y-1.5">
          {artifactToolCalls.map((item) => (
            <CoworkArtifactTurnCard
              key={`artifact-inline-${item.itemId}`}
              item={item}
              onOpenArtifact={
                workspaceId ? (artifactId) => onOpenArtifact(workspaceId, artifactId) : undefined
              }
            />
          ))}
        </div>
      )}
    </>
  );
}
