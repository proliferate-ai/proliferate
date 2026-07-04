import type {
  CollapsedContext,
  DiffLine,
  InterHunkGap,
  ParsedPatch,
} from "@/lib/domain/files/diff-parser";

export type DiffLineDisplayType =
  | "context"
  | "change-addition"
  | "change-deletion";

export type ChatDiffRow =
  | { kind: "line"; key: string; line: DiffLine; hunkIndex: number; isHunkFirstRow: boolean }
  | { kind: "collapsed"; key: string; section: CollapsedContext; hunkIndex: number }
  | { kind: "gap"; key: string; gap: InterHunkGap; gapIndex: number };

export type SplitSide = "old" | "new";

export type SplitDiffRow =
  | {
      kind: "line";
      key: string;
      oldLine: DiffLine | null;
      newLine: DiffLine | null;
    }
  | { kind: "collapsed"; key: string; section: CollapsedContext }
  | { kind: "gap"; key: string; gap: InterHunkGap; gapIndex: number };

export function getDiffLineNumberColumnWidth(lineNumberDigits: number): string {
  return `max(40px, calc(${lineNumberDigits}ch + 1.5rem))`;
}

export function getChatLineType(line: DiffLine): DiffLineDisplayType {
  switch (line.type) {
    case "added":
      return "change-addition";
    case "removed":
      return "change-deletion";
    case "context":
      return "context";
  }
}

export function getChatLineNumber(line: DiffLine): number | null {
  if (line.type === "removed") {
    return line.oldLineNum;
  }
  return line.newLineNum ?? line.oldLineNum;
}

export function getDiffLineIndex(line: DiffLine): string {
  return `${line.oldLineNum ?? ""},${line.newLineNum ?? ""}`;
}

export function getChatDiffRows(
  parsed: ParsedPatch,
  expandedCollapsedKeys: ReadonlySet<string>,
): ChatDiffRow[] {
  const rows: ChatDiffRow[] = [];
  const gaps = parsed.interHunkGaps;

  parsed.hunks.forEach((hunk, hunkIndex) => {
    // Gap before this hunk
    if (gaps.length > 0) {
      const gap = gaps[hunkIndex];
      if (gap && gap.lineCount !== 0) {
        rows.push({ kind: "gap", key: `gap-${hunkIndex}`, gap, gapIndex: hunkIndex });
      }
    }

    let emittedHunkRow = false;
    hunk.items.forEach((item, itemIndex) => {
      const key = `${hunkIndex}-${itemIndex}`;
      if ("kind" in item && item.kind === "collapsed") {
        if (expandedCollapsedKeys.has(key)) {
          item.lines.forEach((line) => {
            rows.push({
              kind: "line",
              key: `${key}-${line.tokenIndex}`,
              line,
              hunkIndex,
              isHunkFirstRow: !emittedHunkRow,
            });
            emittedHunkRow = true;
          });
        } else {
          rows.push({ kind: "collapsed", key, section: item, hunkIndex });
          emittedHunkRow = true;
        }
        return;
      }

      const line = item as DiffLine;
      rows.push({
        kind: "line",
        key: `${key}-${line.tokenIndex}`,
        line,
        hunkIndex,
        isHunkFirstRow: !emittedHunkRow,
      });
      emittedHunkRow = true;
    });
  });

  // Gap after last hunk
  if (gaps.length > parsed.hunks.length) {
    const gap = gaps[parsed.hunks.length];
    if (gap && gap.lineCount !== 0) {
      rows.push({ kind: "gap", key: `gap-${parsed.hunks.length}`, gap, gapIndex: parsed.hunks.length });
    }
  }

  return rows;
}

export function getChatLineNumberDigits(rows: readonly ChatDiffRow[]): number {
  let maxLineNumber = 0;
  for (const row of rows) {
    if (row.kind !== "line") continue;
    maxLineNumber = Math.max(maxLineNumber, getChatLineNumber(row.line) ?? 0);
  }
  return Math.max(String(maxLineNumber).length, 1);
}

export function getSplitLineType(line: DiffLine): DiffLineDisplayType {
  switch (line.type) {
    case "added":
      return "change-addition";
    case "removed":
      return "change-deletion";
    case "context":
      return "context";
  }
}

export function getSplitEmptyLineType(
  peerLine: DiffLine | null,
): "change-addition" | "change-deletion" | undefined {
  if (!peerLine || peerLine.type === "context") {
    return undefined;
  }
  return peerLine.type === "added" ? "change-addition" : "change-deletion";
}

export function getSplitLineNumber(line: DiffLine, side: SplitSide): number | null {
  return side === "old" ? line.oldLineNum : line.newLineNum;
}

export function getSplitAltLineNumber(
  line: DiffLine,
  side: SplitSide,
): number | undefined {
  if (line.type !== "context") {
    return undefined;
  }
  return side === "old" ? line.newLineNum ?? undefined : line.oldLineNum ?? undefined;
}

export function getSplitDiffRows(
  parsed: ParsedPatch,
  expandedCollapsedKeys: ReadonlySet<string>,
): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];
  const gaps = parsed.interHunkGaps;

  parsed.hunks.forEach((hunk, hunkIndex) => {
    // Gap before this hunk
    if (gaps.length > 0) {
      const gap = gaps[hunkIndex];
      if (gap && gap.lineCount !== 0) {
        rows.push({ kind: "gap", key: `gap-${hunkIndex}`, gap, gapIndex: hunkIndex });
      }
    }

    hunk.items.forEach((item, itemIndex) => {
      const key = `${hunkIndex}-${itemIndex}`;
      if ("kind" in item && item.kind === "collapsed") {
        if (expandedCollapsedKeys.has(key)) {
          item.lines.forEach((line) => {
            rows.push({
              kind: "line",
              key: `${key}-${line.tokenIndex}`,
              oldLine: line,
              newLine: line,
            });
          });
        } else {
          rows.push({ kind: "collapsed", key, section: item });
        }
        return;
      }

      const line = item as DiffLine;
      rows.push({
        kind: "line",
        key: `${key}-${line.tokenIndex}`,
        oldLine: line.type === "added" ? null : line,
        newLine: line.type === "removed" ? null : line,
      });
    });
  });

  // Gap after last hunk
  if (gaps.length > parsed.hunks.length) {
    const gap = gaps[parsed.hunks.length];
    if (gap && gap.lineCount !== 0) {
      rows.push({ kind: "gap", key: `gap-${parsed.hunks.length}`, gap, gapIndex: parsed.hunks.length });
    }
  }

  return rows;
}

export function getSplitLineNumberDigits(
  rows: readonly SplitDiffRow[],
  side: SplitSide,
): number {
  let maxLineNumber = 0;
  for (const row of rows) {
    if (row.kind !== "line") continue;
    const line = side === "old" ? row.oldLine : row.newLine;
    if (!line) continue;
    maxLineNumber = Math.max(maxLineNumber, getSplitLineNumber(line, side) ?? 0);
  }
  return Math.max(String(maxLineNumber).length, 1);
}
