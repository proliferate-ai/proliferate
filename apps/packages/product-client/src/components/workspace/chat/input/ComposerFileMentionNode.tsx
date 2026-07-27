import {
  TextNode,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type SerializedTextNode,
  type Spread,
} from "lexical";
import type { TextMatchTransformer } from "@lexical/markdown";
import {
  formatMarkdownFileLink,
  normalizeWorkspaceRelativePath,
  workspaceFileBasename,
} from "#product/lib/domain/chat/composer/file-mention-links";

export type SerializedComposerFileMentionNode = Spread<
  { path: string },
  SerializedTextNode
>;

/**
 * The chip treatment for a file mention inside the draft.
 *
 * This is the same chip anatomy the transcript already uses for a resolved file
 * reference — hairline border, muted fill, 6px radius, one text step of inset —
 * so a path the user just picked in the composer and the same path echoed back
 * in the transcript read as one object. The class list is kept local to the
 * composer node on purpose: the composer owns how a *draft* mention paints, and
 * transcript rendering owns its own.
 */
const FILE_MENTION_CHIP_CLASS =
  "rounded-sm border border-border/60 bg-muted/45 px-1 py-px text-foreground/90";

/**
 * A mention chip in the composer.
 *
 * It is a `TextNode` rather than a decorator so the mention stays part of the
 * text stream: the caret walks past it, selection and markdown export work
 * without special cases, and no nested editor/React root is needed. Token mode
 * makes it delete as one unit — a mention is a single thing the user picked,
 * not eight characters they typed.
 */
export class ComposerFileMentionNode extends TextNode {
  /** Workspace-relative path this chip links to. */
  __path: string;

  static getType(): string {
    return "composer-file-mention";
  }

  static clone(node: ComposerFileMentionNode): ComposerFileMentionNode {
    return new ComposerFileMentionNode(node.__path, node.__text, node.__key);
  }

  constructor(path: string, text?: string, key?: NodeKey) {
    super(text ?? workspaceFileBasename(path), key);
    this.__path = path;
  }

  afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__path = prevNode.__path;
  }

  getPath(): string {
    return this.getLatest().__path;
  }

  setPath(path: string): this {
    const writable = this.getWritable();
    writable.__path = path;
    return writable;
  }

  createDOM(config: EditorConfig, editor?: LexicalEditor): HTMLElement {
    const element = super.createDOM(config, editor);
    element.className = `${element.className} ${FILE_MENTION_CHIP_CLASS}`.trim();
    element.setAttribute("data-composer-file-mention", this.__path);
    element.title = this.__path;
    return element;
  }

  updateDOM(prevNode: this, dom: HTMLElement, config: EditorConfig): boolean {
    const updated = super.updateDOM(prevNode, dom, config);
    if (updated) {
      return true;
    }
    if (prevNode.__path !== this.__path) {
      dom.setAttribute("data-composer-file-mention", this.__path);
      dom.title = this.__path;
    }
    return false;
  }

  static importJSON(
    serializedNode: SerializedComposerFileMentionNode,
  ): ComposerFileMentionNode {
    return $createComposerFileMentionNode(
      serializedNode.path,
      serializedNode.text,
    ).updateFromJSON(serializedNode);
  }

  updateFromJSON(
    serializedNode: LexicalUpdateJSON<SerializedComposerFileMentionNode>,
  ): this {
    return super.updateFromJSON(serializedNode).setPath(serializedNode.path);
  }

  exportJSON(): SerializedComposerFileMentionNode {
    return { ...super.exportJSON(), path: this.getPath() };
  }

  /** Typing right against a chip must produce ordinary text, never extend it. */
  canInsertTextBefore(): boolean {
    return false;
  }

  canInsertTextAfter(): boolean {
    return false;
  }
}

export function $createComposerFileMentionNode(
  path: string,
  label?: string,
): ComposerFileMentionNode {
  return new ComposerFileMentionNode(path, label).setMode("token");
}

export function $isComposerFileMentionNode(
  node: LexicalNode | null | undefined,
): node is ComposerFileMentionNode {
  return node instanceof ComposerFileMentionNode;
}

/**
 * Markdown destinations that are workspace-relative file paths, and only those.
 *
 * A mention chip is a claim that the destination is a file in this workspace, so
 * the pattern excludes anything with a URL scheme (the `:` guard), anything
 * rooted outside the tree (`/`, `~`), and fragments. An `https://` link typed or
 * pasted into the composer therefore stays a plain link, which is what
 * `ComposerLinkPastePlugin` and the markdown output transformer already handle.
 */
const WORKSPACE_FILE_LINK_BODY = "\\[([^[\\]]+)\\]\\((?![/~#<])([^()\\s:]+)\\)";

/**
 * Renders `[name](workspace/relative/path)` in the draft as a mention chip, and
 * serializes a chip back to exactly that markdown.
 */
export const COMPOSER_FILE_MENTION_TRANSFORMER: TextMatchTransformer = {
  dependencies: [ComposerFileMentionNode],
  export: (node) => {
    if (!$isComposerFileMentionNode(node)) {
      return null;
    }
    return formatMarkdownFileLink(node.getTextContent(), node.getPath());
  },
  importRegExp: new RegExp(WORKSPACE_FILE_LINK_BODY),
  regExp: new RegExp(`${WORKSPACE_FILE_LINK_BODY}$`),
  replace: (textNode, match) => {
    const label = match[1] ?? "";
    const path = normalizeWorkspaceRelativePath(match[2] ?? "");
    if (!path) {
      return;
    }
    textNode.replace($createComposerFileMentionNode(path, label));
  },
  trigger: ")",
  type: "text-match",
};
