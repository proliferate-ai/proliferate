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
import type { PromptPlanAttachmentDescriptor } from "#product/domain/chats/composer/prompt-plan-attachments";
import {
  collectTurnCoworkArtifactToolCalls,
} from "#product/domain/chats/tools/cowork-artifact-tool-presentation";
import {
  blockBelongsToCompletedHistory,
} from "#product/domain/chats/transcript/transcript-rendering";
import { formatWorkedForDuration } from "#product/domain/chats/transcript/transcript-work-duration";
import type {
  CompletedHistorySummary,
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
  showCompletedArtifactFallback,
  workspaceId,
  onOpenArtifact,
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
  onHandOffPlanToNewSession?: PlanHandoffHandler;
  /**
   * The workspace-creation receipt, when this row hosts it. Renders as the
   * first child inside the completed-history disclosure (collapsing with the
   * rest of the turn's work) when this row owns that disclosure. Otherwise it
   * renders at the position immediately before this row's first
   * non-user-message block (or after all blocks when every block so far is a
   * user message): inline, bare, while the turn is still streaming; once the
   * turn completes, the receipt IS a tool call, so that position instead
   * hosts a synthetic "Worked for Ns" disclosure containing only the receipt
   * — identical in appearance to a turn whose real history is one tool call
   * (see `hostsSynthesizedReceiptDisclosure`).
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

  // Workspace-creation receipt hosting: when this row owns the
  // completed-history disclosure, the receipt folds inside it (see
  // CompletedHistorySequence below) instead of rendering inline here.
  const hostsCompletedHistoryDisclosure = !!visiblePresentation.completedHistorySummary;
  const showInlineWorkspaceReceipt = !!workspaceReceipt && !hostsCompletedHistoryDisclosure;
  const inlineWorkspaceReceiptBlockKey = showInlineWorkspaceReceipt
    ? resolveLeadingNonUserMessageBlockKey(visiblePresentation, transcript)
    : null;
  const renderInlineWorkspaceReceiptAtEnd = showInlineWorkspaceReceipt
    && inlineWorkspaceReceiptBlockKey === null;
  // The receipt IS a tool call: a completed turn with no other history of its
  // own (no completedHistorySummary — e.g. prose-only) must still present as
  // a "Worked for Ns" disclosure, not a bare inline line. Streaming turns
  // (no completedAt yet) keep the plain inline rendering above; they get no
  // synthetic disclosure since the "Worked for" duration isn't final yet.
  const shouldSynthesizeReceiptDisclosure = hostsSynthesizedReceiptDisclosure({
    hasWorkspaceReceipt: showInlineWorkspaceReceipt,
    completedHistorySummary: visiblePresentation.completedHistorySummary,
    turnCompletedAt: turn.completedAt,
  });
  const animateReceiptDisclosure = useCompletedHistoryTransition(shouldSynthesizeReceiptDisclosure);
  const workspaceReceiptSlot = shouldSynthesizeReceiptDisclosure
    ? (
      <ToolCallSummary
        label={resolveCompletedHistoryDisclosureLabel(turn, completedHistoryLabel)}
        summary={formatCollapsedSummary({ messages: 0, toolCalls: 1, subagents: 0 })}
        showWorkDivider={tailAssistantProseRootId !== null}
        animateCompletion={animateReceiptDisclosure}
        borderless
        renderChildren={() => (
          <CompletedHistorySequence>{workspaceReceipt}</CompletedHistorySequence>
        )}
      />
    )
    : workspaceReceipt;

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

/**
 * Finds the block key of the first display block that is not a user-message
 * item — the position where an inline workspace-creation receipt should
 * render (immediately before it). Returns null when every block so far is a
 * user message (or there are no blocks yet), meaning the receipt should
 * render after all of them instead.
 */
export function resolveLeadingNonUserMessageBlockKey(
  presentation: TurnPresentation,
  transcript: TranscriptState,
): string | null {
  for (const block of presentation.displayBlocks) {
    if (block.kind === "item" && transcript.itemsById[block.itemId]?.kind === "user_message") {
      continue;
    }
    return getTurnDisplayBlockKey(block);
  }
  return null;
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

/**
 * Whether a workspace-creation receipt must be hosted inside a synthetic
 * "Worked for Ns" disclosure rather than rendered as a bare inline line. This
 * happens exactly when: the row hosts a receipt, the turn has no history of
 * its own to host the real completed-history disclosure, and the turn is
 * completed (so its "Worked for" duration is final). Exported so callers
 * that separately decide whether a real completed-history disclosure exists
 * for this turn (e.g. to avoid double-rendering a "Worked for"/stopped-notice
 * line) can account for the synthetic one too.
 */
export function hostsSynthesizedReceiptDisclosure({
  hasWorkspaceReceipt,
  completedHistorySummary,
  turnCompletedAt,
}: {
  hasWorkspaceReceipt: boolean;
  completedHistorySummary: CompletedHistorySummary | null;
  turnCompletedAt: string | null | undefined;
}): boolean {
  return hasWorkspaceReceipt && completedHistorySummary === null && !!turnCompletedAt;
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
