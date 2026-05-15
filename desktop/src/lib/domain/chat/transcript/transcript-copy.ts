import type {
  PendingPromptEntry,
  TranscriptState,
  TurnRecord,
} from "@anyharness/sdk";
import {
  buildTurnPresentation,
  type TurnDisplayBlock,
} from "@/lib/domain/chat/transcript/transcript-presentation";
import {
  joinTranscriptCopySections,
  serializeTranscriptItem,
  serializeUserPromptContent,
} from "@/lib/domain/chat/transcript/transcript-copy-items";

export interface BuildTranscriptCopyTextArgs {
  transcript: TranscriptState;
  visibleTurnIds: readonly string[];
  visibleOptimisticPrompt: PendingPromptEntry | null;
  proposedPlanToolCallIds: ReadonlySet<string>;
}

export function buildTranscriptCopyText({
  transcript,
  visibleTurnIds,
  visibleOptimisticPrompt,
  proposedPlanToolCallIds,
}: BuildTranscriptCopyTextArgs): string {
  const sections = visibleTurnIds.flatMap((turnId) => {
    const turn = transcript.turnsById[turnId];
    return turn
      ? serializeTurn(turn, transcript, proposedPlanToolCallIds)
      : [];
  });

  if (visibleOptimisticPrompt) {
    sections.push(...serializeUserPromptContent({
      parts: visibleOptimisticPrompt.contentParts,
      text: visibleOptimisticPrompt.text,
      promptProvenance: visibleOptimisticPrompt.promptProvenance,
      transcript,
      state: "queued",
    }));
  }

  return joinTranscriptCopySections(sections);
}

function serializeTurn(
  turn: TurnRecord,
  transcript: TranscriptState,
  proposedPlanToolCallIds: ReadonlySet<string>,
): string[] {
  const presentation = buildTurnPresentation(turn, transcript);
  const completedHistoryIds = new Set(presentation.completedHistoryRootIds);
  let emittedCompletedHistory = false;
  const sections: string[] = [];

  for (const block of presentation.displayBlocks) {
    if (blockIncludesCompletedHistory(block, completedHistoryIds)) {
      if (!emittedCompletedHistory) {
        sections.push(...serializeItemIds(
          presentation.completedHistoryRootIds,
          transcript,
          presentation.childrenByParentId,
          proposedPlanToolCallIds,
        ));
        emittedCompletedHistory = true;
      }
      continue;
    }

    sections.push(...serializeDisplayBlock(
      block,
      transcript,
      presentation.childrenByParentId,
      proposedPlanToolCallIds,
    ));
  }

  return sections;
}

function blockIncludesCompletedHistory(
  block: TurnDisplayBlock,
  completedHistoryIds: ReadonlySet<string>,
): boolean {
  switch (block.kind) {
    case "collapsed_actions":
    case "inline_tools":
    case "subagent_creations":
      return block.itemIds.some((itemId) => completedHistoryIds.has(itemId));
    case "inline_tool":
    case "item":
      return completedHistoryIds.has(block.itemId);
  }
}

function serializeDisplayBlock(
  block: TurnDisplayBlock,
  transcript: TranscriptState,
  childrenByParentId: Map<string, string[]>,
  proposedPlanToolCallIds: ReadonlySet<string>,
): string[] {
  switch (block.kind) {
    case "collapsed_actions":
    case "inline_tools":
    case "subagent_creations":
      return serializeItemIds(
        block.itemIds,
        transcript,
        childrenByParentId,
        proposedPlanToolCallIds,
      );
    case "inline_tool":
    case "item":
      return serializeItemTree(
        block.itemId,
        transcript,
        childrenByParentId,
        proposedPlanToolCallIds,
      );
  }
}

function serializeItemIds(
  itemIds: readonly string[],
  transcript: TranscriptState,
  childrenByParentId: Map<string, string[]>,
  proposedPlanToolCallIds: ReadonlySet<string>,
): string[] {
  return itemIds.flatMap((itemId) => serializeItemTree(
    itemId,
    transcript,
    childrenByParentId,
    proposedPlanToolCallIds,
  ));
}

function serializeItemTree(
  itemId: string,
  transcript: TranscriptState,
  childrenByParentId: Map<string, string[]>,
  proposedPlanToolCallIds: ReadonlySet<string>,
): string[] {
  const item = transcript.itemsById[itemId];
  if (!item) {
    return [];
  }

  const ownSections = serializeTranscriptItem(item, transcript, proposedPlanToolCallIds);
  const childSections = serializeItemIds(
    childrenByParentId.get(itemId) ?? [],
    transcript,
    childrenByParentId,
    proposedPlanToolCallIds,
  );

  return [...ownSections, ...childSections];
}
