import { useEffect } from "react";
import {
  $createTextNode,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  PASTE_COMMAND,
} from "lexical";
import { $createLinkNode, $toggleLink } from "@lexical/link";
import {
  $generateNodesFromMarkdownString,
  type Transformer,
} from "@lexical/markdown";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

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

export function isComposerFormattedPaste(value: string): boolean {
  return isComposerLinkPaste(value) || isComposerMarkdownListPaste(value);
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
      const value = clipboard?.getData("text/plain") ?? "";
      const markdownParts = parseMarkdownHttpsComposerPaste(value);
      const isExactUrl = isExactHttpsComposerPaste(value);
      const isMarkdownList = isComposerMarkdownListPaste(value);
      if (!isExactUrl && markdownParts === null && !isMarkdownList) return false;

      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return false;
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

      // A pasted Markdown list is an authored block, not a typed shortcut in
      // progress. Import the complete fragment so list structure and any inline
      // emphasis/links arrive together. Typed Markdown still follows the normal
      // shortcut contract because this path is paste-only.
      if (isMarkdownList) {
        const nodes = $generateNodesFromMarkdownString(
          value,
          markdownTransformers,
        );
        $insertNodes(nodes);
        nodes[nodes.length - 1]?.selectEnd();
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
      const value = event.clipboardData?.getData("text/plain") ?? "";
      if (!isComposerFormattedPaste(value)) return;
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
