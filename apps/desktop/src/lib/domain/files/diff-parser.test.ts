import { describe, expect, it } from "vitest";
import { parsePatch } from "./diff-parser";

describe("parsePatch", () => {
  it("tracks old and new line numbers for unified diff lines", () => {
    const parsed = parsePatch(`diff --git a/a.ts b/a.ts
index 1111111..2222222 100644
--- a/a.ts
+++ b/a.ts
@@ -10,4 +20,5 @@ function run() {
 context before
-removed line
+added line
 context after`);

    const lines = parsed.hunks[0]?.items.filter((item) => !("kind" in item));

    expect(lines).toMatchObject([
      {
        type: "context",
        oldLineNum: 10,
        newLineNum: 20,
        lineNum: 20,
      },
      {
        type: "removed",
        oldLineNum: 11,
        newLineNum: null,
        lineNum: 11,
      },
      {
        type: "added",
        oldLineNum: null,
        newLineNum: 21,
        lineNum: 21,
      },
      {
        type: "context",
        oldLineNum: 12,
        newLineNum: 22,
        lineNum: 22,
      },
    ]);
  });

  it("resets old and new counters for multiple hunks", () => {
    const parsed = parsePatch(`@@ -1,2 +5,2 @@
 first
-old
+new
@@ -20,2 +30,2 @@
 again
-old again
+new again`);

    const secondHunkLines = parsed.hunks[1]?.items.filter((item) => !("kind" in item));

    expect(secondHunkLines).toMatchObject([
      {
        type: "context",
        oldLineNum: 20,
        newLineNum: 30,
      },
      {
        type: "removed",
        oldLineNum: 21,
        newLineNum: null,
      },
      {
        type: "added",
        oldLineNum: null,
        newLineNum: 31,
      },
    ]);
  });

  it("ignores metadata lines", () => {
    const parsed = parsePatch(`diff --git a/a.ts b/a.ts
index 1111111..2222222 100644
--- a/a.ts
+++ b/a.ts
@@ -3,1 +3,1 @@
-old
+new`);

    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.allCodeLines).toEqual(["old", "new"]);
  });

  it("uses one-based line numbers when a patch has no hunk header", () => {
    const parsed = parsePatch(`-old first
+new first
 unchanged`);

    const lines = parsed.hunks[0]?.items.filter((item) => !("kind" in item));

    expect(lines).toMatchObject([
      {
        type: "removed",
        oldLineNum: 1,
        newLineNum: null,
        lineNum: 1,
      },
      {
        type: "added",
        oldLineNum: null,
        newLineNum: 1,
        lineNum: 1,
      },
      {
        type: "context",
        oldLineNum: 2,
        newLineNum: 2,
        lineNum: 2,
      },
    ]);
  });

  it("computes inter-hunk gaps between hunks", () => {
    const parsed = parsePatch(`@@ -5,3 +5,3 @@
 context
-old
+new
@@ -20,3 +20,3 @@
 context
-old2
+new2`);

    expect(parsed.interHunkGaps).toHaveLength(3);
    // Gap before first hunk: lines 1..4
    expect(parsed.interHunkGaps[0]).toMatchObject({
      kind: "gap",
      oldStartLine: 1,
      newStartLine: 1,
      lineCount: 4,
    });
    // Gap between hunks: lines 8..19 (first hunk ends at new line 8, second starts at 20)
    expect(parsed.interHunkGaps[1]).toMatchObject({
      kind: "gap",
      oldStartLine: 8,
      newStartLine: 8,
      lineCount: 12,
    });
    // Gap after last hunk: unknown (-1) since totalNewLines not provided
    expect(parsed.interHunkGaps[2]).toMatchObject({
      kind: "gap",
      lineCount: -1,
    });
  });

  it("computes gap after last hunk when totalNewLines provided", () => {
    const parsed = parsePatch(`@@ -1,3 +1,3 @@
 context
-old
+new`, 10);

    // Gap before: 0 lines (hunk starts at line 1)
    expect(parsed.interHunkGaps[0]).toMatchObject({ lineCount: 0 });
    // Gap after: lines 4..10 = 7 lines
    expect(parsed.interHunkGaps[1]).toMatchObject({
      kind: "gap",
      newStartLine: 4,
      lineCount: 7,
    });
  });

  it("preserves line numbers and token indexes inside collapsed context", () => {
    const parsed = parsePatch(`@@ -1,8 +1,8 @@
 one
 two
 three
 four
 five
-six
+six changed
 seven
 eight`);

    const collapsed = parsed.hunks[0]?.items.find((item) => "kind" in item);

    expect(collapsed).toMatchObject({
      kind: "collapsed",
      lineCount: 3,
      lines: [
        { content: "two", oldLineNum: 2, newLineNum: 2, tokenIndex: 1 },
        { content: "three", oldLineNum: 3, newLineNum: 3, tokenIndex: 2 },
        { content: "four", oldLineNum: 4, newLineNum: 4, tokenIndex: 3 },
      ],
    });
  });
});
