import { describe, expect, it } from "vitest";
import type { GitChangedFile } from "@anyharness/sdk";
import {
  assembleCommitDiffText,
  commitDiffTargets,
} from "./commit-message-generation";

function file(path: string): GitChangedFile {
  return {
    path,
    oldPath: undefined,
    status: "modified",
    additions: 1,
    deletions: 0,
    binary: false,
    includedState: "included",
  };
}

describe("commitDiffTargets", () => {
  it("scopes to staged content when unstaged changes stay behind", () => {
    expect(commitDiffTargets({
      fileGroups: {
        staged: [file("a.ts")],
        partial: [file("b.ts")],
        unstaged: [file("c.ts")],
      },
      includeUnstaged: false,
    })).toEqual([
      { path: "a.ts", scope: "staged" },
      { path: "b.ts", scope: "staged" },
    ]);
  });

  it("covers the whole working tree once, when unstaged rides along", () => {
    const targets = commitDiffTargets({
      fileGroups: {
        staged: [file("a.ts")],
        partial: [file("b.ts")],
        unstaged: [file("b.ts"), file("c.ts")],
      },
      includeUnstaged: true,
    });
    expect(targets).toEqual([
      { path: "a.ts", scope: "working_tree" },
      { path: "b.ts", scope: "working_tree" },
      { path: "c.ts", scope: "working_tree" },
    ]);
  });
});

describe("assembleCommitDiffText", () => {
  it("concatenates patches and notes binary files", () => {
    const text = assembleCommitDiffText([
      { path: "a.ts", patch: "diff --git a\n+1", binary: false },
      { path: "img.png", patch: null, binary: true },
    ]);
    expect(text).toContain("diff --git a");
    expect(text).toContain("Binary file changed: img.png");
  });

  it("drops patches past the budget with an omission marker", () => {
    const text = assembleCommitDiffText(
      [
        { path: "a.ts", patch: "x".repeat(90), binary: false },
        { path: "b.ts", patch: "y".repeat(90), binary: false },
      ],
      100,
    );
    expect(text).toContain("x".repeat(90));
    expect(text).not.toContain("yyy");
    expect(text).toContain("[1 more changed file omitted]");
  });
});
