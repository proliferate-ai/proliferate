import type {
  TranscriptItem,
  TranscriptState,
} from "@anyharness/sdk";
import { ReviewFeedbackSummary } from "@/components/workspace/reviews/ReviewFeedbackSummary";
import { ReasoningBlock } from "@/components/workspace/chat/tool-calls/ReasoningBlock";
import type { PromptPlanAttachmentDescriptor } from "@/lib/domain/chat/composer/prompt-plan-attachments";
import {
  extractClaudePlanBody,
  isClaudeExitPlanModeCall,
} from "@/lib/domain/chat/tools/claude-plan-tool-call";
import {
  isAgentSessionProvenance,
  isSubagentWakeProvenance,
  resolveReviewFeedbackPromptReference,
} from "@/lib/domain/chat/subagents/provenance";
import {
  resolveUserMessageActionTime,
} from "@/lib/domain/chat/transcript/transcript-action-time";
import type { TranscriptOpenSessionRole } from "@/lib/domain/chat/transcript/transcript-open-target";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { AssistantMessage } from "./AssistantMessage";
import { ClaudePlanCard } from "./ClaudePlanCard";
import { ConnectedProposedPlanItem } from "./ConnectedProposedPlanItem";
import { SessionErrorItem } from "./SessionErrorItem";
import { SubagentWakeBadge } from "./SubagentWakeBadge";
import { SystemMessage } from "./SystemMessage";
import { TranscriptToolCallItemBlock } from "./TranscriptToolCallItemBlock";
import { UserMessage } from "./UserMessage";
import { UserMessageProvenanceChrome } from "./UserMessageProvenanceChrome";
import { useProposedPlanToolCallIds } from "./ProposedPlanToolCallIdsContext";
import {
  useTranscriptCanOpenSession,
  useTranscriptOpenSession,
  useTranscriptSessionId,
} from "./TranscriptContexts";

type PlanHandoffHandler = (plan: PromptPlanAttachmentDescriptor) => void;

export function TranscriptItemBlock({
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
              sessionLinkId={wakeProvenance.sessionLinkId}
              outcome={completion?.outcome ?? null}
              titleFallback={
                wakeProvenance.type === "linkWake"
                && wakeProvenance.relation === "cowork_coding_session"
                  ? "Coding session"
                  : "Subagent"
              }
              originKind={childRole === "cowork-coding-child" ? "cowork" : "subagent"}
              parentTitle={transcript.sessionMeta.title}
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
        const canOpenReviewSession = (reviewerSessionId: string) =>
          !!openSession && (canOpenSession?.(reviewerSessionId, "linked-child") ?? true);
        return (
          <ReviewFeedbackSummary
            reference={reviewFeedbackReference}
            sessionId={sessionId}
            onOpenReviewerSession={openSession
              ? (reviewerSessionId) => {
                if (canOpenReviewSession(reviewerSessionId)) {
                  openSession(reviewerSessionId, "linked-child");
                }
              }
              : undefined}
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
