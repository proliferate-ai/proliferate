import type {
  TranscriptItem,
  TranscriptState,
  ToolCallItem,
} from "@anyharness/sdk";
import { useCallback } from "react";
import { ReasoningBlock } from "#product/components/workspace/chat/tool-calls/ReasoningBlock";
import type { PromptPlanAttachmentDescriptor } from "#product/domain/chats/composer/prompt-plan-attachments";
import {
  extractClaudePlanBody,
  isClaudeExitPlanModeCall,
} from "#product/domain/chats/tools/claude-plan-tool-call";
import { deriveModeSwitchDisplay } from "#product/domain/chats/tools/mode-switch-display";
import {
  isAgentSessionProvenance,
  isSubagentWakeProvenance,
} from "#product/domain/chats/subagents/provenance";
import {
  hasProposedPlanForToolCallItem,
} from "#product/domain/chats/transcript/transcript-rendering";
import {
  resolveUserMessageActionTime,
} from "#product/domain/chats/transcript/transcript-action-time";
import { AssistantMessage } from "#product/components/workspace/chat/transcript/AssistantMessage";
import type { AssistantMessageRevealState } from "#product/lib/domain/chat/transcript/assistant-message-reveal";
import {
  getAssistantRevealProgress,
  recordAssistantRevealProgress,
} from "#product/hooks/chat/ui/assistant-reveal-progress";
import {
  renderTranscriptCodeBlock,
  renderTranscriptInlineCode,
  renderTranscriptLink,
} from "#product/components/workspace/chat/transcript/transcript-markdown";
import { ClaudePlanCard } from "#product/components/workspace/chat/transcript/ClaudePlanCard";
import { ModeTransitionDivider } from "#product/components/workspace/chat/transcript/ModeTransitionDivider";
import { ConnectedProposedPlanItem } from "#product/components/workspace/chat/transcript/ConnectedProposedPlanItem";
import { SessionErrorItem } from "#product/components/workspace/chat/transcript/SessionErrorItem";
import { AgentOriginPromptReceipt } from "#product/components/workspace/chat/transcript/AgentOriginPromptReceipt";
import { SystemMessage } from "#product/components/workspace/chat/transcript/SystemMessage";
import { TranscriptActivityBlock } from "#product/components/workspace/chat/transcript/TranscriptActivityBlock";
import { TranscriptToolCallItemBlock } from "#product/components/workspace/chat/transcript/TranscriptToolCallItemBlock";
import { UserMessage } from "#product/components/workspace/chat/transcript/UserMessage";
import { useProposedPlanToolCallIds } from "#product/components/workspace/chat/transcript/ProposedPlanToolCallIdsContext";
import { useTranscriptSessionId } from "#product/components/workspace/chat/transcript/TranscriptContexts";

type PlanHandoffHandler = (plan: PromptPlanAttachmentDescriptor) => void;

export function TranscriptItemBlock({
  item,
  transcript,
  animateActivityEntry = false,
  animateAssistantReveal = false,
  onAssistantRevealStateChange,
  workspaceId,
  onOpenArtifact,
  onOpenBackgroundTerminal,
  onHandOffPlanToNewSession,
}: {
  item: TranscriptItem;
  transcript: TranscriptState;
  animateActivityEntry?: boolean;
  animateAssistantReveal?: boolean;
  onAssistantRevealStateChange?: (
    itemId: string,
    state: AssistantMessageRevealState,
  ) => void;
  workspaceId: string | null;
  onOpenArtifact: (workspaceId: string, artifactId: string) => void;
  onOpenBackgroundTerminal?: (processId: string) => void;
  onHandOffPlanToNewSession?: PlanHandoffHandler;
}) {
  const sessionId = useTranscriptSessionId();
  const reportAssistantRevealState = useCallback((state: AssistantMessageRevealState) => {
    recordAssistantRevealProgress(item.itemId, state);
    onAssistantRevealStateChange?.(item.itemId, state);
  }, [item.itemId, onAssistantRevealStateChange]);

  switch (item.kind) {
    case "user_message": {
      if (
        isSubagentWakeProvenance(item.promptProvenance)
        || isAgentSessionProvenance(item.promptProvenance)
      ) {
        return (
          <AgentOriginPromptReceipt
            provenance={item.promptProvenance}
            exactMessage={item.text}
            transcript={transcript}
            parentSessionId={sessionId}
            workspaceId={workspaceId}
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
        <div
          className="flex justify-start relative"
          data-assistant-prose
          data-assistant-streaming={item.isStreaming ? "true" : "false"}
        >
          <div className="flex flex-col w-full min-w-0 max-w-full break-words">
            <AssistantMessage
              content={item.text}
              isStreaming={item.isStreaming}
              animateReveal={animateAssistantReveal}
              initialVisibleLength={animateAssistantReveal
                ? getAssistantRevealProgress(item.itemId)?.visibleLength
                : undefined}
              onRevealStateChange={animateAssistantReveal && onAssistantRevealStateChange
                ? reportAssistantRevealState
                : undefined}
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
      return (
        <ToolCallTranscriptItem
          item={item}
          animateActivityEntry={animateActivityEntry}
          workspaceId={workspaceId}
          onOpenArtifact={onOpenArtifact}
          onOpenBackgroundTerminal={onOpenBackgroundTerminal}
        />
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

function ToolCallTranscriptItem({
  item,
  animateActivityEntry,
  workspaceId,
  onOpenArtifact,
  onOpenBackgroundTerminal,
}: {
  item: ToolCallItem;
  animateActivityEntry: boolean;
  workspaceId: string | null;
  onOpenArtifact: (workspaceId: string, artifactId: string) => void;
  onOpenBackgroundTerminal?: (processId: string) => void;
}) {
  // Only tool calls participate in proposed-plan suppression. Keeping this
  // context subscription out of the generic item component prevents a rare
  // plan transition from invalidating every mounted prose/thought item.
  const toolCallIdsWithProposedPlan = useProposedPlanToolCallIds();

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
            onOpenBackgroundTerminal={onOpenBackgroundTerminal}
          />
        </TranscriptActivityBlock>
      </div>
    </div>
  );
}
