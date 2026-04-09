export type DiffLineType = "added" | "removed" | "context";

export interface DiffLine {
  type: DiffLineType;
  marker: "+" | "-" | " ";
  content: string;
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

export interface ParsedPatch {
  hunks: DiffHunk[];
  /** All code lines (prefix-stripped) in order, for bulk highlighting */
  allCodeLines: string[];
}

const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
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

export function parsePatch(patch: string): ParsedPatch {
  const hunks: DiffHunk[] = [];
  const allCodeLines: string[] = [];

  let currentLines: DiffLine[] = [];
  let currentLabel = "";
  let newNum = 0;
  let tokenIndex = 0;

  function flushHunk() {
    if (currentLines.length === 0) return;
    hunks.push({
      kind: "hunk",
      contextLabel: currentLabel,
      items: collapseContextRuns(currentLines, 1),
    });
    currentLines = [];
  }

  for (const raw of patch.split("\n")) {
    const cls = classifyLine(raw);

    if (cls === "meta") continue;

    if (cls === "hunk") {
      flushHunk();
      const match = HUNK_RE.exec(raw);
      if (match) {
        newNum = parseInt(match[1], 10);
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
        lineNum: newNum,
        tokenIndex: idx,
      });
      newNum++;
    } else if (cls === "removed") {
      currentLines.push({
        type: "removed",
        marker: "-",
        content,
        lineNum: null,
        tokenIndex: idx,
      });
    } else {
      currentLines.push({
        type: "context",
        marker: " ",
        content,
        lineNum: newNum,
        tokenIndex: idx,
      });
      newNum++;
    }
  }

  flushHunk();

  return { hunks, allCodeLines };
}
