import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
} from "lexical";
import { CODE, type MultilineElementTransformer } from "@lexical/markdown";

const COMPOSER_CODE_FENCE_START = /^([ \t]*`{3,})([^`\r\n]*?)[ \t]*$/;
const COMPOSER_CODE_FENCE_END = /^[ \t]*(`{3,})[ \t]*$/;
const REQUIRED_CODE_FENCE_END = CODE.regExpEnd instanceof RegExp
  ? CODE.regExpEnd
  : CODE.regExpEnd?.regExp ?? COMPOSER_CODE_FENCE_END;

/** Whether Markdown contains a backtick fence with a matching closing line. */
export function containsCompleteComposerCodeFence(markdown: string): boolean {
  return findCompleteComposerCodeFence(markdown) !== null;
}

export interface CompleteComposerCodeFence {
  markdown: string;
  start: number;
  end: number;
}

/** Finds the first complete fence and the surrounding line breaks it replaces. */
export function findCompleteComposerCodeFence(
  markdown: string,
): CompleteComposerCodeFence | null {
  const lines = composerMarkdownLines(markdown);
  for (let index = 0; index < lines.length; index += 1) {
    const openingMatch = lines[index]!.text.match(COMPOSER_CODE_FENCE_START);
    if (!openingMatch) continue;
    const openingFenceLength = openingMatch[1]!.trim().length;
    for (let closingIndex = index + 1; closingIndex < lines.length; closingIndex += 1) {
      const closingLine = lines[closingIndex]!;
      const closingMatch = closingLine.text.match(COMPOSER_CODE_FENCE_END);
      if (!closingMatch || closingMatch[1]!.length < openingFenceLength) {
        continue;
      }
      const openingLine = lines[index]!;
      return {
        markdown: markdown.slice(openingLine.start, closingLine.end),
        start: openingLine.start,
        end: closingLine.end,
      };
    }
    return null;
  }
  return null;
}

/** Whether an offset falls after an opening fence with no matching close. */
export function isComposerOffsetInsideOpenCodeFence(
  markdown: string,
  offset: number,
): boolean {
  const lines = markdown.slice(0, offset).split(/\r?\n/);
  let openingFenceLength: number | null = null;

  for (const line of lines) {
    if (openingFenceLength === null) {
      const openingMatch = line.match(COMPOSER_CODE_FENCE_START);
      if (openingMatch) openingFenceLength = openingMatch[1]!.trim().length;
      continue;
    }
    const closingMatch = line.match(COMPOSER_CODE_FENCE_END);
    if (closingMatch && closingMatch[1]!.length >= openingFenceLength) {
      openingFenceLength = null;
    }
  }
  return openingFenceLength !== null;
}

/** Lexical's code transform with a required, length-compatible close fence. */
export const COMPOSER_CODE_TRANSFORMER: MultilineElementTransformer = {
  ...CODE,
  handleImportAfterStartMatch: (args) => {
    const openingFenceLength = args.startMatch[1]?.trim().length ?? 0;
    if (openingFenceLength < 3) return null;
    if (!hasMatchingComposerCodeFence(
      args.lines,
      args.startLineIndex,
      openingFenceLength,
    )) {
      const paragraph = $createParagraphNode();
      const remainingLines = args.lines.slice(args.startLineIndex);
      for (let index = 0; index < remainingLines.length; index += 1) {
        paragraph.append($createTextNode(remainingLines[index]!));
        if (index < remainingLines.length - 1) {
          paragraph.append($createLineBreakNode());
        }
      }
      args.rootNode.append(paragraph);
      return [true, args.lines.length - 1];
    }

    const normalizedStartMatch = Object.assign([...args.startMatch], {
      index: args.startMatch.index,
      input: args.startMatch.input,
    }) as RegExpMatchArray;
    normalizedStartMatch[2] = args.startMatch[2]?.trim() ?? "";
    return CODE.handleImportAfterStartMatch?.({
      ...args,
      startMatch: normalizedStartMatch,
      transformer: CODE,
    });
  },
  regExpEnd: REQUIRED_CODE_FENCE_END,
  regExpStart: COMPOSER_CODE_FENCE_START,
};

function hasMatchingComposerCodeFence(
  lines: readonly string[],
  openingLineIndex: number,
  openingFenceLength: number,
): boolean {
  for (let index = openingLineIndex + 1; index < lines.length; index += 1) {
    const closingMatch = lines[index]!.match(COMPOSER_CODE_FENCE_END);
    if (closingMatch && closingMatch[1]!.length >= openingFenceLength) {
      return true;
    }
  }
  return false;
}

function composerMarkdownLines(markdown: string) {
  const lines: Array<{ text: string; start: number; end: number }> = [];
  let start = 0;
  for (const text of markdown.split(/\r?\n/)) {
    const end = start + text.length;
    lines.push({ text, start, end });
    start = lineBreakEndAfter(markdown, end);
  }
  return lines;
}

function lineBreakEndAfter(markdown: string, offset: number): number {
  if (markdown.startsWith("\r\n", offset)) return offset + 2;
  return markdown[offset] === "\n" ? offset + 1 : offset;
}
