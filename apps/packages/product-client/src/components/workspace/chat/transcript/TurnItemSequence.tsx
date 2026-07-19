import type {
  ToolCallItem,
  TranscriptState,
  TurnRecord,
} from "@anyharness/sdk";
import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CoworkArtifactTurnCard } from "#product/components/workspace/chat/tool-calls/CoworkArtifactTurnCard";
import {
  ToolCallSummary,
  ToolCallWorkDivider,
} from "#product/components/workspace/chat/tool-calls/ToolCallSummary";
import type { PromptPlanAttachmentDescriptor } from "@proliferate/product-domain/chats/composer/prompt-plan-attachments";
import {
  collectTurnCoworkArtifactToolCalls,
} from "@proliferate/product-domain/chats/tools/cowork-artifact-tool-presentation";
import {
  blockBelongsToCompletedHistory,
} from "@proliferate/product-domain/chats/transcript/transcript-rendering";
import { formatWorkedForDuration } from "@proliferate/product-domain/chats/transcript/transcript-work-duration";
import type {
  TurnDisplayBlock,
  TurnPresentation,
} from "@proliferate/product-domain/chats/transcript/transcript-presentation";
import {
  getTurnDisplayBlockKey,
  TurnDisplayBlockNode,
} from "#product/components/workspace/chat/transcript/ScopedTranscriptBlocks";
import { TranscriptTreeNode } from "#product/components/workspace/chat/transcript/TranscriptTreeNode";
import {
  formatCollapsedSummary,
} from "#product/components/workspace/chat/transcript/TranscriptToolGroupUtils";
import { TURN_ITEM_GAP_CLASS } from "#product/components/workspace/chat/transcript/TranscriptTurnChrome";
import type { AssistantMessageRevealState } from "#product/components/workspace/chat/transcript/AssistantMessage";

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
  showCompletedArtifactFallback,
  workspaceId,
  onOpenTurnChanges,
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
  animateAssistantRevealItemId: string | null;
  onAssistantRevealStateChange?: (
    itemId: string,
    state: AssistantMessageRevealState,
  ) => void;
  showCompletedArtifactFallback: boolean;
  workspaceId: string | null;
  onOpenTurnChanges?: () => void;
  onOpenArtifact: (workspaceId: string, artifactId: string) => void;
  onHandOffPlanToNewSession?: PlanHandoffHandler;
}) {
  const visiblePresentation = constrainTurnItemSequencePresentation(
    presentation,
    animateAssistantRevealItemId,
  );
  const artifactToolCalls = collectTurnCoworkArtifactToolCalls(turn, transcript);
  const animateCompletedHistory = useCompletedHistoryTransition(
    isTurnComplete && visiblePresentation.completedHistorySummary !== null,
  );
  const completedArtifactToolCalls = isTurnComplete
    ? artifactToolCalls.filter((item) => item.status === "completed")
    : [];
  const completedHistoryRootIdSet = new Set(visiblePresentation.completedHistoryRootIds);
  const frontierBlockKey = resolveTurnItemFrontierBlockKey(visiblePresentation);
  const shouldRenderCompletedArtifacts = shouldRenderCompletedArtifactCards({
    completedArtifactCount: completedArtifactToolCalls.length,
    presentation: visiblePresentation,
    tailAssistantProseRootId,
    showCompletedArtifactFallback,
  });
  const frontierPrelude = shouldRenderCompletedArtifacts
    ? (
      <div className="contents" data-turn-frontier-prelude>
        <CompletedArtifactCards
          items={completedArtifactToolCalls}
          workspaceId={workspaceId}
          onOpenArtifact={onOpenArtifact}
        />
      </div>
    )
    : null;
  const completedHistoryOwnsPrelude = frontierPrelude !== null
    && visiblePresentation.completedHistorySummary !== null
    && tailAssistantProseRootId !== null;
  const standaloneFrontierPrelude = frontierPrelude && !completedHistoryOwnsPrelude
    ? (
      <div className="flex flex-col gap-4" data-turn-frontier-prelude-group>
        {frontierPrelude}
        {tailAssistantProseRootId !== null && <ToolCallWorkDivider />}
      </div>
    )
    : null;
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
              completionContent={completedHistoryOwnsPrelude ? frontierPrelude : null}
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
                        onOpenChanges={onOpenTurnChanges}
                        renderItem={(itemId) => (
                          <TranscriptFragment
                            itemId={itemId}
                            transcript={transcript}
                            childrenByParentId={visiblePresentation.childrenByParentId}
                            animateActivityEntry={false}
                            animateAssistantRevealItemId={null}
                            onAssistantRevealStateChange={onAssistantRevealStateChange}
                            workspaceId={workspaceId}
                            onOpenArtifact={onOpenArtifact}
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
              onOpenChanges={onOpenTurnChanges}
              renderItem={(itemId) => (
                <TranscriptFragment
                  itemId={itemId}
                  transcript={transcript}
                  childrenByParentId={visiblePresentation.childrenByParentId}
                  animateActivityEntry={animateActivityEntry}
                  animateAssistantRevealItemId={animateAssistantRevealItemId}
                  onAssistantRevealStateChange={onAssistantRevealStateChange}
                  workspaceId={workspaceId}
                  onOpenArtifact={onOpenArtifact}
                  onHandOffPlanToNewSession={onHandOffPlanToNewSession}
                />
              )}
            />
          );
        }

        return (
          <Fragment key={blockKey}>
            {blockKey === frontierBlockKey ? standaloneFrontierPrelude : null}
            {renderedBlock}
          </Fragment>
        );
      })}
      {frontierBlockKey === null ? standaloneFrontierPrelude : null}
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

export function shouldRenderCompletedArtifactCards({
  completedArtifactCount,
  presentation,
  tailAssistantProseRootId,
  showCompletedArtifactFallback,
}: {
  completedArtifactCount: number;
  presentation: TurnPresentation;
  tailAssistantProseRootId: string | null;
  showCompletedArtifactFallback: boolean;
}): boolean {
  if (completedArtifactCount <= 0) {
    return false;
  }
  if (tailAssistantProseRootId === null) {
    return showCompletedArtifactFallback;
  }
  return presentation.displayBlocks.some(
    (block) => block.kind === "item" && block.itemId === tailAssistantProseRootId,
  );
}

export function resolveTurnItemFrontierBlockKey(
  presentation: TurnPresentation,
): string | null {
  const completedHistoryRootIdSet = new Set(presentation.completedHistoryRootIds);
  let completedHistoryAdded = false;
  let frontierBlock: TurnDisplayBlock | null = null;

  for (const block of presentation.displayBlocks) {
    if (
      presentation.completedHistorySummary
      && blockBelongsToCompletedHistory(block, completedHistoryRootIdSet)
    ) {
      if (completedHistoryAdded) {
        continue;
      }
      completedHistoryAdded = true;
    }
    frontierBlock = block;
  }

  return frontierBlock ? getTurnDisplayBlockKey(frontierBlock) : null;
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
  onOpenArtifact,
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
        animateAssistantReveal={itemId === animateAssistantRevealItemId}
        onAssistantRevealStateChange={onAssistantRevealStateChange}
        workspaceId={workspaceId}
        onOpenArtifact={onOpenArtifact}
        onHandOffPlanToNewSession={onHandOffPlanToNewSession}
      />
    </>
  );
}

function CompletedArtifactCards({
  items,
  workspaceId,
  onOpenArtifact,
}: {
  items: readonly ToolCallItem[];
  workspaceId: string | null;
  onOpenArtifact: (workspaceId: string, artifactId: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      {items.map((item) => (
        <CoworkArtifactTurnCard
          key={`turn-artifact-${item.itemId}`}
          item={item}
          onOpenArtifact={
            workspaceId ? (artifactId) => onOpenArtifact(workspaceId, artifactId) : undefined
          }
        />
      ))}
    </div>
  );
}
