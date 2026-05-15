export interface ScratchMarkdownEnterInput {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface ScratchMarkdownEnterResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

const LIST_LINE_PATTERN = /^(\s*)([-*])\s+(?:(\[([ xX])\])(?:\s+(.*))?|(.*))$/;

export function applyScratchMarkdownEnterAutoformat({
  value,
  selectionStart,
  selectionEnd,
}: ScratchMarkdownEnterInput): ScratchMarkdownEnterResult | null {
  const start = clampOffset(selectionStart, value.length);
  const end = clampOffset(selectionEnd, value.length);
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const lineEndIndex = value.indexOf("\n", start);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  const line = value.slice(lineStart, lineEnd);
  const match = LIST_LINE_PATTERN.exec(line);

  if (!match) {
    return null;
  }

  const indent = match[1] ?? "";
  const marker = match[2] ?? "-";
  const taskState = match[4];
  const body = match[5] ?? match[6] ?? "";
  const prefixLength = taskState === undefined
    ? indent.length + marker.length + 1
    : indent.length + marker.length + 1 + 3;
  const caretColumn = start - lineStart;

  if (caretColumn < prefixLength) {
    return null;
  }

  if (body.trim().length === 0) {
    const next = `${value.slice(0, lineStart)}${indent}${value.slice(lineEnd)}`;
    const caret = lineStart + indent.length;
    return {
      value: next,
      selectionStart: caret,
      selectionEnd: caret,
    };
  }

  const nextMarker = taskState === undefined
    ? `${indent}${marker} `
    : `${indent}${marker} [ ] `;
  const insertion = `\n${nextMarker}`;
  const next = `${value.slice(0, start)}${insertion}${value.slice(end)}`;
  const caret = start + insertion.length;

  return {
    value: next,
    selectionStart: caret,
    selectionEnd: caret,
  };
}

function clampOffset(value: number, max: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(Math.max(Math.trunc(value), 0), max);
}
