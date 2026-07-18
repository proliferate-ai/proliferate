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
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

const EXACT_HTTPS_URL = /^https:\/\/[^\s]+$/u;
const MARKDOWN_HTTPS_LINK =
  /\[([^\]\r\n]+)\]\((https:\/\/[^\s)\r\n]+)\)/gu;

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

export function ComposerLinkPastePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => editor.registerCommand(PASTE_COMMAND, (event) => {
    const clipboard = "clipboardData" in event ? event.clipboardData : null;
    const value = clipboard?.getData("text/plain") ?? "";
    const markdownParts = parseMarkdownHttpsComposerPaste(value);
    const isExactUrl = isExactHttpsComposerPaste(value);
    if (!isExactUrl && markdownParts === null) return false;

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

    const nodes = markdownParts!.map((part) => {
      if (part.kind === "text") return $createTextNode(part.value);
      const link = $createLinkNode(part.url);
      link.append($createTextNode(part.label));
      return link;
    });
    $insertNodes(nodes);
    nodes[nodes.length - 1]?.selectEnd();
    return true;
  }, COMMAND_PRIORITY_HIGH), [editor]);

  return null;
}
