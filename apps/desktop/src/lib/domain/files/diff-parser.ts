export type DiffLineType = "added" | "removed" | "context";

export interface DiffLine {
  type: DiffLineType;
  marker: "+" | "-" | " ";
  content: string;
  oldLineNum: number | null;
  newLineNum: number | null;
  /**
   * Single-column display number kept for existing non-chat diff renderers.
   * Chat diffs use `oldLineNum` / `newLineNum` directly.
   */
  lineNum: number | null;
  /** Index into the flat list of all code lines (for token lookup) */
  tokenIndex: number;
}

export interface CollapsedContext {
  kind: "collapsed";
  lineCount: number;
  lines: DiffLine[];
}

export interface DiffHunk {
  kind: "hunk";
  contextLabel: string;
  items: Array<DiffLine | CollapsedContext>;
}

/**
 * Represents a gap between hunks (or before the first / after the last hunk)
 * where lines exist in the file but are NOT included in the diff patch.
 */
export interface InterHunkGap {
  kind: "gap";
  /** 1-based old-side start line of the gap (inclusive) */
  oldStartLine: number;
  /** 1-based new-side start line of the gap (inclusive) */
  newStartLine: number;
  /** Number of unchanged lines in this gap */
  lineCount: number;
}

export interface ParsedPatch {
  hunks: DiffHunk[];
  /** All code lines (prefix-stripped) in order, for bulk highlighting */
  allCodeLines: string[];
  /**
   * Inter-hunk gaps: regions of unchanged lines between hunks (and before/after).
   * Length = hunks.length + 1 (gap[0] is before first hunk, gap[n] is after last).
   * A gap with lineCount === 0 means hunks are adjacent (no gap).
   * A gap with lineCount === -1 means unknown (e.g., gap after last hunk when
   * total file length is not available).
   */
  interHunkGaps: InterHunkGap[];
}

const HUNK_CONTEXT_RE = /^@@ .+? @@\s*(.*)$/;

function classifyLine(line: string): "added" | "removed" | "context" | "hunk" | "meta" {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+") && !line.startsWith("+++")) return "added";
  if (line.startsWith("-") && !line.startsWith("---")) return "removed";
  if (
    line.startsWith("diff ") ||
    line.startsWith("index ") ||
    line.startsWith("---") ||
    line.startsWith("+++")
  )
    return "meta";
  return "context";
}

function stripPrefix(content: string): string {
  if (content.length > 0 && (content[0] === "+" || content[0] === "-" || content[0] === " ")) {
    return content.slice(1);
  }
  return content;
}

/**
 * Collapse runs of context lines, keeping `keep` lines visible
 * adjacent to any non-context line.
 */
function collapseContextRuns(lines: DiffLine[], keep: number): Array<DiffLine | CollapsedContext> {
  const items: Array<DiffLine | CollapsedContext> = [];
  let contextRun: DiffLine[] = [];

  function flushContext() {
    if (contextRun.length === 0) return;

    if (contextRun.length <= keep * 2 + 1) {
      // Too short to collapse — show all
      items.push(...contextRun);
    } else {
      // Keep `keep` at start, collapse middle, keep `keep` at end
      const head = contextRun.slice(0, keep);
      const tail = contextRun.slice(-keep);
      const middle = contextRun.slice(keep, -keep);

      items.push(...head);
      items.push({
        kind: "collapsed",
        lineCount: middle.length,
        lines: middle,
      });
      items.push(...tail);
    }
    contextRun = [];
  }

  for (const line of lines) {
    if (line.type === "context") {
      contextRun.push(line);
    } else {
      flushContext();
      items.push(line);
    }
  }
  flushContext();

  return items;
}

const HUNK_RANGE_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parsePatch(patch: string, totalNewLines?: number): ParsedPatch {
  const hunks: DiffHunk[] = [];
  const allCodeLines: string[] = [];

  let currentLines: DiffLine[] = [];
  let currentLabel = "";
  let oldNum = 1;
  let newNum = 1;
  let tokenIndex = 0;

  // Track hunk start/end positions for inter-hunk gap computation
  interface HunkBounds {
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
  }
  const hunkBounds: HunkBounds[] = [];
  let pendingBounds: HunkBounds | null = null;

  function flushHunk() {
    if (currentLines.length === 0) return;
    hunks.push({
      kind: "hunk",
      contextLabel: currentLabel,
      items: collapseContextRuns(currentLines, 1),
    });
    if (pendingBounds) {
      hunkBounds.push(pendingBounds);
    }
    currentLines = [];
  }

  for (const raw of patch.split("\n")) {
    const cls = classifyLine(raw);

    if (cls === "meta") continue;

    if (cls === "hunk") {
      flushHunk();
      const match = HUNK_RANGE_RE.exec(raw);
      if (match) {
        oldNum = parseInt(match[1], 10);
        newNum = parseInt(match[3], 10);
        const oldCount = match[2] !== undefined ? parseInt(match[2], 10) : 1;
        const newCount = match[4] !== undefined ? parseInt(match[4], 10) : 1;
        pendingBounds = { oldStart: oldNum, oldCount, newStart: newNum, newCount };
      } else {
        pendingBounds = { oldStart: oldNum, oldCount: 0, newStart: newNum, newCount: 0 };
      }
      const ctxMatch = HUNK_CONTEXT_RE.exec(raw);
      currentLabel = ctxMatch?.[1]?.trim() ?? "";
      continue;
    }

    const content = stripPrefix(raw);
    allCodeLines.push(content);
    const idx = tokenIndex++;

    if (cls === "added") {
      currentLines.push({
        type: "added",
        marker: "+",
        content,
        oldLineNum: null,
        newLineNum: newNum,
        lineNum: newNum,
        tokenIndex: idx,
      });
      newNum++;
    } else if (cls === "removed") {
      currentLines.push({
        type: "removed",
        marker: "-",
        content,
        oldLineNum: oldNum,
        newLineNum: null,
        lineNum: oldNum,
        tokenIndex: idx,
      });
      oldNum++;
    } else {
      currentLines.push({
        type: "context",
        marker: " ",
        content,
        oldLineNum: oldNum,
        newLineNum: newNum,
        lineNum: newNum,
        tokenIndex: idx,
      });
      oldNum++;
      newNum++;
    }
  }

  flushHunk();

  // Compute inter-hunk gaps
  const interHunkGaps: InterHunkGap[] = [];

  if (hunkBounds.length === 0) {
    // No hunks — single gap representing the whole file
    interHunkGaps.push({
      kind: "gap",
      oldStartLine: 1,
      newStartLine: 1,
      lineCount: totalNewLines != null ? totalNewLines : -1,
    });
  } else {
    // Gap before first hunk
    const first = hunkBounds[0];
    const linesBeforeFirst = first.newStart - 1;
    interHunkGaps.push({
      kind: "gap",
      oldStartLine: 1,
      newStartLine: 1,
      lineCount: linesBeforeFirst,
    });

    // Gaps between hunks
    for (let i = 0; i < hunkBounds.length - 1; i++) {
      const prev = hunkBounds[i];
      const next = hunkBounds[i + 1];
      const prevOldEnd = prev.oldStart + prev.oldCount;
      const prevNewEnd = prev.newStart + prev.newCount;
      const gapLines = next.newStart - prevNewEnd;
      interHunkGaps.push({
        kind: "gap",
        oldStartLine: prevOldEnd,
        newStartLine: prevNewEnd,
        lineCount: Math.max(0, gapLines),
      });
    }

    // Gap after last hunk
    const last = hunkBounds[hunkBounds.length - 1];
    const lastNewEnd = last.newStart + last.newCount;
    const lastOldEnd = last.oldStart + last.oldCount;
    const linesAfterLast = totalNewLines != null ? totalNewLines - lastNewEnd + 1 : -1;
    interHunkGaps.push({
      kind: "gap",
      oldStartLine: lastOldEnd,
      newStartLine: lastNewEnd,
      lineCount: linesAfterLast,
    });
  }

  return { hunks, allCodeLines, interHunkGaps };
}
