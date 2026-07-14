import type {
  TranscriptItem,
  TranscriptState,
} from "@anyharness/sdk";
import { ReasoningBlock } from "#product/components/workspace/chat/tool-calls/ReasoningBlock";
import type { PromptPlanAttachmentDescriptor } from "@proliferate/product-domain/chats/composer/prompt-plan-attachments";
import {
  extractClaudePlanBody,
  isClaudeExitPlanModeCall,
} from "@proliferate/product-domain/chats/tools/claude-plan-tool-call";
import { deriveModeSwitchDisplay } from "@proliferate/product-domain/chats/tools/mode-switch-display";
import {
  isAgentSessionProvenance,
  isSubagentWakeProvenance,
} from "@proliferate/product-domain/chats/subagents/provenance";
import {
  hasProposedPlanForToolCallItem,
} from "@proliferate/product-domain/chats/transcript/transcript-rendering";
import {
  resolveUserMessageActionTime,
} from "@proliferate/product-domain/chats/transcript/transcript-action-time";
import type { TranscriptOpenSessionRole } from "@proliferate/product-domain/chats/transcript/transcript-open-target";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { AssistantMessage } from "#product/components/workspace/chat/transcript/AssistantMessage";
import {
  renderTranscriptCodeBlock,
  renderTranscriptInlineCode,
  renderTranscriptLink,
} from "#product/components/workspace/chat/transcript/transcript-markdown";
import { ClaudePlanCard } from "#product/components/workspace/chat/transcript/ClaudePlanCard";
import { ModeTransitionDivider } from "#product/components/workspace/chat/transcript/ModeTransitionDivider";
import { ConnectedProposedPlanItem } from "#product/components/workspace/chat/transcript/ConnectedProposedPlanItem";
import { SessionErrorItem } from "#product/components/workspace/chat/transcript/SessionErrorItem";
import { SubagentWakeBadge } from "#product/components/workspace/chat/transcript/SubagentWakeBadge";
import { SystemMessage } from "#product/components/workspace/chat/transcript/SystemMessage";
import { TranscriptActivityBlock } from "#product/components/workspace/chat/transcript/TranscriptActivityBlock";
import { TranscriptToolCallItemBlock } from "#product/components/workspace/chat/transcript/TranscriptToolCallItemBlock";
import { UserMessage } from "#product/components/workspace/chat/transcript/UserMessage";
import { UserMessageProvenanceChrome } from "#product/components/workspace/chat/transcript/UserMessageProvenanceChrome";
import { useProposedPlanToolCallIds } from "#product/components/workspace/chat/transcript/ProposedPlanToolCallIdsContext";
import {
  useTranscriptCanOpenSession,
  useTranscriptOpenSession,
  useTranscriptSessionId,
} from "#product/components/workspace/chat/transcript/TranscriptContexts";

type PlanHandoffHandler = (plan: PromptPlanAttachmentDescriptor) => void;

export function TranscriptItemBlock({
  item,
  transcript,
  animateActivityEntry = false,
  workspaceId,
  onOpenArtifact,
  onHandOffPlanToNewSession,
}: {
  item: TranscriptItem;
  transcript: TranscriptState;
  animateActivityEntry?: boolean;
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
              renderLink={renderTranscriptLink}
              renderInlineCode={renderTranscriptInlineCode}
              renderCodeBlock={renderTranscriptCodeBlock}
            />
          </div>
        </div>
      );
    }

    case "thought":
      return (
        <div data-transcript-activity-shell className="flex justify-start relative">
          <div className="flex flex-col w-full max-w-full space-y-1 break-words">
            <TranscriptActivityBlock entryItemId={item.itemId} animateEntry={animateActivityEntry}>
              <ReasoningBlock content={item.text || undefined} />
            </TranscriptActivityBlock>
          </div>
        </div>
      );

    case "tool_call": {
      if (isClaudeExitPlanModeCall(item)) {
        if (hasProposedPlanForToolCallItem(toolCallIdsWithProposedPlan, item)) {
          return null;
        }
        const body = extractClaudePlanBody(item) ?? "";
        return (
          <div data-transcript-activity-shell className="flex justify-start relative">
            <div className="flex flex-col w-full max-w-full space-y-1 break-words">
              <TranscriptActivityBlock entryItemId={item.itemId} animateEntry={animateActivityEntry}>
                <ClaudePlanCard
                  content={body}
                  isStreaming={item.status === "in_progress"}
                />
              </TranscriptActivityBlock>
            </div>
          </div>
        );
      }
      const modeSwitchDisplay = deriveModeSwitchDisplay(item);
      if (modeSwitchDisplay) {
        return (
          <div data-transcript-activity-shell className="flex justify-start relative">
            <div className="flex flex-col w-full max-w-full break-words">
              <TranscriptActivityBlock entryItemId={item.itemId} animateEntry={animateActivityEntry}>
                <ModeTransitionDivider label={modeSwitchDisplay.label} />
              </TranscriptActivityBlock>
            </div>
          </div>
        );
      }
      return (
        <div data-transcript-activity-shell className="flex justify-start relative">
          <div className="flex flex-col w-full max-w-full space-y-1 break-words">
            <TranscriptActivityBlock entryItemId={item.itemId} animateEntry={animateActivityEntry}>
              <TranscriptToolCallItemBlock
                item={item}
                workspaceId={workspaceId}
                onOpenArtifact={onOpenArtifact}
              />
            </TranscriptActivityBlock>
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
