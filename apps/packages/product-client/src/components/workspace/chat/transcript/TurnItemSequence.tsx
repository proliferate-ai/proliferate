import type {
  TranscriptState,
  TurnRecord,
} from "@anyharness/sdk";
import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ToolCallSummary } from "#product/components/workspace/chat/tool-calls/ToolCallSummary";
import type { PromptPlanAttachmentDescriptor } from "#product/domain/chats/composer/prompt-plan-attachments";
import {
  blockBelongsToCompletedHistory,
} from "#product/domain/chats/transcript/transcript-rendering";
import { formatWorkedForDuration } from "#product/domain/chats/transcript/transcript-work-duration";
import type { TurnPresentation } from "#product/domain/chats/transcript/transcript-presentation";
import {
  getTurnDisplayBlockKey,
  TurnDisplayBlockNode,
} from "#product/components/workspace/chat/transcript/ScopedTranscriptBlocks";
import { TranscriptTreeNode } from "#product/components/workspace/chat/transcript/TranscriptTreeNode";
import {
  formatCollapsedSummary,
} from "#product/components/workspace/chat/transcript/TranscriptToolGroupUtils";
import { TURN_ITEM_GAP_CLASS } from "#product/components/workspace/chat/transcript/TranscriptTurnChrome";
import type { AssistantMessageRevealState } from "#product/lib/domain/chat/transcript/assistant-message-reveal";

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
  animateAssistantRevealItemId,
  onAssistantRevealStateChange,
  workspaceId,
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
  animateAssistantRevealItemId: string | null;
  onAssistantRevealStateChange?: (
    itemId: string,
    state: AssistantMessageRevealState,
  ) => void;
  workspaceId: string | null;
  onHandOffPlanToNewSession?: PlanHandoffHandler;
}) {
  const visiblePresentation = constrainTurnItemSequencePresentation(
    presentation,
    animateAssistantRevealItemId,
  );
  const animateCompletedHistory = useCompletedHistoryTransition(
    isTurnComplete && visiblePresentation.completedHistorySummary !== null,
  );
  const completedHistoryRootIdSet = new Set(visiblePresentation.completedHistoryRootIds);
  // The ExitPlanMode suppression index is derived transcript-wide once (see
  // MessageList → ProposedPlanToolCallIdsProvider) so a proposed_plan landing in
  // a different turn than its ExitPlanMode tool call still suppresses the
  // footerless fallback card. This sequence only consumes that index.
  let hasRenderedCompletedHistory = false;

  return (
    <>
      {visiblePresentation.displayBlocks.map((block) => {
        const blockKey = getTurnDisplayBlockKey(block);
        let renderedBlock: ReactNode;
        if (
          visiblePresentation.completedHistorySummary
          && blockBelongsToCompletedHistory(block, completedHistoryRootIdSet)
        ) {
          if (hasRenderedCompletedHistory) {
            return null;
          }
          hasRenderedCompletedHistory = true;
          renderedBlock = (
            <ToolCallSummary
              label={resolveCompletedHistoryDisclosureLabel(turn, completedHistoryLabel)}
              summary={formatCollapsedSummary(visiblePresentation.completedHistorySummary)}
              showWorkDivider={tailAssistantProseRootId !== null}
              animateCompletion={animateCompletedHistory}
              borderless
              renderChildren={() => (
                <CompletedHistorySequence>
                  {visiblePresentation.displayBlocks
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
                          <TranscriptFragment
                            itemId={itemId}
                            transcript={transcript}
                            childrenByParentId={visiblePresentation.childrenByParentId}
                            animateActivityEntry={false}
                            animateAssistantRevealItemId={null}
                            onAssistantRevealStateChange={onAssistantRevealStateChange}
                            workspaceId={workspaceId}
                            onHandOffPlanToNewSession={onHandOffPlanToNewSession}
                          />
                        )}
                      />
                    ))}
                </CompletedHistorySequence>
              )}
            />
          );
        } else {
          renderedBlock = (
            <TurnDisplayBlockNode
              block={block}
              transcript={transcript}
              autoFollowCollapsedActionBlockId={autoFollowCollapsedActionBlockId}
              animateActivityEntry={animateActivityEntry}
              renderItem={(itemId) => (
                <TranscriptFragment
                  itemId={itemId}
                  transcript={transcript}
                  childrenByParentId={visiblePresentation.childrenByParentId}
                  animateActivityEntry={animateActivityEntry}
                  animateAssistantRevealItemId={animateAssistantRevealItemId}
                  onAssistantRevealStateChange={onAssistantRevealStateChange}
                  workspaceId={workspaceId}
                  onHandOffPlanToNewSession={onHandOffPlanToNewSession}
                />
              )}
            />
          );
        }

        return (
          <Fragment key={blockKey}>
            {renderedBlock}
          </Fragment>
        );
      })}
    </>
  );
}

export function constrainTurnItemSequencePresentation(
  presentation: TurnPresentation,
  assistantRevealItemId: string | null,
): TurnPresentation {
  if (!assistantRevealItemId) {
    return presentation;
  }
  const frontierIndex = presentation.displayBlocks.findIndex(
    (block) => block.kind === "item" && block.itemId === assistantRevealItemId,
  );
  if (
    frontierIndex < 0
    || frontierIndex === presentation.displayBlocks.length - 1
  ) {
    return presentation;
  }
  return {
    ...presentation,
    displayBlocks: presentation.displayBlocks.slice(0, frontierIndex + 1),
  };
}

function useCompletedHistoryTransition(eligible: boolean): boolean {
  const wasEligibleRef = useRef(eligible);
  const [transitionClaimed, setTransitionClaimed] = useState(false);

  useLayoutEffect(() => {
    if (eligible && !wasEligibleRef.current) {
      setTransitionClaimed(true);
    }
    wasEligibleRef.current = eligible;
  }, [eligible]);

  return transitionClaimed;
}

export function CompletedHistorySequence({ children }: { children: ReactNode }) {
  return (
    <div
      data-completed-history-sequence
      className={`flex flex-col ${TURN_ITEM_GAP_CLASS}`}
    >
      {children}
    </div>
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

function TranscriptFragment({
  itemId,
  transcript,
  childrenByParentId,
  animateActivityEntry,
  animateAssistantRevealItemId,
  onAssistantRevealStateChange,
  workspaceId,
  onHandOffPlanToNewSession,
}: {
  itemId: string;
  transcript: TranscriptState;
  childrenByParentId: Map<string, string[]>;
  animateActivityEntry: boolean;
  animateAssistantRevealItemId: string | null;
  onAssistantRevealStateChange?: (
    itemId: string,
    state: AssistantMessageRevealState,
  ) => void;
  workspaceId: string | null;
  onHandOffPlanToNewSession?: PlanHandoffHandler;
}) {
  return (
    <>
      <TranscriptTreeNode
        itemId={itemId}
        transcript={transcript}
        childrenByParentId={childrenByParentId}
        animateActivityEntry={animateActivityEntry}
        animateAssistantReveal={itemId === animateAssistantRevealItemId}
        onAssistantRevealStateChange={onAssistantRevealStateChange}
        workspaceId={workspaceId}
        onHandOffPlanToNewSession={onHandOffPlanToNewSession}
      />
    </>
  );
}
