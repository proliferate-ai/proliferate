import { Fragment, type ReactNode } from "react";
import {
  CollapsedActions,
  InlineToolAction,
  InlineToolActions,
} from "@/components/workspace/chat/tool-calls/CollapsedActions";
import type {
  TranscriptState,
} from "@anyharness/sdk";
import type { TurnDisplayBlock } from "@proliferate/product-domain/chats/transcript/transcript-presentation";
import { SubagentCreationGroupBlock } from "./SubagentCreationGroupBlock";

export function ScopedTranscriptBlocks({
  displayBlocks,
  transcript,
  autoFollowCollapsedActionBlockId,
  renderItem,
}: {
  displayBlocks: readonly TurnDisplayBlock[];
  transcript: TranscriptState;
  autoFollowCollapsedActionBlockId?: string | null;
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
  renderItem,
}: {
  block: TurnDisplayBlock;
  transcript: TranscriptState;
  autoFollowCollapsedActionBlockId?: string | null;
  renderItem: (itemId: string) => ReactNode;
}) {
  if (block.kind === "collapsed_actions") {
    return (
      <CollapsedActions
        itemIds={block.itemIds}
        transcript={transcript}
        autoFollow={block.blockId === autoFollowCollapsedActionBlockId}
      />
    );
  }

  if (block.kind === "inline_tool") {
    const item = transcript.itemsById[block.itemId];
    if (item?.kind !== "tool_call") {
      throw new Error(`Inline tool block ${block.itemId} does not reference a tool call item.`);
    }
    return <InlineToolAction item={item} />;
  }

  if (block.kind === "inline_tools") {
    return (
      <InlineToolActions
        itemIds={block.itemIds}
        transcript={transcript}
      />
    );
  }

  if (block.kind === "subagent_creations") {
    return (
      <SubagentCreationGroupBlock
        itemIds={block.itemIds}
        transcript={transcript}
      />
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
    return `collapsed-actions-${block.blockId}`;
  }
  if (block.kind === "inline_tool") {
    return `inline-tool-${block.itemId}`;
  }
  if (block.kind === "inline_tools") {
    return `inline-tools-${block.blockId}`;
  }
  if (block.kind === "subagent_creations") {
    return `subagent-creations-${block.blockId}`;
  }
  return `item-${block.itemId}`;
}
