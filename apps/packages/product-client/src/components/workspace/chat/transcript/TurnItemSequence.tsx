import type {
  ToolCallItem,
  TranscriptState,
  TurnRecord,
} from "@anyharness/sdk";
import { Fragment, type ReactNode } from "react";
import { CoworkArtifactTurnCard } from "#product/components/workspace/chat/tool-calls/CoworkArtifactTurnCard";
import {
  ToolCallSummary,
  ToolCallWorkDivider,
} from "#product/components/workspace/chat/tool-calls/ToolCallSummary";
import type { PromptPlanAttachmentDescriptor } from "#product/domain/chats/composer/prompt-plan-attachments";
import {
  collectTurnCoworkArtifactToolCalls,
} from "#product/domain/chats/tools/cowork-artifact-tool-presentation";
import {
  blockBelongsToCompletedHistory,
} from "#product/domain/chats/transcript/transcript-rendering";
import type {
  TurnDisplayBlock,
  TurnPresentation,
} from "#product/domain/chats/transcript/transcript-presentation";
import {
  getTurnDisplayBlockKey,
  TurnDisplayBlockNode,
} from "#product/components/workspace/chat/transcript/ScopedTranscriptBlocks";
import { TranscriptTreeNode } from "#product/components/workspace/chat/transcript/TranscriptTreeNode";
import {
  formatCollapsedSummary,
} from "#product/components/workspace/chat/transcript/TranscriptToolGroupUtils";
import {
  CompletedHistorySequence,
  resolveCompletedHistoryDisclosureLabel,
  TURN_ITEM_GAP_CLASS,
  useCompletedHistoryTransition,
} from "#product/components/workspace/chat/transcript/TranscriptTurnChrome";
import { useTurnWorkspaceReceiptSlot } from "#product/components/workspace/chat/transcript/TurnWorkspaceReceiptSlot";
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
  showCompletedArtifactFallback,
  workspaceId,
  onOpenArtifact,
  onOpenSubagent,
  onOpenBackgroundTerminal,
  onHandOffPlanToNewSession,
  workspaceReceipt = null,
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
  onOpenArtifact: (workspaceId: string, artifactId: string) => void;
  onOpenSubagent?: (subagentId: string) => void;
  onOpenBackgroundTerminal?: (processId: string) => void;
  onHandOffPlanToNewSession?: PlanHandoffHandler;
  /**
   * The workspace-creation receipt, when this row hosts it. Renders as the
   * first child inside the completed-history disclosure when this row owns
   * one; otherwise see TurnWorkspaceReceiptSlot for its standalone position.
   */
  workspaceReceipt?: ReactNode;
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
      <div className={`flex flex-col ${TURN_ITEM_GAP_CLASS}`} data-turn-frontier-prelude-group>
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

  // Workspace-creation receipt hosting: folds into the completed-history
  // disclosure below when this row owns one; see TurnWorkspaceReceiptSlot
  // for its standalone position/disclosure logic otherwise.
  const {
    inlineWorkspaceReceiptBlockKey,
    renderInlineWorkspaceReceiptAtEnd,
    workspaceReceiptSlot,
  } = useTurnWorkspaceReceiptSlot({
    workspaceReceipt,
    presentation: visiblePresentation,
    transcript,
    turn,
    completedHistoryLabel,
    tailAssistantProseRootId,
  });

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
                  {workspaceReceipt}
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
                        onOpenBackgroundTerminal={onOpenBackgroundTerminal}
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
                            onOpenSubagent={onOpenSubagent}
                            onOpenBackgroundTerminal={onOpenBackgroundTerminal}
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
              onOpenBackgroundTerminal={onOpenBackgroundTerminal}
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
                  onOpenSubagent={onOpenSubagent}
                  onOpenBackgroundTerminal={onOpenBackgroundTerminal}
                  onHandOffPlanToNewSession={onHandOffPlanToNewSession}
                />
              )}
            />
          );
        }

        return (
          <Fragment key={blockKey}>
            {blockKey === inlineWorkspaceReceiptBlockKey ? workspaceReceiptSlot : null}
            {blockKey === frontierBlockKey ? standaloneFrontierPrelude : null}
            {renderedBlock}
          </Fragment>
        );
      })}
      {frontierBlockKey === null ? standaloneFrontierPrelude : null}
      {renderInlineWorkspaceReceiptAtEnd ? workspaceReceiptSlot : null}
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

function TranscriptFragment({
  itemId,
  transcript,
  childrenByParentId,
  animateActivityEntry,
  animateAssistantRevealItemId,
  onAssistantRevealStateChange,
  workspaceId,
  onOpenArtifact,
  onOpenSubagent,
  onOpenBackgroundTerminal,
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
  onOpenSubagent?: (subagentId: string) => void;
  onOpenBackgroundTerminal?: (processId: string) => void;
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
        onOpenSubagent={onOpenSubagent}
        onOpenBackgroundTerminal={onOpenBackgroundTerminal}
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
    <div className="space-y-1">
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
