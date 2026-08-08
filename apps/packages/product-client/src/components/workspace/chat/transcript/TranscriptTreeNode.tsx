import type { TranscriptState } from "@anyharness/sdk";
import type { PromptPlanAttachmentDescriptor } from "#product/domain/chats/composer/prompt-plan-attachments";
import { isSubagentItem } from "#product/components/workspace/chat/transcript/TranscriptToolGroupUtils";
import { TranscriptActivityBlock } from "#product/components/workspace/chat/transcript/TranscriptActivityBlock";
import { TranscriptItemBlock } from "#product/components/workspace/chat/transcript/TranscriptItemBlock";
import { TranscriptToolCallGroupBlock } from "#product/components/workspace/chat/transcript/TranscriptToolCallGroupBlock";
import type { AssistantMessageRevealState } from "#product/lib/domain/chat/transcript/assistant-message-reveal";

type PlanHandoffHandler = (plan: PromptPlanAttachmentDescriptor) => void;

export function TranscriptTreeNode({
  itemId,
  transcript,
  childrenByParentId,
  animateActivityEntry = false,
  animateAssistantReveal = false,
  onAssistantRevealStateChange,
  workspaceId,
  onHandOffPlanToNewSession,
}: {
  itemId: string;
  transcript: TranscriptState;
  childrenByParentId: Map<string, string[]>;
  animateActivityEntry?: boolean;
  animateAssistantReveal?: boolean;
  onAssistantRevealStateChange?: (
    itemId: string,
    state: AssistantMessageRevealState,
  ) => void;
  workspaceId: string | null;
  onHandOffPlanToNewSession?: PlanHandoffHandler;
}) {
  const item = transcript.itemsById[itemId];
  if (!item) return null;

  const childIds = childrenByParentId.get(itemId) ?? [];
  if (item.kind === "tool_call" && (childIds.length > 0 || isSubagentItem(item))) {
    return (
      <TranscriptActivityBlock entryItemId={itemId} animateEntry={animateActivityEntry}>
        <TranscriptToolCallGroupBlock
          item={item}
          childIds={childIds}
          transcript={transcript}
          childrenByParentId={childrenByParentId}
          renderChild={(childId) => (
            <TranscriptTreeNode
              itemId={childId}
              transcript={transcript}
              childrenByParentId={childrenByParentId}
              animateActivityEntry={animateActivityEntry}
              animateAssistantReveal={false}
              onAssistantRevealStateChange={onAssistantRevealStateChange}
              workspaceId={workspaceId}
              onHandOffPlanToNewSession={onHandOffPlanToNewSession}
            />
          )}
        />
      </TranscriptActivityBlock>
    );
  }

  return (
    <TranscriptItemBlock
      item={item}
      transcript={transcript}
      animateActivityEntry={animateActivityEntry}
      animateAssistantReveal={animateAssistantReveal}
      onAssistantRevealStateChange={onAssistantRevealStateChange}
      workspaceId={workspaceId}
      onHandOffPlanToNewSession={onHandOffPlanToNewSession}
    />
  );
}
