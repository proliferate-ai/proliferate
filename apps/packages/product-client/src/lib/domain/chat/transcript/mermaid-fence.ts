/**
 * Mermaid fence detection for transcript Markdown.
 *
 * `MarkdownCode` already normalizes the fenced info string to the first
 * `[^\s]+` token after `language-`, so callers pass `mermaid` rather than
 * `language-mermaid`. This module never re-parses class names.
 *
 * Completeness cannot be read from HAST `node.position.end` alone: a closed
 * mermaid fence that is the last block of a still-streaming message also
 * ends at EOF, same as an unclosed fence. The helper therefore looks at the
 * render-copy source for a trailing mermaid opener that still has no closer.
 *
 * Identity of that trailing fence uses start position, not body equality.
 * Two fences can share a body; only the block whose start is at or after the
 * trailing opener is incomplete. End-at-EOF stays ambiguous; start offset
 * (or start line) is not.
 *
 * This is not a CommonMark fence parser. It only recognizes mermaid openers
 * and the closer of the mermaid fence currently open. Other languages are
 * ignored; a non-mermaid `language` returns false immediately.
 *
 * Opener grammar (the whole grammar):
 * - line starts with 0–3 spaces, then 3+ backticks or tildes (not mixed)
 * - optional spaces, then an info string whose first token is `mermaid`
 *   (case-insensitive)
 * - extra tokens after that first token are ignored when whitespace-separated
 *   (` ```mermaid foo ` counts; ` ```mermaid,foo ` does not)
 * - closer: same character as the opener, length ≥ opener, optional trailing
 *   spaces, no info string
 */

export function isMermaidLanguage(language: string | null | undefined): boolean {
  return language?.toLowerCase() === "mermaid";
}

export function isIncompleteStreamingMermaidFence({
  source,
  code,
  language,
  isStreaming,
  startOffset = null,
  startLine = null,
}: {
  source: string;
  code: string;
  language: string | null | undefined;
  isStreaming: boolean;
  startOffset?: number | null;
  startLine?: number | null;
}): boolean {
  if (!isStreaming || !isMermaidLanguage(language)) {
    return false;
  }
  const trailing = findTrailingUnclosedMermaidFence(source);
  if (trailing === null) {
    return false;
  }
  if (startOffset != null) {
    return startOffset >= trailing.startOffset;
  }
  if (startLine != null) {
    return startLine >= trailing.startLine;
  }
  return normalizeFenceBody(trailing.body) === normalizeFenceBody(code);
}

function findTrailingUnclosedMermaidFence(source: string): {
  body: string;
  startOffset: number;
  startLine: number;
} | null {
  const lines = source.split("\n");
  let open: {
    marker: string;
    length: number;
    body: string[];
    startOffset: number;
    startLine: number;
  } | null = null;
  let offset = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (open) {
      if (isFenceCloser(line, open.marker, open.length)) {
        open = null;
      } else {
        open.body.push(line);
      }
    } else {
      const opener = parseMermaidOpener(line);
      if (opener) {
        open = {
          marker: opener.marker,
          length: opener.length,
          body: [],
          startOffset: offset,
          startLine: index + 1,
        };
      }
    }
    offset += line.length;
    if (index < lines.length - 1) {
      offset += 1;
    }
  }

  if (!open) {
    return null;
  }
  return {
    body: open.body.join("\n"),
    startOffset: open.startOffset,
    startLine: open.startLine,
  };
}

function parseMermaidOpener(line: string): { marker: string; length: number } | null {
  const match = /^( {0,3})(`{3,}|~{3,})([ \t]*)(.*)$/.exec(line);
  if (!match) {
    return null;
  }
  const fence = match[2];
  const info = match[4] ?? "";
  const firstToken = info.trimStart().split(/[ \t]/, 1)[0] ?? "";
  if (firstToken.toLowerCase() !== "mermaid") {
    return null;
  }
  return { marker: fence[0], length: fence.length };
}

function isFenceCloser(line: string, marker: string, openerLength: number): boolean {
  const escaped = marker === "`" ? "\\`" : "~";
  const match = new RegExp(`^( {0,3})(${escaped}{3,})[ \\t]*$`).exec(line);
  if (!match) {
    return false;
  }
  const fence = match[2];
  return fence[0] === marker && fence.length >= openerLength;
}

function normalizeFenceBody(body: string): string {
  return body.replace(/\n$/, "");
}
