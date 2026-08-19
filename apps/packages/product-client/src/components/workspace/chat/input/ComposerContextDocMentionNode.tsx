import {
  TextNode,
  setDOMUnmanaged,
  type DOMSlot,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type SerializedTextNode,
  type Spread,
} from "lexical";
import type { TextMatchTransformer } from "@lexical/markdown";
import { FILE_ICON_ASSETS } from "#product/components/workspace/files/file-icon-assets";
import {
  CONTEXT_DOC_MENTION_LINK_BODY,
  CONTEXT_DOC_DESTINATION_PREFIX,
  contextDocMentionWorkspacePath,
  formatContextDocMentionToken,
  parseContextDocMentionDestination,
  type ContextDocMentionRef,
} from "#product/lib/domain/chat/composer/context-doc-mention";

export type SerializedComposerContextDocMentionNode = Spread<
  { runId: string; filename: string },
  SerializedTextNode
>;

/**
 * The context-doc chip wears the file-mention chip's anatomy classes (the
 * inline-flex/gap/glyph-centering rules in product.css key off
 * `composer-file-mention`) plus its own identity class: the two mentions are
 * deliberately the same chip *shape* with a different glyph and serialization,
 * so a doc picked from a run and a file picked from the tree read as siblings.
 */
const CONTEXT_DOC_CHIP_CLASS =
  "composer-context-doc-mention composer-file-mention rounded-sm border border-border/60 bg-muted/45 px-1 py-px text-foreground/90";

const CONTEXT_DOC_GLYPH_CLASS =
  "composer-file-mention-glyph icon-compact file-reference-icon inline-block shrink-0 select-none [&>svg]:block [&>svg]:size-full";
const GLYPH_ATTRIBUTE = "data-composer-context-doc-mention-glyph";
const CONTENT_ATTRIBUTE = "data-composer-context-doc-mention-content";

/**
 * A workflow context-doc mention chip in the composer.
 *
 * Sibling of `ComposerFileMentionNode` and built the same way — a `TextNode`
 * in token mode, so the caret walks past it, it deletes as one unit, and
 * markdown export needs no special cases. It differs in what it points at: a
 * doc registered to one of the workspace's workflow runs, carried as
 * `(runId, filename)` and serialized to the `@doc:` token rather than a
 * workspace file link, so the two never cross-parse.
 */
export class ComposerContextDocMentionNode extends TextNode {
  /** The run whose doc registry owns the mentioned doc. */
  __runId: string;
  /** The doc's filename inside the run workspace's context directory. */
  __filename: string;

  static getType(): string {
    return "composer-context-doc-mention";
  }

  static clone(node: ComposerContextDocMentionNode): ComposerContextDocMentionNode {
    return new ComposerContextDocMentionNode(
      { runId: node.__runId, filename: node.__filename },
      node.__text,
      node.__key,
    );
  }

  constructor(ref: ContextDocMentionRef, text?: string, key?: NodeKey) {
    super(text ?? ref.filename, key);
    this.__runId = ref.runId;
    this.__filename = ref.filename;
  }

  afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__runId = prevNode.__runId;
    this.__filename = prevNode.__filename;
  }

  getRef(): ContextDocMentionRef {
    const latest = this.getLatest();
    return { runId: latest.__runId, filename: latest.__filename };
  }

  setRef(ref: ContextDocMentionRef): this {
    const writable = this.getWritable();
    writable.__runId = ref.runId;
    writable.__filename = ref.filename;
    return writable;
  }

  createDOM(config: EditorConfig, editor?: LexicalEditor): HTMLElement {
    const element = super.createDOM(config, editor);
    element.className = `${element.className} ${CONTEXT_DOC_CHIP_CLASS}`.trim();
    // Same move as the file chip: `super.createDOM` has already put the text
    // straight into `element`, so the text is moved into a content element and
    // the glyph becomes its leading sibling.
    const document = element.ownerDocument;
    const content = document.createElement("span");
    content.setAttribute(CONTENT_ATTRIBUTE, "true");
    content.append(...Array.from(element.childNodes));
    element.append(createContextDocGlyph(document), content);
    applyContextDocRef(element, this.getRefSnapshot());
    return element;
  }

  /**
   * Points reconciliation and selection at the chip's text element, exactly as
   * the file mention node does; see that node's comment for why the glyph
   * sibling needs this.
   */
  getDOMSlot(element: HTMLElement): DOMSlot<HTMLElement> {
    const slot = super.getDOMSlot(element);
    const content = element.querySelector<HTMLElement>(`[${CONTENT_ATTRIBUTE}]`);
    return content ? slot.withElement(content) : slot;
  }

  updateDOM(prevNode: this, dom: HTMLElement, config: EditorConfig): boolean {
    const updated = super.updateDOM(prevNode, dom, config);
    if (updated) {
      return true;
    }
    if (prevNode.__runId !== this.__runId || prevNode.__filename !== this.__filename) {
      applyContextDocRef(dom, this.getRefSnapshot());
    }
    return false;
  }

  static importJSON(
    serializedNode: SerializedComposerContextDocMentionNode,
  ): ComposerContextDocMentionNode {
    return $createComposerContextDocMentionNode(
      { runId: serializedNode.runId, filename: serializedNode.filename },
      serializedNode.text,
    ).updateFromJSON(serializedNode);
  }

  updateFromJSON(
    serializedNode: LexicalUpdateJSON<SerializedComposerContextDocMentionNode>,
  ): this {
    return super
      .updateFromJSON(serializedNode)
      .setRef({ runId: serializedNode.runId, filename: serializedNode.filename });
  }

  exportJSON(): SerializedComposerContextDocMentionNode {
    const ref = this.getRef();
    return { ...super.exportJSON(), runId: ref.runId, filename: ref.filename };
  }

  /** Typing right against a chip must produce ordinary text, never extend it. */
  canInsertTextBefore(): boolean {
    return false;
  }

  canInsertTextAfter(): boolean {
    return false;
  }

  /** Ref without `getLatest()`, for use during DOM construction. */
  private getRefSnapshot(): ContextDocMentionRef {
    return { runId: this.__runId, filename: this.__filename };
  }
}

export function $createComposerContextDocMentionNode(
  ref: ContextDocMentionRef,
  label?: string,
): ComposerContextDocMentionNode {
  return new ComposerContextDocMentionNode(ref, label).setMode("token");
}

export function $isComposerContextDocMentionNode(
  node: LexicalNode | null | undefined,
): node is ComposerContextDocMentionNode {
  return node instanceof ComposerContextDocMentionNode;
}

function createContextDocGlyph(document: Document): HTMLElement {
  const glyph = document.createElement("span");
  glyph.setAttribute(GLYPH_ATTRIBUTE, "true");
  glyph.setAttribute("aria-hidden", "true");
  glyph.className = CONTEXT_DOC_GLYPH_CLASS;
  // The generic document mark, not the extension-derived file icon: the chip
  // says "a context doc of a workflow run", not "a markdown file".
  glyph.innerHTML = FILE_ICON_ASSETS.document;
  // Decoration the composer painted, not content Lexical manages; see the file
  // mention node.
  setDOMUnmanaged(glyph);
  return glyph;
}

/**
 * Machine-readable identity and the hover tooltip. The tooltip carries the
 * resolved workspace path — the pointer the mention will send — which is what
 * a user hovering a chip wants confirmed.
 */
function applyContextDocRef(element: HTMLElement, ref: ContextDocMentionRef): void {
  element.setAttribute("data-composer-context-doc-mention", `${ref.runId}/${ref.filename}`);
  element.title = contextDocMentionWorkspacePath(ref);
}

/**
 * Renders `[label](@doc:<runId>/<filename>)` in the draft as a context-doc
 * chip, and serializes a chip back to exactly that token. The `@doc:` prefix
 * requires a `:` in the destination, which the workspace file-link transformer
 * rejects, so the two transformers can never claim each other's text.
 */
export const COMPOSER_CONTEXT_DOC_MENTION_TRANSFORMER: TextMatchTransformer = {
  dependencies: [ComposerContextDocMentionNode],
  export: (node) => {
    if (!$isComposerContextDocMentionNode(node)) {
      return null;
    }
    return formatContextDocMentionToken(node.getTextContent(), node.getRef());
  },
  importRegExp: new RegExp(CONTEXT_DOC_MENTION_LINK_BODY),
  regExp: new RegExp(`${CONTEXT_DOC_MENTION_LINK_BODY}$`),
  replace: (textNode, match) => {
    const label = match[1] ?? "";
    const ref = parseContextDocMentionDestination(
      `${CONTEXT_DOC_DESTINATION_PREFIX}${match[2] ?? ""}`,
    );
    if (!ref) {
      return;
    }
    textNode.replace($createComposerContextDocMentionNode(ref, label));
  },
  trigger: ")",
  type: "text-match",
};
