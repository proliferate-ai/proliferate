import type {
  ToolCallItem,
  TranscriptState,
  TurnRecord,
} from "@anyharness/sdk";
import { Fragment, type ReactNode } from "react";
import { CoworkArtifactTurnCard } from "@/components/workspace/chat/tool-calls/CoworkArtifactTurnCard";
import {
  ToolCallSummary,
  ToolCallWorkDivider,
} from "@/components/workspace/chat/tool-calls/ToolCallSummary";
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
} from "./ScopedTranscriptBlocks";
import { TranscriptTreeNode } from "./TranscriptTreeNode";
import {
  formatCollapsedSummary,
} from "./TranscriptToolGroupUtils";
import { TURN_ITEM_GAP_CLASS } from "./TranscriptTurnChrome";

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
  beforeFrontier = null,
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
  /** Completion-only UI that must grow above, never below, the final frontier. */
  beforeFrontier?: ReactNode;
}) {
  const artifactToolCalls = collectTurnCoworkArtifactToolCalls(turn, transcript);
  const completedArtifactToolCalls = isTurnComplete
    ? artifactToolCalls.filter((item) => item.status === "completed")
    : [];
  const completedHistoryRootIdSet = new Set(presentation.completedHistoryRootIds);
  const frontierBlockKey = resolveTurnItemFrontierBlockKey(presentation);
  const shouldRenderCompletedArtifacts = shouldRenderCompletedArtifactCards({
    completedArtifactCount: completedArtifactToolCalls.length,
    presentation,
    tailAssistantProseRootId,
    showCompletedArtifactFallback,
  });
  const frontierPrelude = beforeFrontier || shouldRenderCompletedArtifacts
    ? (
      <div className="contents" data-turn-frontier-prelude>
        {shouldRenderCompletedArtifacts && (
          <CompletedArtifactCards
            items={completedArtifactToolCalls}
            workspaceId={workspaceId}
            onOpenArtifact={onOpenArtifact}
          />
        )}
        {beforeFrontier}
      </div>
    )
    : null;
  const completedHistoryOwnsPrelude = frontierPrelude !== null
    && presentation.completedHistorySummary !== null
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
      {presentation.displayBlocks.map((block) => {
        const blockKey = getTurnDisplayBlockKey(block);
        let renderedBlock: ReactNode;
        if (
          presentation.completedHistorySummary
          && blockBelongsToCompletedHistory(block, completedHistoryRootIdSet)
        ) {
          if (hasRenderedCompletedHistory) {
            return null;
          }
          hasRenderedCompletedHistory = true;
          renderedBlock = (
            <ToolCallSummary
              label={resolveCompletedHistoryDisclosureLabel(turn, completedHistoryLabel)}
              summary={formatCollapsedSummary(presentation.completedHistorySummary)}
              showWorkDivider={tailAssistantProseRootId !== null}
              completionContent={completedHistoryOwnsPrelude ? frontierPrelude : null}
              renderChildren={() => (
                <CompletedHistorySequence>
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
                          <TranscriptFragment
                            itemId={itemId}
                            transcript={transcript}
                            childrenByParentId={presentation.childrenByParentId}
                            animateActivityEntry={false}
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
                  childrenByParentId={presentation.childrenByParentId}
                  animateActivityEntry={animateActivityEntry}
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
  workspaceId,
  onOpenArtifact,
  onHandOffPlanToNewSession,
}: {
  itemId: string;
  transcript: TranscriptState;
  childrenByParentId: Map<string, string[]>;
  animateActivityEntry: boolean;
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
