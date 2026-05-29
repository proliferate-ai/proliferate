import { useMemo } from "react";
import type {
  ToolCallItem,
  TranscriptState,
  TurnRecord,
} from "@anyharness/sdk";
import { ClipboardList } from "@proliferate/ui/icons";
import { CoworkArtifactTurnCard } from "@/components/workspace/chat/tool-calls/CoworkArtifactTurnCard";
import { ToolCallSummary } from "@/components/workspace/chat/tool-calls/ToolCallSummary";
import type { PromptPlanAttachmentDescriptor } from "@proliferate/product-domain/chats/composer/prompt-plan-attachments";
import {
  collectTurnCoworkArtifactToolCalls,
} from "@proliferate/product-domain/chats/tools/cowork-artifact-tool-presentation";
import {
  blockBelongsToCompletedHistory,
  collectToolCallIdsWithProposedPlanForBlocks,
} from "@proliferate/product-domain/chats/transcript/transcript-rendering";
import type { TurnPresentation } from "@proliferate/product-domain/chats/transcript/transcript-presentation";
import {
  getTurnDisplayBlockKey,
  TurnDisplayBlockNode,
} from "./ScopedTranscriptBlocks";
import { ProposedPlanToolCallIdsProvider } from "./ProposedPlanToolCallIdsContext";
import { TranscriptTreeNode } from "./TranscriptTreeNode";
import {
  buildCollapsedSummaryIcons,
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
  const toolCallIdsWithProposedPlan = useMemo(
    () => collectToolCallIdsWithProposedPlanForBlocks(
      presentation.displayBlocks,
      transcript,
      presentation.childrenByParentId,
    ),
    [presentation.childrenByParentId, presentation.displayBlocks, transcript],
  );
  let hasRenderedCompletedHistory = false;

  return (
    <ProposedPlanToolCallIdsProvider value={toolCallIdsWithProposedPlan}>
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
              icon={<ClipboardList />}
              label="Work history"
              summary={formatCollapsedSummary(presentation.completedHistorySummary)}
              typeIcons={buildCollapsedSummaryIcons(presentation.completedHistorySummary)}
              showFinalSeparator={tailAssistantProseRootId !== null}
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
                        renderItem={(itemId) => (
                          <FragmentWithArtifacts
                            itemId={itemId}
                            transcript={transcript}
                            childrenByParentId={presentation.childrenByParentId}
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
            renderItem={(itemId) => (
              <FragmentWithArtifacts
                itemId={itemId}
                transcript={transcript}
                childrenByParentId={presentation.childrenByParentId}
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
    </ProposedPlanToolCallIdsProvider>
  );
}

function FragmentWithArtifacts({
  itemId,
  transcript,
  childrenByParentId,
  artifactToolCalls,
  workspaceId,
  onOpenArtifact,
  onHandOffPlanToNewSession,
}: {
  itemId: string;
  transcript: TranscriptState;
  childrenByParentId: Map<string, string[]>;
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
