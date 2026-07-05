import { Fragment, type ReactNode } from "react";
import {
  CollapsedActions,
} from "@/components/workspace/chat/tool-calls/CollapsedActions";
import type {
  TranscriptState,
} from "@anyharness/sdk";
import type { TurnDisplayBlock } from "@proliferate/product-domain/chats/transcript/transcript-presentation";
import { SubagentCreationGroupBlock } from "./SubagentCreationGroupBlock";
import { TranscriptActivityBlock } from "./TranscriptActivityBlock";
import { TranscriptSubagentActivityBlock } from "./TranscriptSubagentActivityBlock";

export function ScopedTranscriptBlocks({
  displayBlocks,
  transcript,
  autoFollowCollapsedActionBlockId,
  childrenByParentId,
  renderItem,
}: {
  displayBlocks: readonly TurnDisplayBlock[];
  transcript: TranscriptState;
  autoFollowCollapsedActionBlockId?: string | null;
  /**
   * Required only to render `subagent_activity` blocks (orphaned background
   * subagent work) — they nest their own child tree. Omit for scoped recursion
   * that never produces that block kind.
   */
  childrenByParentId?: Map<string, string[]>;
  renderItem: (itemId: string) => ReactNode;
}) {
  return (
    <>
      {displayBlocks.map((block) => (
        <TurnDisplayBlockNode
          key={getTurnDisplayBlockKey(block)}
          block={block}
          transcript={transcript}
          autoFollowCollapsedActionBlockId={autoFollowCollapsedActionBlockId}
          childrenByParentId={childrenByParentId}
          renderItem={renderItem}
        />
      ))}
    </>
  );
}

export function TurnDisplayBlockNode({
  block,
  transcript,
  autoFollowCollapsedActionBlockId,
  childrenByParentId,
  renderItem,
}: {
  block: TurnDisplayBlock;
  transcript: TranscriptState;
  autoFollowCollapsedActionBlockId?: string | null;
  childrenByParentId?: Map<string, string[]>;
  renderItem: (itemId: string) => ReactNode;
}) {
  if (block.kind === "collapsed_actions") {
    return (
      <TranscriptActivityBlock>
        <CollapsedActions
          itemIds={block.itemIds}
          transcript={transcript}
          autoFollow={block.blockId === autoFollowCollapsedActionBlockId}
        />
      </TranscriptActivityBlock>
    );
  }

  if (block.kind === "inline_tool") {
    return (
      <TranscriptActivityBlock>
        <CollapsedActions
          itemIds={[block.itemId]}
          transcript={transcript}
          autoFollow={block.itemId === autoFollowCollapsedActionBlockId}
        />
      </TranscriptActivityBlock>
    );
  }

  if (block.kind === "inline_tools") {
    return (
      <TranscriptActivityBlock>
        <CollapsedActions
          itemIds={block.itemIds}
          transcript={transcript}
          autoFollow={block.blockId === autoFollowCollapsedActionBlockId}
        />
      </TranscriptActivityBlock>
    );
  }

  if (block.kind === "subagent_creations") {
    return (
      <TranscriptActivityBlock>
        <SubagentCreationGroupBlock
          itemIds={block.itemIds}
          transcript={transcript}
        />
      </TranscriptActivityBlock>
    );
  }

  if (block.kind === "subagent_activity") {
    return (
      <TranscriptActivityBlock>
        <TranscriptSubagentActivityBlock
          parentToolCallId={block.parentToolCallId}
          itemIds={block.itemIds}
          transcript={transcript}
          childrenByParentId={childrenByParentId ?? new Map()}
          renderChild={renderItem}
        />
      </TranscriptActivityBlock>
    );
  }

  return (
    <Fragment>
      {renderItem(block.itemId)}
    </Fragment>
  );
}

export function getTurnDisplayBlockKey(block: TurnDisplayBlock): string {
  if (block.kind === "collapsed_actions") {
    return `collapsed-actions-${block.itemIds[0] ?? block.blockId}`;
  }
  if (block.kind === "inline_tool") {
    return `collapsed-actions-${block.itemId}`;
  }
  if (block.kind === "inline_tools") {
    return `collapsed-actions-${block.itemIds[0] ?? block.blockId}`;
  }
  if (block.kind === "subagent_creations") {
    return `subagent-creations-${block.blockId}`;
  }
  if (block.kind === "subagent_activity") {
    return `subagent-activity-${block.blockId}`;
  }
  return `item-${block.itemId}`;
}
