export type ScratchListKind = "bullet" | "ordered" | "task";

export interface ScratchListPrefix {
  kind: ScratchListKind;
  checked: boolean;
  indent: string;
  marker: string;
  prefixLength: number;
  checkboxOffset: number | null;
  body: string;
}

export interface ScratchListEnterInput {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface ScratchListEnterResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  changes: {
    from: number;
    to: number;
    insert: string;
  };
}

const MARKDOWN_LIST_LINE_PATTERN = /^(\s*)(?:(\d+[.)])|([-*]))\s+(?:(\[([ xX])\]\s+)(.*)|(.*))$/;
const LITERAL_LIST_LINE_PATTERN = /^(\s*)(?:([•◦])\s+|([☐☑])\s+)(.*)$/;

export function parseScratchMarkdownListPrefix(line: string): ScratchListPrefix | null {
  const match = MARKDOWN_LIST_LINE_PATTERN.exec(line);
  if (!match) {
    return null;
  }

  const indent = match[1] ?? "";
  const orderedMarker = match[2];
  const unorderedMarker = match[3];
  const marker = orderedMarker ?? unorderedMarker ?? "-";
  const checkboxToken = match[4];
  const taskState = match[5];
  const body = match[6] ?? match[7] ?? "";

  if (orderedMarker !== undefined) {
    return {
      kind: "ordered",
      checked: false,
      indent,
      marker,
      prefixLength: indent.length + marker.length + 1,
      checkboxOffset: null,
      body,
    };
  }

  if (taskState === undefined) {
    return {
      kind: "bullet",
      checked: false,
      indent,
      marker,
      prefixLength: indent.length + marker.length + 1,
      checkboxOffset: null,
      body,
    };
  }

  const checkboxOffset = indent.length + marker.length + 1 + 1;
  return {
    kind: "task",
    checked: taskState !== " ",
    indent,
    marker,
    prefixLength: indent.length + marker.length + 1 + (checkboxToken?.length ?? 3),
    checkboxOffset,
    body,
  };
}

export function applyScratchListEnterFormatting({
  value,
  selectionStart,
  selectionEnd,
}: ScratchListEnterInput): ScratchListEnterResult | null {
  const start = clampOffset(selectionStart, value.length);
  const end = clampOffset(selectionEnd, value.length);
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const lineEndIndex = value.indexOf("\n", start);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  const line = value.slice(lineStart, lineEnd);
  const markdownPrefix = parseScratchMarkdownListPrefix(line);
  const literalPrefix = parseLiteralListPrefix(line);
  const caretColumn = start - lineStart;

  if (markdownPrefix) {
    if (caretColumn < markdownPrefix.prefixLength) {
      return null;
    }
    return applyListEnter(value, start, end, lineStart, lineEnd, {
      indent: markdownPrefix.indent,
      marker: markerForNextMarkdownListItem(markdownPrefix),
      body: markdownPrefix.body,
      prefixLength: markdownPrefix.prefixLength,
    });
  }

  if (literalPrefix) {
    if (caretColumn < literalPrefix.prefixLength) {
      return null;
    }
    return applyListEnter(value, start, end, lineStart, lineEnd, literalPrefix);
  }

  return null;
}

function markerForNextMarkdownListItem(prefix: ScratchListPrefix) {
  if (prefix.kind === "task") {
    return `${prefix.marker} [ ] `;
  }
  if (prefix.kind === "ordered") {
    const number = Number(prefix.marker.slice(0, -1));
    const delimiter = prefix.marker.slice(-1);
    return `${number + 1}${delimiter} `;
  }
  return `${prefix.marker} `;
}

function parseLiteralListPrefix(line: string) {
  const match = LITERAL_LIST_LINE_PATTERN.exec(line);
  if (!match) {
    return null;
  }

  const indent = match[1] ?? "";
  const bulletMarker = match[2];
  const taskMarker = match[3];
  const body = match[4] ?? "";
  const marker = taskMarker ? "☐ " : `${bulletMarker ?? "•"} `;

  return {
    indent,
    marker,
    body,
    prefixLength: indent.length + marker.length,
  };
}

function applyListEnter(
  value: string,
  start: number,
  end: number,
  lineStart: number,
  lineEnd: number,
  prefix: {
    indent: string;
    marker: string;
    body: string;
    prefixLength: number;
  },
): ScratchListEnterResult {
  if (prefix.body.trim().length === 0) {
    const next = `${value.slice(0, lineStart)}${prefix.indent}${value.slice(lineEnd)}`;
    const caret = lineStart + prefix.indent.length;
    return {
      value: next,
      selectionStart: caret,
      selectionEnd: caret,
      changes: {
        from: lineStart,
        to: lineEnd,
        insert: prefix.indent,
      },
    };
  }

  const insertion = `\n${prefix.indent}${prefix.marker}`;
  const next = `${value.slice(0, start)}${insertion}${value.slice(end)}`;
  const caret = start + insertion.length;

  return {
    value: next,
    selectionStart: caret,
    selectionEnd: caret,
    changes: {
      from: start,
      to: end,
      insert: insertion,
    },
  };
}

function clampOffset(value: number, max: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(Math.max(Math.trunc(value), 0), max);
}
