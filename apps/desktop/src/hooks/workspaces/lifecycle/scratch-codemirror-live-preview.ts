import { syntaxTree } from "@codemirror/language";
import { type Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

// Obsidian-style live preview: markdown stays the source of truth; syntax
// markers are hidden with replace decorations unless the selection touches the
// formatted span, which reveals the raw markdown for in-place editing.
const FORMATTED_NODE_NAMES = new Set([
  "ATXHeading1",
  "ATXHeading2",
  "ATXHeading3",
  "ATXHeading4",
  "ATXHeading5",
  "ATXHeading6",
  "Emphasis",
  "StrongEmphasis",
  "Strikethrough",
  "InlineCode",
  "Link",
  "Image",
]);

const HEADING_MARK_NAMES = ["HeaderMark"];
const EMPHASIS_MARK_NAMES = ["EmphasisMark", "StrikethroughMark"];
const LINK_MARK_NAMES = ["LinkMark", "URL", "LinkTitle"];
const CODE_MARK_NAMES = ["CodeMark"];

const inlineCodeDecoration = Decoration.mark({ class: "scratch-inline-code" });
const hideMarkDecoration = Decoration.replace({});

export const scratchLivePreview = ViewPlugin.fromClass(class {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildScratchLivePreviewDecorations(view);
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.selectionSet) {
      this.decorations = buildScratchLivePreviewDecorations(update.view);
    }
  }
}, {
  decorations: (plugin) => plugin.decorations,
});

function buildScratchLivePreviewDecorations(view: EditorView): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (!FORMATTED_NODE_NAMES.has(node.name)) {
          return;
        }
        decorateFormattedNode(view, node.node, decorations);
      },
    });
  }
  return Decoration.set(decorations, true);
}

function decorateFormattedNode(
  view: EditorView,
  node: SyntaxNode,
  decorations: Range<Decoration>[],
) {
  const revealed = selectionTouches(view, revealRange(view, node));

  if (node.name === "InlineCode") {
    const marks = childrenOfType(node, CODE_MARK_NAMES);
    const contentFrom = marks[0]?.to ?? node.from;
    const contentTo = marks[marks.length - 1]?.from ?? node.to;
    if (contentFrom < contentTo) {
      decorations.push(inlineCodeDecoration.range(contentFrom, contentTo));
    }
    if (!revealed) {
      for (const mark of marks) {
        decorations.push(hideMarkDecoration.range(mark.from, mark.to));
      }
    }
    return;
  }

  if (revealed) {
    return;
  }

  if (node.name.startsWith("ATXHeading")) {
    for (const mark of childrenOfType(node, HEADING_MARK_NAMES)) {
      // Swallow the space separating the marker from the heading text so the
      // rendered heading starts flush with the line.
      const isOpeningMark = mark.from === node.from;
      const from = !isOpeningMark && view.state.doc.sliceString(mark.from - 1, mark.from) === " "
        ? mark.from - 1
        : mark.from;
      const to = isOpeningMark && view.state.doc.sliceString(mark.to, mark.to + 1) === " "
        ? mark.to + 1
        : mark.to;
      decorations.push(hideMarkDecoration.range(from, to));
    }
    return;
  }

  const markNames = node.name === "Link" || node.name === "Image"
    ? LINK_MARK_NAMES
    : EMPHASIS_MARK_NAMES;
  for (const mark of childrenOfType(node, markNames)) {
    decorations.push(hideMarkDecoration.range(mark.from, mark.to));
  }
}

function revealRange(view: EditorView, node: SyntaxNode) {
  if (node.name.startsWith("ATXHeading")) {
    const line = view.state.doc.lineAt(node.from);
    return { from: line.from, to: line.to };
  }
  return { from: node.from, to: node.to };
}

function selectionTouches(view: EditorView, range: { from: number; to: number }) {
  return view.state.selection.ranges.some(
    (selectionRange) => selectionRange.to >= range.from && selectionRange.from <= range.to,
  );
}

function childrenOfType(node: SyntaxNode, names: readonly string[]) {
  const children: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (names.includes(child.name)) {
      children.push(child);
    }
  }
  return children;
}
