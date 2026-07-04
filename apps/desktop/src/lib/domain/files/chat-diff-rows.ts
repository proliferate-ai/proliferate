import type { DiffLine, InterHunkGap } from "@/lib/domain/files/diff-parser";
import type { ChatDiffRow } from "@/lib/domain/files/diff-view-rows";
import {
  clampGapReveal,
  resolveGapLineCount,
  type GapExpansionState,
} from "@/lib/domain/files/gap-expansion";

/** Flattened render row: either a data row from the diff or an expanded gap line */
export type ChatRenderRow =
  | ChatDiffRow
  | { kind: "expanded-gap-line"; key: string; line: DiffLine };

function makeGapContextLine(
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

export function flattenWithGapExpansion(
  rows: ChatDiffRow[],
  gapStates: Map<number, GapExpansionState>,
  fileLines: string[] | undefined,
): ChatRenderRow[] {
  const result: ChatRenderRow[] = [];
  for (const row of rows) {
    if (row.kind !== "gap") {
      result.push(row);
      continue;
    }

    // Resolve unknown trailing gap count against fetched file length
    const gap = resolveGapLineCount(row.gap, fileLines);
    if (!gap) continue;
    const resolvedRow: ChatDiffRow = gap === row.gap ? row : { ...row, gap };

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
      result.push({
        kind: "expanded-gap-line",
        key: `${row.key}-top-${i}`,
        line: makeGapContextLine(fileLines, gap, i),
      });
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
      result.push({
        kind: "expanded-gap-line",
        key: `${row.key}-bottom-${i}`,
        line: makeGapContextLine(fileLines, gap, i),
      });
    }
  }
  return result;
}
