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
  return `item-${block.itemId}`;
}
