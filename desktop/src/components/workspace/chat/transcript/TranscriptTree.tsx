import { useMemo } from "react";
import type {
  ToolCallItem,
  TranscriptItem,
  TranscriptState,
  TurnRecord,
} from "@anyharness/sdk";
import { AssistantMessage } from "./AssistantMessage";
import { ClaudePlanCard } from "./ClaudePlanCard";
import { ConnectedProposedPlanItem } from "./ConnectedProposedPlanItem";
import { SystemMessage } from "./SystemMessage";
import { UserMessage } from "./UserMessage";
import { ReviewFeedbackSummary } from "@/components/workspace/reviews/ReviewFeedbackSummary";
import { ReasoningBlock } from "@/components/workspace/chat/tool-calls/ReasoningBlock";
import { CoworkArtifactTurnCard } from "@/components/workspace/chat/tool-calls/CoworkArtifactTurnCard";
import { ToolCallSummary } from "@/components/workspace/chat/tool-calls/ToolCallSummary";
import {
  ClipboardList,
} from "@/components/ui/icons";
import {
  extractClaudePlanBody,
  isClaudeExitPlanModeCall,
} from "@/lib/domain/chat/tools/claude-plan-tool-call";
import {
  collectTurnCoworkArtifactToolCalls,
} from "@/lib/domain/chat/tools/cowork-artifact-tool-presentation";
import {
  blockBelongsToCompletedHistory,
  collectToolCallIdsWithProposedPlanForBlocks,
} from "@/lib/domain/chat/transcript/transcript-rendering";
import {
  isAgentSessionProvenance,
  resolveReviewFeedbackPromptReference,
  isSubagentWakeProvenance,
} from "@/lib/domain/chat/subagents/provenance";
import {
  getTurnDisplayBlockKey,
  TurnDisplayBlockNode,
} from "@/components/workspace/chat/transcript/ScopedTranscriptBlocks";
import {
  buildCollapsedSummaryIcons,
  formatCollapsedSummary,
  isSubagentItem,
} from "./TranscriptToolGroupUtils";
import { SubagentWakeBadge } from "./SubagentWakeBadge";
import { SessionErrorItem } from "./SessionErrorItem";
import { UserMessageProvenanceChrome } from "./UserMessageProvenanceChrome";
import { TranscriptToolCallGroupBlock } from "./TranscriptToolCallGroupBlock";
import { TranscriptToolCallItemBlock } from "./TranscriptToolCallItemBlock";
import { ProposedPlanToolCallIdsProvider, useProposedPlanToolCallIds } from "./ProposedPlanToolCallIdsContext";
import {
  useTranscriptCanOpenSession,
  useTranscriptOpenSession,
  useTranscriptSessionId,
} from "./TranscriptContexts";
import type { TranscriptOpenSessionRole } from "@/lib/domain/chat/transcript/transcript-open-target";
import type { TurnPresentation } from "@/lib/domain/chat/transcript/transcript-presentation";
import {
  resolveUserMessageActionTime,
} from "@/lib/domain/chat/transcript/transcript-action-time";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import type { PromptPlanAttachmentDescriptor } from "@/lib/domain/chat/composer/prompt-content";

type PlanHandoffHandler = (plan: PromptPlanAttachmentDescriptor) => void;

export function TurnItemSequence({
  turn,
  transcript,
  isTurnComplete,
  presentation,
  forceExpandedCollapsedActionBlockId,
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
  forceExpandedCollapsedActionBlockId?: string | null;
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
                        forceExpandedCollapsedActionBlockId={null}
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
            forceExpandedCollapsedActionBlockId={forceExpandedCollapsedActionBlockId}
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

function TranscriptItemBlock({
  item,
  transcript,
  workspaceId,
  onOpenArtifact,
  onHandOffPlanToNewSession,
}: {
  item: TranscriptItem;
  transcript: TranscriptState;
  workspaceId: string | null;
  onOpenArtifact: (workspaceId: string, artifactId: string) => void;
  onHandOffPlanToNewSession?: PlanHandoffHandler;
}) {
  const toolCallIdsWithProposedPlan = useProposedPlanToolCallIds();
  const sessionId = useTranscriptSessionId();
  const openSession = useTranscriptOpenSession();
  const canOpenSession = useTranscriptCanOpenSession();
  const recordRelationshipHint = useSessionDirectoryStore((state) => state.recordRelationshipHint);

  switch (item.kind) {
    case "user_message": {
      if (isSubagentWakeProvenance(item.promptProvenance)) {
        const wakeProvenance = item.promptProvenance;
        const completion =
          transcript.linkCompletionsByCompletionId[wakeProvenance.completionId] ?? null;
        const childRole: TranscriptOpenSessionRole =
          wakeProvenance.type === "linkWake"
          && wakeProvenance.relation === "cowork_coding_session"
            ? "cowork-coding-child"
            : "linked-child";
        const childSessionId = completion?.childSessionId ?? null;
        const canOpenChild = !!openSession
          && !!childSessionId
          && (canOpenSession?.(childSessionId, childRole) ?? true);
        return (
          <div className="flex justify-end">
            <SubagentWakeBadge
              label={wakeProvenance.label ?? completion?.label ?? null}
              childSessionId={childSessionId}
              outcome={completion?.outcome ?? null}
              titleFallback={
                wakeProvenance.type === "linkWake"
                && wakeProvenance.relation === "cowork_coding_session"
                  ? "Coding session"
                  : "Subagent"
              }
              onOpenChild={canOpenChild
                ? (targetSessionId) => {
                  recordRelationshipHint(targetSessionId, {
                    kind: wakeProvenance.type === "subagentWake"
                      ? "subagent_child"
                      : childRole === "cowork-coding-child"
                        ? "cowork_child"
                        : "linked_child",
                    parentSessionId: sessionId,
                    sessionLinkId: wakeProvenance.sessionLinkId,
                    relation: wakeProvenance.type === "linkWake"
                      ? wakeProvenance.relation
                      : "subagent",
                    workspaceId,
                  });
                  openSession(targetSessionId, childRole);
                }
                : undefined}
            />
          </div>
        );
      }

      const reviewFeedbackReference = resolveReviewFeedbackPromptReference(
        item.promptProvenance,
        item.text,
      );
      if (reviewFeedbackReference) {
        return (
          <ReviewFeedbackSummary
            reference={reviewFeedbackReference}
            sessionId={sessionId}
          />
        );
      }

      if (isAgentSessionProvenance(item.promptProvenance)) {
        const sourceSessionId = item.promptProvenance.sourceSessionId;
        const canOpenParent = !!openSession
          && (canOpenSession?.(sourceSessionId, "agent-parent") ?? true);
        return (
          <UserMessage
            sessionId={sessionId}
            content={item.text}
            contentParts={item.contentParts}
            showCopyButton
            timestampLabel={resolveUserMessageActionTime(item)}
            footer={(
              <UserMessageProvenanceChrome
                sourceSessionId={sourceSessionId}
                label={item.promptProvenance.label ?? null}
                onOpenParent={canOpenParent
                  ? (parentSessionId) => openSession(parentSessionId, "agent-parent")
                  : undefined}
              />
            )}
          />
        );
      }

      return (
        <UserMessage
          sessionId={sessionId}
          content={item.text}
          contentParts={item.contentParts}
          showCopyButton
          timestampLabel={resolveUserMessageActionTime(item)}
        />
      );
    }

    case "assistant_prose": {
      if (!item.text) return null;

      return (
        <div className="flex justify-start relative">
          <div className="flex flex-col w-full min-w-0 max-w-full break-words">
            <AssistantMessage
              content={item.text}
              isStreaming={item.isStreaming}
            />
          </div>
        </div>
      );
    }

    case "thought":
      return (
        <div className="flex justify-start relative">
          <div className="flex flex-col w-full max-w-full space-y-1 break-words">
            <ReasoningBlock content={item.text || undefined} />
          </div>
        </div>
      );

    case "tool_call": {
      if (isClaudeExitPlanModeCall(item)) {
        if (hasProposedPlanForToolCall(toolCallIdsWithProposedPlan, item.toolCallId)) {
          return null;
        }
        const body = extractClaudePlanBody(item) ?? "";
        return (
          <div className="flex justify-start relative">
            <div className="flex flex-col w-full max-w-full space-y-1 break-words">
              <ClaudePlanCard
                content={body}
                isStreaming={item.status === "in_progress"}
              />
            </div>
          </div>
        );
      }
      return (
        <div className="flex justify-start relative">
          <div className="flex flex-col w-full max-w-full space-y-1 break-words">
            <TranscriptToolCallItemBlock
              item={item}
              workspaceId={workspaceId}
              onOpenArtifact={onOpenArtifact}
            />
          </div>
        </div>
      );
    }

    case "plan":
      return null;

    case "proposed_plan": {
      return (
        <ConnectedProposedPlanItem
          item={item}
          onHandOffToNewSession={onHandOffPlanToNewSession ?? undefined}
        />
      );
    }

    case "error":
      return (
        <SessionErrorItem item={item} sessionId={sessionId} />
      );

    case "unknown":
      return (
        <SystemMessage content={`Unknown event: ${item.eventType}`} />
      );

    default:
      return null;
  }
}

function hasProposedPlanForToolCall(
  toolCallIdsWithProposedPlan: ReadonlySet<string>,
  toolCallId: string | null,
): boolean {
  if (!toolCallId) {
    return false;
  }
  return toolCallIdsWithProposedPlan.has(toolCallId);
}

function TranscriptTreeNode({
  itemId,
  transcript,
  childrenByParentId,
  workspaceId,
  onOpenArtifact,
  onHandOffPlanToNewSession,
}: {
  itemId: string;
  transcript: TranscriptState;
  childrenByParentId: Map<string, string[]>;
  workspaceId: string | null;
  onOpenArtifact: (workspaceId: string, artifactId: string) => void;
  onHandOffPlanToNewSession?: PlanHandoffHandler;
}) {
  const item = transcript.itemsById[itemId];
  if (!item) return null;

  const childIds = childrenByParentId.get(itemId) ?? [];
  if (item.kind === "tool_call" && (childIds.length > 0 || isSubagentItem(item))) {
    return (
      <TranscriptToolCallGroupBlock
        item={item}
        childIds={childIds}
        transcript={transcript}
        childrenByParentId={childrenByParentId}
        workspaceId={workspaceId}
        onOpenArtifact={onOpenArtifact}
        renderChild={(childId) => (
          <TranscriptTreeNode
            itemId={childId}
            transcript={transcript}
            childrenByParentId={childrenByParentId}
            workspaceId={workspaceId}
            onOpenArtifact={onOpenArtifact}
            onHandOffPlanToNewSession={onHandOffPlanToNewSession}
          />
        )}
      />
    );
  }

  return (
    <TranscriptItemBlock
      item={item}
      transcript={transcript}
      workspaceId={workspaceId}
      onOpenArtifact={onOpenArtifact}
      onHandOffPlanToNewSession={onHandOffPlanToNewSession}
    />
  );
}

export type { TurnPresentation };
