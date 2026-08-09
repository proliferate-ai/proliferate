import { useEffect } from "react";
import {
  $createTextNode,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  PASTE_COMMAND,
  type RangeSelection,
} from "lexical";
import { $createLinkNode, $toggleLink } from "@lexical/link";
import {
  $generateNodesFromMarkdownString,
  type Transformer,
} from "@lexical/markdown";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  containsCompleteComposerCodeFence,
  isComposerOffsetInsideOpenCodeFence,
} from "#product/components/workspace/chat/input/ComposerCodeFenceMarkdown";
import {
  isComposerSelectionPointInsideCode,
  selectComposerContinuationAfter,
} from "#product/components/workspace/chat/input/ComposerEditorDocument";

const EXACT_HTTPS_URL = /^https:\/\/[^\s]+$/u;
const MARKDOWN_HTTPS_LINK =
  /\[([^\]\r\n]+)\]\((https:\/\/[^\s)\r\n]+)\)/gu;
const MARKDOWN_LIST_ITEM =
  /(?:^|\r?\n)[\t ]{0,3}(?:[-+*]|\d+\.)[\t ]+\S/gu;

type ComposerPastePart =
  | { kind: "text"; value: string }
  | { kind: "link"; label: string; url: string };

export function isExactHttpsComposerPaste(value: string): boolean {
  return EXACT_HTTPS_URL.test(value);
}

export function parseMarkdownHttpsComposerPaste(
  value: string,
): ComposerPastePart[] | null {
  const parts: ComposerPastePart[] = [];
  let cursor = 0;
  let containsLink = false;

  for (const match of value.matchAll(MARKDOWN_HTTPS_LINK)) {
    const matchIndex = match.index;
    const label = match[1];
    const url = match[2];
    if (matchIndex === undefined || label === undefined || url === undefined) {
      continue;
    }
    if (matchIndex > cursor) {
      parts.push({ kind: "text", value: value.slice(cursor, matchIndex) });
    }
    parts.push({ kind: "link", label, url });
    containsLink = true;
    cursor = matchIndex + match[0].length;
  }

  if (!containsLink) return null;
  if (cursor < value.length) {
    parts.push({ kind: "text", value: value.slice(cursor) });
  }
  return parts;
}

export function isComposerLinkPaste(value: string): boolean {
  return isExactHttpsComposerPaste(value)
    || parseMarkdownHttpsComposerPaste(value) !== null;
}

export function isComposerMarkdownListPaste(value: string): boolean {
  MARKDOWN_LIST_ITEM.lastIndex = 0;
  return MARKDOWN_LIST_ITEM.test(value);
}

export function isComposerMarkdownCodeBlockPaste(value: string): boolean {
  return containsCompleteComposerCodeFence(value);
}

function isComposerIncompleteCodeFencePaste(value: string): boolean {
  return isComposerOffsetInsideOpenCodeFence(value, value.length);
}

export function isComposerFormattedPaste(value: string): boolean {
  return isComposerLinkPaste(value)
    || isComposerMarkdownListPaste(value)
    || isComposerMarkdownCodeBlockPaste(value)
    || isComposerIncompleteCodeFencePaste(value);
}

export function ComposerLinkPastePlugin({
  markdownTransformers,
}: {
  markdownTransformers: Transformer[];
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const unregisterCommand = editor.registerCommand(PASTE_COMMAND, (event) => {
      if (event.defaultPrevented) return false;
      const clipboard = "clipboardData" in event ? event.clipboardData : null;
      if ((clipboard?.files?.length ?? 0) > 0) return false;
      const value = clipboard?.getData("text/plain") ?? "";
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return false;
      if (composerSelectionIsInsideCode(selection)) {
        event.preventDefault();
        selection.insertRawText(value);
        return true;
      }

      const markdownParts = parseMarkdownHttpsComposerPaste(value);
      const isExactUrl = isExactHttpsComposerPaste(value);
      const isMarkdownList = isComposerMarkdownListPaste(value);
      const isMarkdownCodeBlock = isComposerMarkdownCodeBlockPaste(value);
      const isIncompleteCodeFence = isComposerIncompleteCodeFencePaste(value);
      if (
        !isExactUrl
        && markdownParts === null
        && !isMarkdownList
        && !isMarkdownCodeBlock
        && !isIncompleteCodeFence
      ) return false;

      event.preventDefault();

      if (isExactUrl) {
        if (!selection.isCollapsed()) {
          $toggleLink(value);
          return true;
        }
        const link = $createLinkNode(value);
        link.append($createTextNode(value));
        $insertNodes([link]);
        link.selectEnd();
        return true;
      }

      // Import authored block fragments together. The code transformer keeps
      // an incomplete fence in one paragraph with soft line breaks, so typing
      // its closing fence later can still promote the whole fragment.
      if (isMarkdownList || isMarkdownCodeBlock || isIncompleteCodeFence) {
        const nodes = $generateNodesFromMarkdownString(
          value,
          markdownTransformers,
        );
        $insertNodes(nodes);
        selectComposerContinuationAfter(nodes);
        return true;
      }

      const nodes = markdownParts!.map((part) => {
        if (part.kind === "text") return $createTextNode(part.value);
        const link = $createLinkNode(part.url);
        link.append($createTextNode(part.label));
        return link;
      });
      $insertNodes(nodes);
      nodes[nodes.length - 1]?.selectEnd();
      return true;
    }, COMMAND_PRIORITY_HIGH);

    // WebKit does not consistently route a native contenteditable paste
    // through Lexical's command bridge. Dispatch the same command from the
    // editor root as a fallback; defaultPrevented keeps this idempotent when
    // Lexical already handled the event.
    const handleNativePaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented) return;
      if ((event.clipboardData?.files?.length ?? 0) > 0) return;
      const value = event.clipboardData?.getData("text/plain") ?? "";
      let selectionInsideCode = false;
      editor.getEditorState().read(() => {
        const selection = $getSelection();
        selectionInsideCode = $isRangeSelection(selection)
          && composerSelectionIsInsideCode(selection);
      });
      if (!selectionInsideCode && !isComposerFormattedPaste(value)) return;
      if (editor.dispatchCommand(PASTE_COMMAND, event)) {
        event.stopPropagation();
      }
    };
    const unregisterRootListener = editor.registerRootListener((root, previousRoot) => {
      previousRoot?.removeEventListener("paste", handleNativePaste);
      root?.addEventListener("paste", handleNativePaste);
    });

    return () => {
      unregisterRootListener();
      unregisterCommand();
    };
  }, [editor, markdownTransformers]);

  return null;
}

function composerSelectionIsInsideCode(
  selection: RangeSelection,
): boolean {
  return isComposerSelectionPointInsideCode(
    selection.anchor.getNode(),
    selection.anchor.offset,
  ) || isComposerSelectionPointInsideCode(
    selection.focus.getNode(),
    selection.focus.offset,
  );
}
