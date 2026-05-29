import {
  chatDraftLength,
  chatDraftNodeLength,
  chatDraftNodeStartOffset,
  clampDraftOffset,
  cloneChatDraftNode,
  normalizeChatDraft,
  type ChatComposerDraft,
  type ChatComposerDraftNode,
  type DraftEditResult,
  type DraftSelection,
} from "@/lib/domain/chat/composer/file-mention-draft-model";
import {
  collapseSelection,
  getDraftEndPosition,
  linearOffsetFromPosition,
  positionFromLinearOffset,
} from "@/lib/domain/chat/composer/file-mention-draft-position";

export function appendTextToDraft(draft: ChatComposerDraft, text: string): DraftEditResult {
  if (text.length === 0) {
    return {
      draft: normalizeChatDraft(draft),
      selection: collapseSelection(getDraftEndPosition(draft)),
    };
  }

  const normalized = normalizeChatDraft(draft);
  const nodes = normalized.nodes.map(cloneChatDraftNode);
  const last = nodes[nodes.length - 1];
  if (last?.type === "text") {
    last.text += text;
  } else {
    nodes.push({ type: "text", text });
  }
  const nextDraft = normalizeChatDraft({ nodes });
  return {
    draft: nextDraft,
    selection: collapseSelection(getDraftEndPosition(nextDraft)),
  };
}

export function insertTextAtSelection(
  draft: ChatComposerDraft,
  selection: DraftSelection,
  text: string,
): DraftEditResult {
  const normalized = normalizeChatDraft(draft);
  const range = selectionToRange(normalized, selection);
  return replaceRangeWithNodes(
    normalized,
    range.start,
    range.end,
    text.length > 0 ? [{ type: "text", text }] : [],
  );
}

export function deleteBackwardAtSelection(
  draft: ChatComposerDraft,
  selection: DraftSelection,
): DraftEditResult {
  const normalized = normalizeChatDraft(draft);
  const range = selectionToRange(normalized, selection);
  if (range.start !== range.end) {
    return replaceRangeWithNodes(normalized, range.start, range.end, []);
  }
  if (range.start <= 0) {
    return { draft: normalized, selection: collapseSelection(positionFromLinearOffset(normalized, 0)) };
  }
  return replaceRangeWithNodes(normalized, range.start - 1, range.start, []);
}

export function deleteForwardAtSelection(
  draft: ChatComposerDraft,
  selection: DraftSelection,
): DraftEditResult {
  const normalized = normalizeChatDraft(draft);
  const range = selectionToRange(normalized, selection);
  if (range.start !== range.end) {
    return replaceRangeWithNodes(normalized, range.start, range.end, []);
  }
  const length = chatDraftLength(normalized);
  if (range.start >= length) {
    return { draft: normalized, selection: collapseSelection(positionFromLinearOffset(normalized, length)) };
  }
  return replaceRangeWithNodes(normalized, range.start, range.start + 1, []);
}

export function removeMentionAtIndex(
  draft: ChatComposerDraft,
  nodeIndex: number,
): DraftEditResult {
  const normalized = normalizeChatDraft(draft);
  const node = normalized.nodes[nodeIndex];
  if (node?.type !== "file_mention") {
    return {
      draft: normalized,
      selection: collapseSelection(positionFromLinearOffset(normalized, chatDraftLength(normalized))),
    };
  }

  const start = chatDraftNodeStartOffset(normalized, nodeIndex);
  return replaceRangeWithNodes(normalized, start, start + 1, []);
}

function replaceRangeWithNodes(
  draft: ChatComposerDraft,
  rawStart: number,
  rawEnd: number,
  replacement: ChatComposerDraftNode[],
): DraftEditResult {
  const normalized = normalizeChatDraft(draft);
  const totalLength = chatDraftLength(normalized);
  const start = clampDraftOffset(Math.min(rawStart, rawEnd), 0, totalLength);
  const end = clampDraftOffset(Math.max(rawStart, rawEnd), 0, totalLength);
  const replacementNodes = replacement
    .map(cloneChatDraftNode)
    .filter((node) => node.type !== "text" || node.text.length > 0);
  const nodes: ChatComposerDraftNode[] = [];
  let inserted = false;
  let cursor = 0;

  function insertReplacement() {
    if (inserted) {
      return;
    }
    nodes.push(...replacementNodes.map(cloneChatDraftNode));
    inserted = true;
  }

  for (const node of normalized.nodes) {
    const length = chatDraftNodeLength(node);
    const nodeStart = cursor;
    const nodeEnd = cursor + length;

    if (nodeEnd <= start) {
      nodes.push(cloneChatDraftNode(node));
      cursor = nodeEnd;
      continue;
    }

    if (nodeStart >= end) {
      insertReplacement();
      nodes.push(cloneChatDraftNode(node));
      cursor = nodeEnd;
      continue;
    }

    if (node.type === "text") {
      const keepPrefixLength = Math.max(0, start - nodeStart);
      const keepSuffixStart = Math.min(length, Math.max(0, end - nodeStart));
      if (keepPrefixLength > 0) {
        nodes.push({ type: "text", text: node.text.slice(0, keepPrefixLength) });
      }
      insertReplacement();
      if (keepSuffixStart < length) {
        nodes.push({ type: "text", text: node.text.slice(keepSuffixStart) });
      }
    } else {
      insertReplacement();
    }

    cursor = nodeEnd;
  }

  insertReplacement();
  const nextDraft = normalizeChatDraft({ nodes });
  const replacementLength = replacementNodes.reduce((sum, node) => sum + chatDraftNodeLength(node), 0);
  return {
    draft: nextDraft,
    selection: collapseSelection(positionFromLinearOffset(nextDraft, start + replacementLength)),
  };
}

function selectionToRange(
  draft: ChatComposerDraft,
  selection: DraftSelection,
): { start: number; end: number } {
  const anchor = linearOffsetFromPosition(draft, selection.anchor);
  const focus = linearOffsetFromPosition(draft, selection.focus);
  return {
    start: Math.min(anchor, focus),
    end: Math.max(anchor, focus),
  };
}
