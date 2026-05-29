import { Fragment, type ReactNode } from "react";
import type {
  ToolCallItem,
  TranscriptState,
} from "@anyharness/sdk";
import { ToolCallSummary } from "@/components/workspace/chat/tool-calls/ToolCallSummary";
import { describeToolCallDisplay } from "@proliferate/product-domain/chats/tools/tool-call-display";
import { ToolKindIcon } from "./TranscriptToolKindIcon";
import { TranscriptAgentGroupBlock } from "./TranscriptAgentGroupBlock";
import { TranscriptToolCallItemBlock } from "./TranscriptToolCallItemBlock";
import {
  buildCollapsedSummaryIcons,
  collectDescendantItems,
  formatCollapsedSummary,
  hasRenderableToolDetails,
  isSubagentItem,
} from "./TranscriptToolGroupUtils";

export function TranscriptToolCallGroupBlock({
  item,
  childIds,
  transcript,
  childrenByParentId,
  workspaceId,
  onOpenArtifact,
  renderChild,
}: {
  item: ToolCallItem;
  childIds: string[];
  transcript: TranscriptState;
  childrenByParentId: Map<string, string[]>;
  workspaceId: string | null;
  onOpenArtifact: (workspaceId: string, artifactId: string) => void;
  renderChild: (childId: string) => ReactNode;
}) {
  if (isSubagentItem(item)) {
    return (
      <TranscriptAgentGroupBlock
        item={item}
        childIds={childIds}
        transcript={transcript}
        childrenByParentId={childrenByParentId}
        renderChild={renderChild}
      />
    );
  }

  const descendants = collectDescendantItems(childIds, transcript, childrenByParentId);
  const subagentCount = descendants.filter(
    (entry) => entry.kind === "tool_call" && entry.semanticKind === "subagent",
  ).length;
  const toolCallCount = descendants.filter(
    (entry) => entry.kind === "tool_call" && entry.semanticKind !== "subagent",
  ).length;
  const messageCount = descendants.filter(
    (entry) => entry.kind === "assistant_prose" || entry.kind === "thought",
  ).length;
  const summary = formatCollapsedSummary({
    messages: messageCount,
    toolCalls: toolCallCount,
    subagents: subagentCount,
  });
  const renderableItemCount = (hasRenderableToolDetails(item) ? 1 : 0) + childIds.length;
  const display = describeToolCallDisplay(
    item,
    item.title ?? item.nativeToolName ?? "Tool group",
  );

  return (
    <ToolCallSummary
      icon={<ToolKindIcon iconKey={display.iconKey} />}
      label={display.label}
      summary={summary}
      itemCount={renderableItemCount}
      typeIcons={buildCollapsedSummaryIcons({
        messages: messageCount,
        toolCalls: toolCallCount,
        subagents: subagentCount,
      })}
      renderChildren={() => (
        <div className="space-y-1.5">
          {hasRenderableToolDetails(item) && (
            <TranscriptToolCallItemBlock
              item={item}
              workspaceId={workspaceId}
              onOpenArtifact={onOpenArtifact}
            />
          )}
          <div className="ml-1 space-y-1.5">
            {childIds.map((childId) => (
              <Fragment key={childId}>
                {renderChild(childId)}
              </Fragment>
            ))}
          </div>
        </div>
      )}
    />
  );
}
