import {
  formatMarkdownFileLink,
  isValidWorkspaceRelativePath,
  normalizeWorkspaceRelativePath,
  workspaceFileBasename,
} from "@/lib/domain/chat/composer/file-mention-links";

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

// The live composer no longer mints file mention nodes, but the draft model
// still round-trips persisted/serialized file-link prompts.
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

export function cloneChatDraftNode(node: ChatComposerDraftNode): ChatComposerDraftNode {
  return node.type === "text"
    ? { type: "text", text: node.text }
    : { type: "file_mention", id: node.id, name: node.name, path: node.path };
}

export function chatDraftLength(draft: ChatComposerDraft): number {
  return draft.nodes.reduce((sum, node) => sum + chatDraftNodeLength(node), 0);
}

export function chatDraftNodeLength(node: ChatComposerDraftNode): number {
  return node.type === "text" ? node.text.length : 1;
}

export function chatDraftNodeStartOffset(draft: ChatComposerDraft, nodeIndex: number): number {
  let offset = 0;
  for (let index = 0; index < draft.nodes.length && index < nodeIndex; index += 1) {
    offset += chatDraftNodeLength(draft.nodes[index]!);
  }
  return offset;
}

export function clampDraftOffset(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
