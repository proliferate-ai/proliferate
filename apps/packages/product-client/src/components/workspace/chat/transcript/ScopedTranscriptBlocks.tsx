import { Fragment, type ReactNode } from "react";
import {
  CollapsedActions,
} from "#product/components/workspace/chat/tool-calls/CollapsedActions";
import type {
  TranscriptState,
} from "@anyharness/sdk";
import type { TurnDisplayBlock } from "@proliferate/product-domain/chats/transcript/transcript-presentation";
import { SubagentCreationGroupBlock } from "#product/components/workspace/chat/transcript/SubagentCreationGroupBlock";
import { TranscriptActivityBlock } from "#product/components/workspace/chat/transcript/TranscriptActivityBlock";

export function ScopedTranscriptBlocks({
  displayBlocks,
  transcript,
  autoFollowCollapsedActionBlockId,
  animateActivityEntry = false,
  onOpenChanges,
  renderItem,
}: {
  displayBlocks: readonly TurnDisplayBlock[];
  transcript: TranscriptState;
  autoFollowCollapsedActionBlockId?: string | null;
  animateActivityEntry?: boolean;
  onOpenChanges?: () => void;
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
          animateActivityEntry={animateActivityEntry}
          onOpenChanges={onOpenChanges}
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
  animateActivityEntry = false,
  onOpenChanges,
  renderItem,
}: {
  block: TurnDisplayBlock;
  transcript: TranscriptState;
  autoFollowCollapsedActionBlockId?: string | null;
  animateActivityEntry?: boolean;
  onOpenChanges?: () => void;
  renderItem: (itemId: string) => ReactNode;
}) {
  if (block.kind === "collapsed_actions") {
    const ownsLiveContinuation = block.blockId === autoFollowCollapsedActionBlockId;
    return (
      <TranscriptActivityBlock
        entryItemId={block.itemIds[0] ?? null}
        animateEntry={animateActivityEntry}
      >
        <CollapsedActions
          itemIds={block.itemIds}
          transcript={transcript}
          autoFollow={ownsLiveContinuation}
          liveContinuation={ownsLiveContinuation}
          onOpenChanges={onOpenChanges}
        />
      </TranscriptActivityBlock>
    );
  }

  if (block.kind === "inline_tool") {
    const ownsLiveContinuation = block.itemId === autoFollowCollapsedActionBlockId;
    return (
      <TranscriptActivityBlock
        entryItemId={block.itemId}
        animateEntry={animateActivityEntry}
      >
        <CollapsedActions
          itemIds={[block.itemId]}
          transcript={transcript}
          autoFollow={ownsLiveContinuation}
          liveContinuation={ownsLiveContinuation}
          onOpenChanges={onOpenChanges}
        />
      </TranscriptActivityBlock>
    );
  }

  if (block.kind === "inline_tools") {
    const ownsLiveContinuation = block.blockId === autoFollowCollapsedActionBlockId;
    return (
      <TranscriptActivityBlock
        entryItemId={block.itemIds[0] ?? null}
        animateEntry={animateActivityEntry}
      >
        <CollapsedActions
          itemIds={block.itemIds}
          transcript={transcript}
          autoFollow={ownsLiveContinuation}
          liveContinuation={ownsLiveContinuation}
          onOpenChanges={onOpenChanges}
        />
      </TranscriptActivityBlock>
    );
  }

  if (block.kind === "subagent_creations") {
    return (
      <TranscriptActivityBlock
        entryItemId={block.itemIds[0] ?? null}
        animateEntry={animateActivityEntry}
      >
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
