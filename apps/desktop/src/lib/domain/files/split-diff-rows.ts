import type { DiffLine, InterHunkGap } from "@/lib/domain/files/diff-parser";
import type { SplitDiffRow } from "@/lib/domain/files/diff-view-rows";
import {
  clampGapReveal,
  resolveGapLineCount,
  type GapExpansionState,
} from "@/lib/domain/files/gap-expansion";

/** Flattened render row for split view */
export type SplitRenderRow =
  | SplitDiffRow
  | { kind: "expanded-gap-line"; key: string; oldLine: DiffLine; newLine: DiffLine };

function makeSplitGapContextLine(
  fileLines: string[],
  gap: InterHunkGap,
  offset: number,
): DiffLine {
  const newLine = gap.newStartLine + offset;
  return {
    type: "context",
    marker: " ",
    content: fileLines[newLine - 1] ?? "",
    oldLineNum: gap.oldStartLine + offset,
    newLineNum: newLine,
    lineNum: newLine,
    tokenIndex: -1,
  };
}

export function flattenSplitWithGapExpansion(
  rows: SplitDiffRow[],
  gapStates: Map<number, GapExpansionState>,
  fileLines: string[] | undefined,
): SplitRenderRow[] {
  const result: SplitRenderRow[] = [];
  for (const row of rows) {
    if (row.kind !== "gap") {
      result.push(row);
      continue;
    }

    // Resolve unknown trailing gap count against fetched file length
    const gap = resolveGapLineCount(row.gap, fileLines);
    if (!gap) continue;
    const resolvedRow: SplitDiffRow = gap === row.gap ? row : { ...row, gap };

    const state = gapStates.get(row.gapIndex);
    if (!fileLines || !state || gap.lineCount <= 0) {
      result.push(resolvedRow);
      continue;
    }

    const totalGapLines = gap.lineCount;
    const { top, bottom, fullyExpanded } = clampGapReveal(state, totalGapLines);
    if (top === 0 && bottom === 0) {
      result.push(resolvedRow);
      continue;
    }

    for (let i = 0; i < top; i++) {
      const line = makeSplitGapContextLine(fileLines, gap, i);
      result.push({ kind: "expanded-gap-line", key: `${row.key}-top-${i}`, oldLine: line, newLine: line });
    }

    if (!fullyExpanded) {
      const residualGap: InterHunkGap = {
        kind: "gap",
        oldStartLine: gap.oldStartLine + top,
        newStartLine: gap.newStartLine + top,
        lineCount: totalGapLines - top - bottom,
      };
      result.push({ kind: "gap", key: `${row.key}-residual`, gap: residualGap, gapIndex: row.gapIndex });
    }

    for (let i = totalGapLines - bottom; i < totalGapLines; i++) {
      const line = makeSplitGapContextLine(fileLines, gap, i);
      result.push({ kind: "expanded-gap-line", key: `${row.key}-bottom-${i}`, oldLine: line, newLine: line });
    }
  }
  return result;
}
