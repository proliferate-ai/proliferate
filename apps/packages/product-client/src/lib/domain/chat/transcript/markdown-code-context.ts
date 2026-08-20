/**
 * Character-level code-context mask for transcript Markdown.
 *
 * The transcript file-link scanner must never rewrite, close, or extract a
 * link that only *looks* like a link because it sits inside code. Building one
 * shared mask keeps the settled repair, the streaming-tail stabilizer, and the
 * end-resource extractor from drifting apart on that judgement.
 *
 * Masked regions are, in the order they are computed:
 *  - fenced code, by opener character and opener run length (backtick or
 *    tilde). A fence-like line carrying an info string while a fence is open is
 *    content, not a closer;
 *  - blank-line-introduced indented code, measured against the enclosing list
 *    item's content indent so nested-list continuation alone is not code;
 *  - inline code spans of one or more backticks, closed by a run of exactly the
 *    same length, never crossing a blank line.
 *
 * This is a deliberately small subset of CommonMark block parsing: it only has
 * to be conservative in the direction of "leave the source alone".
 */

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const LIST_MARKER = /^( *)(?:[-*+]|\d{1,9}[.)])( +)/;

interface OpenFence {
  char: string;
  length: number;
}

/** One boolean per source character: true when that character is code context. */
export function buildMarkdownCodeMask(source: string): boolean[] {
  const masked = new Array<boolean>(source.length).fill(false);
  maskBlockCode(source, masked);
  maskInlineCode(source, masked);
  return masked;
}

function maskBlockCode(source: string, masked: boolean[]): void {
  let offset = 0;
  let fence: OpenFence | null = null;
  let previousBlank = true;
  let indentedCode = false;
  let listContentIndent = 0;

  for (const line of source.split("\n")) {
    const lineStart = offset;
    offset += line.length + 1;

    if (fence) {
      maskRange(masked, lineStart, lineStart + line.length);
      if (closesFence(line, fence)) fence = null;
      continue;
    }

    const opened = openFence(line);
    if (opened) {
      fence = opened;
      maskRange(masked, lineStart, lineStart + line.length);
      previousBlank = false;
      indentedCode = false;
      continue;
    }

    if (line.trim().length === 0) {
      previousBlank = true;
      indentedCode = false;
      continue;
    }

    const indent = leadingIndentWidth(line);
    const codeIndent = listContentIndent + 4;
    if (previousBlank && indent >= codeIndent) {
      indentedCode = true;
    } else if (indent < codeIndent) {
      indentedCode = false;
    }

    if (indentedCode) {
      maskRange(masked, lineStart, lineStart + line.length);
    } else {
      const marker = LIST_MARKER.exec(line);
      if (marker) {
        listContentIndent = marker[0].length;
      } else if (indent <= listContentIndent && indent < codeIndent) {
        listContentIndent = 0;
      }
    }
    previousBlank = false;
  }
}

function openFence(line: string): OpenFence | null {
  const match = FENCE_OPEN.exec(line);
  if (!match) return null;
  const run = match[2];
  const info = match[3];
  // A backtick fence's info string may not contain a backtick; a tilde one may.
  if (run.startsWith("`") && info.includes("`")) return null;
  return { char: run[0], length: run.length };
}

function closesFence(line: string, fence: OpenFence): boolean {
  const match = /^ {0,3}(`+|~+)[ \t]*$/.exec(line);
  if (!match) return false;
  return match[1][0] === fence.char && match[1].length >= fence.length;
}

function leadingIndentWidth(line: string): number {
  let width = 0;
  for (const char of line) {
    if (char === " ") width += 1;
    else if (char === "\t") width += 4 - (width % 4);
    else break;
  }
  return width;
}

function maskInlineCode(source: string, masked: boolean[]): void {
  let index = 0;
  while (index < source.length) {
    if (masked[index] || source[index] !== "`") {
      index += 1;
      continue;
    }
    const openLength = backtickRunLength(source, index, masked);
    const close = findClosingBacktickRun(source, index + openLength, openLength, masked);
    if (close === null) {
      index += openLength;
      continue;
    }
    maskRange(masked, index, close + openLength);
    index = close + openLength;
  }
}

function backtickRunLength(source: string, start: number, masked: boolean[]): number {
  let end = start;
  while (end < source.length && source[end] === "`" && !masked[end]) end += 1;
  return end - start;
}

function findClosingBacktickRun(
  source: string,
  from: number,
  length: number,
  masked: boolean[],
): number | null {
  let index = from;
  let consecutiveNewlines = 0;
  while (index < source.length) {
    if (masked[index]) return null;
    if (source[index] === "\n") {
      consecutiveNewlines += 1;
      // An inline code span never spans a blank line.
      if (consecutiveNewlines > 1) return null;
      index += 1;
      continue;
    }
    if (source[index] !== "`") {
      consecutiveNewlines = 0;
      index += 1;
      continue;
    }
    const run = backtickRunLength(source, index, masked);
    if (run === length) return index;
    index += run;
    consecutiveNewlines = 0;
  }
  return null;
}

function maskRange(masked: boolean[], start: number, end: number): void {
  for (let index = start; index < end && index < masked.length; index += 1) {
    masked[index] = true;
  }
}
