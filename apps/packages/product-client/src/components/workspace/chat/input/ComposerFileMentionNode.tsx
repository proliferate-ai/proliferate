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
import { getFileVisual } from "#product/lib/domain/files/file-visuals";
import {
  composerFileMentionDirectoryLabel,
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
  "composer-file-mention rounded-sm border border-border/60 bg-muted/45 px-1 py-px text-foreground/90";

/**
 * The chip's leading file-type glyph.
 *
 * The glyph comes from the single extension→visual table the file tree, the
 * mention menu, and the transcript's file references all read, so a `.md` picked
 * in the composer wears the same mark it wears everywhere else. It is toned with
 * `file-reference-icon` rather than its own per-kind tone for the same reason the
 * transcript's chip variant is: inside a bordered chip a saturated per-language
 * color fights the chip's own fill, and one reference tone reads as "this is a
 * file reference" instead of as decoration.
 */
const FILE_MENTION_GLYPH_CLASS =
  "composer-file-mention-glyph icon-compact file-reference-icon inline-block shrink-0 select-none [&>svg]:block [&>svg]:size-full";
const GLYPH_ATTRIBUTE = "data-composer-file-mention-glyph";
const CONTENT_ATTRIBUTE = "data-composer-file-mention-content";
const DIRECTORY_ATTRIBUTE = "data-composer-file-mention-directory";

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
    // The chip's text stays in its own element, and the glyph is a sibling in
    // front of it. `super.createDOM` has already put the text straight into
    // `element` (the slot below cannot exist yet at that point), so the text is
    // moved into the content element here rather than rendered twice.
    const document = element.ownerDocument;
    const content = document.createElement("span");
    content.setAttribute(CONTENT_ATTRIBUTE, "true");
    content.append(...Array.from(element.childNodes));
    element.append(createFileMentionGlyph(document, this.__path), content);
    applyFileMentionPath(element, this.__path);
    return element;
  }

  /**
   * Points reconciliation and selection at the chip's text element.
   *
   * Everything Lexical does to a `TextNode`'s DOM — writing the next text,
   * mapping a DOM caret back onto a model offset — routes through this slot, so
   * exposing the inner content element is what lets the chip carry a glyph
   * sibling without the engine mistaking that glyph for the node's text. Without
   * it, resolving the node's text DOM walks the first-child chain, lands in the
   * glyph's SVG, and finds no text to anchor a caret against.
   *
   * The fallback is not dead code: a formatted mention (bold, italic) makes the
   * base class build a different tag, and a chip whose content element is absent
   * for any reason must still behave like a plain text node rather than throw.
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
    if (prevNode.__path !== this.__path) {
      applyFileMentionPath(dom, this.__path);
      const glyph = dom.querySelector<HTMLElement>(`[${GLYPH_ATTRIBUTE}]`);
      if (glyph) {
        glyph.innerHTML = fileMentionGlyphMarkup(this.__path);
      }
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

function fileMentionGlyphMarkup(path: string): string {
  const visual = getFileVisual(workspaceFileBasename(path), path, "file");
  return FILE_ICON_ASSETS[visual.kind] ?? FILE_ICON_ASSETS.default;
}

function createFileMentionGlyph(document: Document, path: string): HTMLElement {
  const glyph = document.createElement("span");
  glyph.setAttribute(GLYPH_ATTRIBUTE, "true");
  glyph.setAttribute("aria-hidden", "true");
  glyph.className = FILE_MENTION_GLYPH_CLASS;
  glyph.innerHTML = fileMentionGlyphMarkup(path);
  // The glyph is decoration the composer painted, not content Lexical manages.
  // Marking it unmanaged is what stops the mutation observer from evicting it as
  // foreign DOM the first time anything else in the draft changes.
  setDOMUnmanaged(glyph);
  return glyph;
}

/**
 * Puts the path on the chip in the three places a "file with a link to its path"
 * needs it: the machine-readable attribute, the hover tooltip, and — as an
 * elided directory trailing the basename — on screen.
 *
 * The directory is painted by a CSS `::after` on the content element fed by this
 * attribute, not by a second DOM element. That is deliberate: the chip is a
 * `TextNode`, and its text DOM is the one thing Lexical reconciles and anchors
 * carets in, so a real element inside it would either be overwritten on the next
 * keystroke or become a caret trap. A generated box cannot be selected, cannot
 * be reached by the caret, and never appears in `textContent` — so the painted
 * path is visible without becoming part of the draft's text.
 */
function applyFileMentionPath(element: HTMLElement, path: string): void {
  element.setAttribute("data-composer-file-mention", path);
  element.title = path;
  const directory = composerFileMentionDirectoryLabel(path);
  const content = element.querySelector<HTMLElement>(`[${CONTENT_ATTRIBUTE}]`);
  if (!content) {
    return;
  }
  if (directory) {
    content.setAttribute(DIRECTORY_ATTRIBUTE, directory);
  } else {
    content.removeAttribute(DIRECTORY_ATTRIBUTE);
  }
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
