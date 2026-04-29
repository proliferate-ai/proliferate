import {
  formatMarkdownFileLink,
  isValidWorkspaceRelativePath,
  normalizeWorkspaceRelativePath,
  workspaceFileBasename,
} from "@/lib/domain/chat/file-mention-links";

export interface ChatComposerDraft {
  nodes: ChatComposerDraftNode[];
}

export type ChatComposerDraftNode =
  | ChatComposerTextNode
  | ChatComposerFileMentionNode;

export interface ChatComposerTextNode {
  type: "text";
  text: string;
}

export interface ChatComposerFileMentionNode {
  type: "file_mention";
  id: string;
  name: string;
  path: string;
}

export type DraftPosition =
  | { kind: "text"; nodeIndex: number; offset: number }
  | { kind: "before-node"; nodeIndex: number }
  | { kind: "after-node"; nodeIndex: number };

export interface DraftSelection {
  anchor: DraftPosition;
  focus: DraftPosition;
}

export interface DraftEditResult {
  draft: ChatComposerDraft;
  selection: DraftSelection;
}

export interface MentionTrigger {
  query: string;
  start: DraftPosition;
  end: DraftPosition;
}

interface Unit {
  kind: "text" | "mention";
  char: string;
}

const MENTION_UNIT_CHAR = "\uFFFC";
const OPENING_TRIGGER_BOUNDARIES = new Set(["(", "[", "{", "<"]);

export const EMPTY_CHAT_DRAFT: ChatComposerDraft = Object.freeze({ nodes: [] });

let mentionIdSequence = 0;

export function createChatFileMentionId(): string {
  mentionIdSequence += 1;
  return `file-mention:${Date.now()}:${mentionIdSequence.toString(36)}`;
}

export function createTextDraft(text: string): ChatComposerDraft {
  return normalizeChatDraft({
    nodes: text.length > 0 ? [{ type: "text", text }] : [],
  });
}

export function createFileMentionNode(input: {
  id?: string;
  name: string;
  path: string;
}): ChatComposerFileMentionNode {
  return {
    type: "file_mention",
    id: input.id ?? createChatFileMentionId(),
    name: input.name,
    path: input.path,
  };
}

export function coerceChatDraft(value: ChatComposerDraft | string | null | undefined): ChatComposerDraft {
  if (typeof value === "string") {
    return createTextDraft(value);
  }
  if (!value || !Array.isArray(value.nodes)) {
    return EMPTY_CHAT_DRAFT;
  }
  return normalizeChatDraft(value);
}

export function normalizeChatDraft(draft: ChatComposerDraft): ChatComposerDraft {
  const nodes: ChatComposerDraftNode[] = [];

  for (const node of draft.nodes) {
    if (node.type === "text") {
      if (node.text.length === 0) {
        continue;
      }
      const previous = nodes[nodes.length - 1];
      if (previous?.type === "text") {
        previous.text += node.text;
      } else {
        nodes.push({ type: "text", text: node.text });
      }
      continue;
    }

    if (isValidWorkspaceRelativePath(node.path)) {
      nodes.push({
        type: "file_mention",
        id: node.id || createChatFileMentionId(),
        name: node.name || workspaceFileBasename(node.path),
        path: normalizeWorkspaceRelativePath(node.path) ?? node.path,
      });
    }
  }

  return nodes.length === 0 ? EMPTY_CHAT_DRAFT : { nodes };
}

export function isChatDraftEmpty(draft: ChatComposerDraft): boolean {
  return draft.nodes.every((node) =>
    node.type === "text" ? node.text.trim().length === 0 : false
  );
}

export function serializeChatDraftToPrompt(draft: ChatComposerDraft): string {
  return normalizeChatDraft(draft).nodes.map((node) => {
    if (node.type === "text") {
      return node.text;
    }
    return formatMarkdownFileLink(node.name || workspaceFileBasename(node.path), node.path);
  }).join("");
}

export function appendTextToDraft(draft: ChatComposerDraft, text: string): DraftEditResult {
  if (text.length === 0) {
    return {
      draft: normalizeChatDraft(draft),
      selection: collapseSelection(getDraftEndPosition(draft)),
    };
  }

  const normalized = normalizeChatDraft(draft);
  const nodes = normalized.nodes.map(cloneNode);
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
  const length = draftLength(normalized);
  if (range.start >= length) {
    return { draft: normalized, selection: collapseSelection(positionFromLinearOffset(normalized, length)) };
  }
  return replaceRangeWithNodes(normalized, range.start, range.start + 1, []);
}

export function insertFileMentionAtTrigger(
  draft: ChatComposerDraft,
  trigger: MentionTrigger,
  mention: ChatComposerFileMentionNode,
): DraftEditResult {
  const normalized = normalizeChatDraft(draft);
  const start = linearOffsetFromPosition(normalized, trigger.start);
  const triggerEnd = linearOffsetFromPosition(normalized, trigger.end);
  const nextUnit = draftUnits(normalized)[triggerEnd] ?? null;
  const end = nextUnit?.kind === "text" && /\s/u.test(nextUnit.char)
    ? triggerEnd + 1
    : triggerEnd;
  return replaceRangeWithNodes(normalized, start, end, [
    mention,
    { type: "text", text: " " },
  ]);
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
      selection: collapseSelection(positionFromLinearOffset(normalized, draftLength(normalized))),
    };
  }

  const start = nodeStartOffset(normalized, nodeIndex);
  return replaceRangeWithNodes(normalized, start, start + 1, []);
}

export function findMentionTrigger(
  draft: ChatComposerDraft,
  position: DraftPosition,
): MentionTrigger | null {
  const normalized = normalizeChatDraft(draft);
  const units = draftUnits(normalized);
  const caret = linearOffsetFromPosition(normalized, position);
  if (caret < 1 || caret > units.length) {
    return null;
  }

  for (let index = caret - 1; index >= 0; index -= 1) {
    const unit = units[index];
    if (!unit) {
      return null;
    }
    if (unit.kind === "mention" || /\s/u.test(unit.char)) {
      return null;
    }
    if (unit.char !== "@") {
      continue;
    }

    const before = units[index - 1] ?? null;
    if (!isTriggerBoundary(before)) {
      continue;
    }

    const query = units.slice(index + 1, caret).map((entry) => entry.char).join("");
    return {
      query,
      start: positionFromLinearOffset(normalized, index),
      end: positionFromLinearOffset(normalized, caret),
    };
  }

  return null;
}

export function collapseSelection(position: DraftPosition): DraftSelection {
  return { anchor: position, focus: position };
}

export function getDraftEndPosition(draft: ChatComposerDraft): DraftPosition {
  const normalized = normalizeChatDraft(draft);
  if (normalized.nodes.length === 0) {
    return { kind: "before-node", nodeIndex: 0 };
  }
  return positionFromLinearOffset(normalized, draftLength(normalized));
}

export function linearOffsetFromPosition(
  draft: ChatComposerDraft,
  position: DraftPosition,
): number {
  const normalized = normalizeChatDraft(draft);
  const length = draftLength(normalized);

  if (position.kind === "before-node") {
    return clamp(nodeStartOffset(normalized, position.nodeIndex), 0, length);
  }
  if (position.kind === "after-node") {
    const node = normalized.nodes[position.nodeIndex];
    if (!node) {
      return clamp(nodeStartOffset(normalized, position.nodeIndex), 0, length);
    }
    return clamp(nodeStartOffset(normalized, position.nodeIndex) + nodeLength(node), 0, length);
  }

  const node = normalized.nodes[position.nodeIndex];
  if (!node) {
    return length;
  }
  if (node.type !== "text") {
    return nodeStartOffset(normalized, position.nodeIndex);
  }
  return clamp(
    nodeStartOffset(normalized, position.nodeIndex) + position.offset,
    0,
    length,
  );
}

export function positionFromLinearOffset(
  draft: ChatComposerDraft,
  offset: number,
): DraftPosition {
  const normalized = normalizeChatDraft(draft);
  const clamped = clamp(offset, 0, draftLength(normalized));
  let cursor = 0;

  if (normalized.nodes.length === 0) {
    return { kind: "before-node", nodeIndex: 0 };
  }

  for (let index = 0; index < normalized.nodes.length; index += 1) {
    const node = normalized.nodes[index]!;
    const length = nodeLength(node);
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

function replaceRangeWithNodes(
  draft: ChatComposerDraft,
  rawStart: number,
  rawEnd: number,
  replacement: ChatComposerDraftNode[],
): DraftEditResult {
  const normalized = normalizeChatDraft(draft);
  const totalLength = draftLength(normalized);
  const start = clamp(Math.min(rawStart, rawEnd), 0, totalLength);
  const end = clamp(Math.max(rawStart, rawEnd), 0, totalLength);
  const replacementNodes = replacement
    .map(cloneNode)
    .filter((node) => node.type !== "text" || node.text.length > 0);
  const nodes: ChatComposerDraftNode[] = [];
  let inserted = false;
  let cursor = 0;

  function insertReplacement() {
    if (inserted) {
      return;
    }
    nodes.push(...replacementNodes.map(cloneNode));
    inserted = true;
  }

  for (const node of normalized.nodes) {
    const length = nodeLength(node);
    const nodeStart = cursor;
    const nodeEnd = cursor + length;

    if (nodeEnd <= start) {
      nodes.push(cloneNode(node));
      cursor = nodeEnd;
      continue;
    }

    if (nodeStart >= end) {
      insertReplacement();
      nodes.push(cloneNode(node));
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
  const replacementLength = replacementNodes.reduce((sum, node) => sum + nodeLength(node), 0);
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

function draftLength(draft: ChatComposerDraft): number {
  return draft.nodes.reduce((sum, node) => sum + nodeLength(node), 0);
}

function nodeLength(node: ChatComposerDraftNode): number {
  return node.type === "text" ? node.text.length : 1;
}

function nodeStartOffset(draft: ChatComposerDraft, nodeIndex: number): number {
  let offset = 0;
  for (let index = 0; index < draft.nodes.length && index < nodeIndex; index += 1) {
    offset += nodeLength(draft.nodes[index]!);
  }
  return offset;
}

function draftUnits(draft: ChatComposerDraft): Unit[] {
  return draft.nodes.flatMap((node): Unit[] => {
    if (node.type === "file_mention") {
      return [{ kind: "mention", char: MENTION_UNIT_CHAR } satisfies Unit];
    }
    return Array.from(node.text, (char) => ({ kind: "text", char }) satisfies Unit);
  });
}

function isTriggerBoundary(unit: Unit | null): boolean {
  if (!unit) {
    return true;
  }
  if (unit.kind === "mention") {
    return true;
  }
  return /\s/u.test(unit.char) || OPENING_TRIGGER_BOUNDARIES.has(unit.char);
}

function cloneNode(node: ChatComposerDraftNode): ChatComposerDraftNode {
  return node.type === "text"
    ? { type: "text", text: node.text }
    : { type: "file_mention", id: node.id, name: node.name, path: node.path };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
