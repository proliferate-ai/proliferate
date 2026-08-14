/**
 * CommonMark requires destinations containing spaces to be wrapped in angle
 * brackets or percent-encoded. Agent output is not always that careful. Keep
 * the stored transcript untouched and repair only explicit local-file links in
 * the render copy so `[label](/absolute/path with spaces.md)` remains a link.
 *
 * This is a message-surface repair. A file viewer rendering a file's own bytes
 * must never run it (MarkdownBody gates the call on its `surface` prop), or
 * displayed file content would be silently rewritten.
 */
export function normalizeLocalFileLinkMarkdown(content: string): string {
  let result = "";
  let cursor = 0;
  let fencedCode: { marker: "`" | "~"; length: number } | null = null;
  // CommonMark opens an indented code block only after a blank line (or at the
  // very start of the document). A 4-space-indented *list continuation* does
  // not, and lists of file links are the main case this repair exists for, so
  // the blank-line predecessor is tracked rather than indentation alone.
  let previousLineBlank = true;
  let indentedCode = false;

  while (cursor < content.length) {
    const lineStart = cursor === 0 || content[cursor - 1] === "\n";
    if (lineStart) {
      const lineEnd = content.indexOf("\n", cursor);
      const lineStop = lineEnd < 0 ? content.length : lineEnd + 1;
      const fence = markdownFenceAt(content, cursor);
      if (fence && (fencedCode === null || closesFence(fence, fencedCode))) {
        fencedCode = fencedCode === null
          ? { marker: fence.marker, length: fence.length }
          : null;
        indentedCode = false;
        previousLineBlank = false;
        result += content.slice(cursor, lineStop);
        cursor = lineStop;
        continue;
      }

      if (!fencedCode) {
        const line = content.slice(cursor, lineStop);
        const blank = line.trim() === "";
        if (!blank) {
          indentedCode = INDENTED_CODE_LINE.test(line)
            && (previousLineBlank || indentedCode);
        }
        previousLineBlank = blank;
        if (indentedCode && !blank) {
          result += line;
          cursor = lineStop;
          continue;
        }
      }
    }

    if (fencedCode) {
      result += content[cursor];
      cursor += 1;
      continue;
    }

    if (content[cursor] === "`") {
      const runLength = markerRunLength(content, cursor, "`");
      const closing = content.indexOf("`".repeat(runLength), cursor + runLength);
      if (closing >= 0) {
        const end = closing + runLength;
        result += content.slice(cursor, end);
        cursor = end;
        continue;
      }
    }

    if (
      content[cursor] !== "["
      || content[cursor - 1] === "!"
      || isBackslashEscaped(content, cursor)
    ) {
      result += content[cursor];
      cursor += 1;
      continue;
    }

    const labelEnd = findBalancedClosing(content, cursor + 1, "[", "]");
    if (labelEnd < 0 || content[labelEnd + 1] !== "(") {
      result += content[cursor];
      cursor += 1;
      continue;
    }
    const destinationEnd = findBalancedClosing(content, labelEnd + 2, "(", ")");
    if (destinationEnd < 0) {
      result += content[cursor];
      cursor += 1;
      continue;
    }

    const repaired = repairLinkDestination(content.slice(labelEnd + 2, destinationEnd));
    if (repaired === null) {
      result += content.slice(cursor, destinationEnd + 1);
      cursor = destinationEnd + 1;
      continue;
    }

    const label = content.slice(cursor + 1, labelEnd);
    result += `[${label}](${repaired})`;
    cursor = destinationEnd + 1;
  }

  return result;
}

/**
 * A complete CommonMark link title closing the destination content: whitespace
 * followed by a balanced `"…"`, `'…'`, or `(…)` group at the very end. Only the
 * leading capture is the destination, so `[g](/a b/c.md "Read me")` keeps its
 * title outside the repaired angle brackets instead of folding it into the
 * href. Anything that is not a well-formed trailing title is left as part of
 * the destination.
 */
const TRAILING_LINK_TITLE =
  /^([\s\S]*?)\s+("(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|\((?:[^()\\]|\\[\s\S])*\))$/;

const INDENTED_CODE_LINE = /^(?: {4}|\t)/;

/**
 * The repaired `(…)` body for a link whose destination needs angle wrapping, or
 * null when the link must be left exactly as written.
 */
function repairLinkDestination(rawDestination: string): string | null {
  const trimmed = rawDestination.trim();
  const title = TRAILING_LINK_TITLE.exec(trimmed);
  const destination = title ? title[1] : trimmed;
  if (!destination.includes(" ")) {
    return null;
  }
  // Angle wrapping cannot express `<` or `>` in a destination, and these were
  // not links to begin with: leaving unrelated malformed Markdown untouched is
  // the contract.
  if (destination.includes("<") || destination.includes(">")) {
    return null;
  }
  if (!looksLikeLocalDestination(destination)) {
    return null;
  }
  const wrapped = `<${destination.replace(/ /g, "%20")}>`;
  return title ? `${wrapped} ${title[2]}` : wrapped;
}

function looksLikeLocalDestination(destination: string): boolean {
  return (destination.startsWith("/") && !destination.startsWith("//"))
    || destination.startsWith("~/")
    || destination.startsWith("./")
    || destination.startsWith("../")
    || /^[a-zA-Z]:[\\/]/.test(destination);
}

interface MarkdownFence {
  marker: "`" | "~";
  length: number;
  /** Whether the marker run is followed by nothing but whitespace. */
  bare: boolean;
}

/**
 * A closing fence carries no info string, so a `` ```md `` line inside a
 * `` ``` `` block is block content rather than its terminator.
 */
function closesFence(
  fence: MarkdownFence,
  open: { marker: "`" | "~"; length: number },
): boolean {
  return fence.marker === open.marker && fence.length >= open.length && fence.bare;
}

function markdownFenceAt(content: string, lineStart: number): MarkdownFence | null {
  let cursor = lineStart;
  let indentation = 0;
  while (content[cursor] === " " && indentation < 4) {
    indentation += 1;
    cursor += 1;
  }
  if (indentation > 3) return null;
  const marker = content[cursor];
  if (marker !== "`" && marker !== "~") return null;
  const length = markerRunLength(content, cursor, marker);
  if (length < 3) return null;
  const lineEnd = content.indexOf("\n", cursor + length);
  const info = content.slice(cursor + length, lineEnd < 0 ? content.length : lineEnd);
  return { marker, length, bare: info.trim() === "" };
}

function markerRunLength(content: string, start: number, marker: string): number {
  let end = start;
  while (content[end] === marker) end += 1;
  return end - start;
}

/** A `[` behind an odd run of backslashes is literal text, not a link start. */
function isBackslashEscaped(content: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && content[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function findBalancedClosing(
  content: string,
  start: number,
  opening: "[" | "(",
  closing: "]" | ")",
): number {
  let depth = 0;
  for (let cursor = start; cursor < content.length; cursor += 1) {
    const char = content[cursor];
    if (char === "\n") return -1;
    if (char === "\\") {
      cursor += 1;
      continue;
    }
    if (char === opening) {
      depth += 1;
    } else if (char === closing) {
      if (depth === 0) return cursor;
      depth -= 1;
    }
  }
  return -1;
}
