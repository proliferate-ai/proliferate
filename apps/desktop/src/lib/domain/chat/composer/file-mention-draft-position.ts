import {
  chatDraftLength,
  chatDraftNodeLength,
  chatDraftNodeStartOffset,
  clampDraftOffset,
  normalizeChatDraft,
  type ChatComposerDraft,
  type DraftPosition,
  type DraftSelection,
} from "@/lib/domain/chat/composer/file-mention-draft-model";

export function collapseSelection(position: DraftPosition): DraftSelection {
  return { anchor: position, focus: position };
}

export function getDraftEndPosition(draft: ChatComposerDraft): DraftPosition {
  const normalized = normalizeChatDraft(draft);
  if (normalized.nodes.length === 0) {
    return { kind: "before-node", nodeIndex: 0 };
  }
  return positionFromLinearOffset(normalized, chatDraftLength(normalized));
}

export function linearOffsetFromPosition(
  draft: ChatComposerDraft,
  position: DraftPosition,
): number {
  const normalized = normalizeChatDraft(draft);
  const length = chatDraftLength(normalized);

  if (position.kind === "before-node") {
    return clampDraftOffset(chatDraftNodeStartOffset(normalized, position.nodeIndex), 0, length);
  }
  if (position.kind === "after-node") {
    const node = normalized.nodes[position.nodeIndex];
    if (!node) {
      return clampDraftOffset(chatDraftNodeStartOffset(normalized, position.nodeIndex), 0, length);
    }
    return clampDraftOffset(
      chatDraftNodeStartOffset(normalized, position.nodeIndex) + chatDraftNodeLength(node),
      0,
      length,
    );
  }

  const node = normalized.nodes[position.nodeIndex];
  if (!node) {
    return length;
  }
  if (node.type !== "text") {
    return chatDraftNodeStartOffset(normalized, position.nodeIndex);
  }
  return clampDraftOffset(
    chatDraftNodeStartOffset(normalized, position.nodeIndex) + position.offset,
    0,
    length,
  );
}

export function positionFromLinearOffset(
  draft: ChatComposerDraft,
  offset: number,
): DraftPosition {
  const normalized = normalizeChatDraft(draft);
  const clamped = clampDraftOffset(offset, 0, chatDraftLength(normalized));
  let cursor = 0;

  if (normalized.nodes.length === 0) {
    return { kind: "before-node", nodeIndex: 0 };
  }

  for (let index = 0; index < normalized.nodes.length; index += 1) {
    const node = normalized.nodes[index]!;
    const length = chatDraftNodeLength(node);
    const nodeEnd = cursor + length;

    if (node.type === "text" && clamped >= cursor && clamped <= nodeEnd) {
      return {
        kind: "text",
        nodeIndex: index,
        offset: clamped - cursor,
      };
    }

    if (node.type === "file_mention") {
      if (clamped === cursor) {
        return { kind: "before-node", nodeIndex: index };
      }
      if (clamped === nodeEnd) {
        return { kind: "after-node", nodeIndex: index };
      }
    }

    cursor = nodeEnd;
  }

  return { kind: "after-node", nodeIndex: normalized.nodes.length - 1 };
}
