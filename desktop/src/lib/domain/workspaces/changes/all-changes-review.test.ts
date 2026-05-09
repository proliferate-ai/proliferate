import type { GitChangedFile, GitDiffFile } from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import {
  buildAllChangesRows,
  countAllChangesFiles,
  resolveAllChangesFrameHeader,
} from "./all-changes-review";

function changedFile(overrides: Partial<GitChangedFile>): GitChangedFile {
  return {
    path: "file.ts",
    oldPath: null,
    status: "modified",
    additions: 1,
    deletions: 0,
    binary: false,
    includedState: "excluded",
    ...overrides,
  };
}

function branchFile(overrides: Partial<GitDiffFile>): GitDiffFile {
  return {
    path: "branch.ts",
    oldPath: null,
    status: "modified",
    additions: 1,
    deletions: 0,
    binary: false,
    ...overrides,
  };
}

describe("all changes review domain", () => {
  it("builds working-tree rows as unstaged and staged sections", () => {
    const rows = buildAllChangesRows({
      branchFiles: [],
      collapsedFiles: new Set(),
      collapsedSections: new Set(),
      statusFiles: [
        changedFile({ path: "unstaged.ts", includedState: "excluded" }),
        changedFile({ path: "partial.ts", includedState: "partial" }),
        changedFile({ path: "staged.ts", includedState: "included" }),
      ],
      target: { scope: "working_tree_composite" },
    });

    expect(rows.map((row) => row.key)).toEqual([
      "section:unstaged",
      "file:unstaged::unstaged.ts:modified",
      "file:unstaged::partial.ts:modified",
      "section:staged",
      "file:staged::partial.ts:modified",
      "file:staged::staged.ts:modified",
    ]);
    expect(countAllChangesFiles(rows)).toBe(4);
  });

  it("marks collapsed sections and files without expanding hidden rows", () => {
    const rows = buildAllChangesRows({
      branchFiles: [
        branchFile({ path: "visible.ts" }),
        branchFile({ path: "collapsed.ts" }),
      ],
      collapsedFiles: new Set(["file:branch::collapsed.ts:modified"]),
      collapsedSections: new Set(["branch"]),
      statusFiles: [],
      target: { scope: "branch" },
    });

    expect(rows).toEqual([{
      kind: "section",
      key: "section:branch",
      sectionScope: "branch",
      label: "This branch",
      count: 2,
      collapsed: true,
    }]);
    expect(countAllChangesFiles(rows)).toBe(2);
  });

  it("resolves working tree and scoped headers", () => {
    expect(resolveAllChangesFrameHeader({ scope: "working_tree_composite" })).toEqual({
      title: "All changes",
      subtitle: "Working tree",
    });
    expect(resolveAllChangesFrameHeader({ scope: "branch" })).toEqual({
      title: "All this branch changes",
      subtitle: "This branch",
    });
  });
});
