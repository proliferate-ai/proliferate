import type { TranscriptState } from "@anyharness/sdk";
import type { PromptPlanAttachmentDescriptor } from "@/lib/domain/chat/composer/prompt-content";
import { isSubagentItem } from "./TranscriptToolGroupUtils";
import { TranscriptItemBlock } from "./TranscriptItemBlock";
import { TranscriptToolCallGroupBlock } from "./TranscriptToolCallGroupBlock";

type PlanHandoffHandler = (plan: PromptPlanAttachmentDescriptor) => void;

export function TranscriptTreeNode({
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
