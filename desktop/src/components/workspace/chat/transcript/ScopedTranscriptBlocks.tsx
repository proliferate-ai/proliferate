import { Fragment, type ReactNode } from "react";
import {
  CollapsedActions,
  InlineToolAction,
} from "@/components/workspace/chat/tool-calls/CollapsedActions";
import type {
  TranscriptState,
} from "@anyharness/sdk";
import type { TurnDisplayBlock } from "@/lib/domain/chat/transcript-presentation";

export function ScopedTranscriptBlocks({
  displayBlocks,
  transcript,
  forceExpandedCollapsedActionBlockId,
  renderItem,
}: {
  displayBlocks: readonly TurnDisplayBlock[];
  transcript: TranscriptState;
  forceExpandedCollapsedActionBlockId?: string | null;
  renderItem: (itemId: string) => ReactNode;
}) {
  return (
    <>
      {displayBlocks.map((block) => (
        <TurnDisplayBlockNode
          key={getTurnDisplayBlockKey(block)}
          block={block}
          transcript={transcript}
          forceExpandedCollapsedActionBlockId={forceExpandedCollapsedActionBlockId}
          renderItem={renderItem}
        />
      ))}
    </>
  );
}

export function TurnDisplayBlockNode({
  block,
  transcript,
  forceExpandedCollapsedActionBlockId,
  renderItem,
}: {
  block: TurnDisplayBlock;
  transcript: TranscriptState;
  forceExpandedCollapsedActionBlockId?: string | null;
  renderItem: (itemId: string) => ReactNode;
}) {
  if (block.kind === "collapsed_actions") {
    return (
      <CollapsedActions
        itemIds={block.itemIds}
        transcript={transcript}
        forceExpanded={block.blockId === forceExpandedCollapsedActionBlockId}
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
  return `item-${block.itemId}`;
}
