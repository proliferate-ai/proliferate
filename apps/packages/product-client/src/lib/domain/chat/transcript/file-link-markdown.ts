/**
 * CommonMark requires destinations containing spaces to be wrapped in angle
 * brackets or percent-encoded. Agent output is not always that careful. Keep
 * the stored transcript untouched and repair only explicit local-file links in
 * the render copy so `[label](/absolute/path with spaces.md)` remains a link.
 */
export function normalizeLocalFileLinkMarkdown(content: string): string {
  let result = "";
  let cursor = 0;
  let fencedCode: { marker: "`" | "~"; length: number } | null = null;

  while (cursor < content.length) {
    const lineStart = cursor === 0 || content[cursor - 1] === "\n";
    if (lineStart) {
      const fence = markdownFenceAt(content, cursor);
      if (fence && (
        fencedCode === null
        || (fence.marker === fencedCode.marker && fence.length >= fencedCode.length)
      )) {
        fencedCode = fencedCode === null
          ? { marker: fence.marker, length: fence.length }
          : null;
        const lineEnd = content.indexOf("\n", cursor);
        const end = lineEnd < 0 ? content.length : lineEnd + 1;
        result += content.slice(cursor, end);
        cursor = end;
        continue;
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

    if (content[cursor] !== "[" || content[cursor - 1] === "!") {
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

    const rawDestination = content.slice(labelEnd + 2, destinationEnd);
    const destination = rawDestination.trim();
    if (!destination.includes(" ") || !looksLikeLocalDestination(destination)) {
      result += content.slice(cursor, destinationEnd + 1);
      cursor = destinationEnd + 1;
      continue;
    }

    const label = content.slice(cursor + 1, labelEnd);
    result += `[${label}](<${destination.replace(/ /g, "%20")}>)`;
    cursor = destinationEnd + 1;
  }

  return result;
}

function looksLikeLocalDestination(destination: string): boolean {
  return (destination.startsWith("/") && !destination.startsWith("//"))
    || destination.startsWith("~/")
    || destination.startsWith("./")
    || destination.startsWith("../")
    || /^[a-zA-Z]:[\\/]/.test(destination);
}

function markdownFenceAt(
  content: string,
  lineStart: number,
): { marker: "`" | "~"; length: number } | null {
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
  return length >= 3 ? { marker, length } : null;
}

function markerRunLength(content: string, start: number, marker: string): number {
  let end = start;
  while (content[end] === marker) end += 1;
  return end - start;
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
