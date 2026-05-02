import { describe, expect, it } from "vitest";
import type { GitPanelFile } from "@/lib/domain/workspaces/git-panel-diff";
import { buildChangedFileTree } from "@/lib/domain/workspaces/changed-file-tree";

function changedFile(path: string): GitPanelFile {
  return {
    key: `:${path}:modified`,
    path,
    oldPath: null,
    displayPath: path,
    status: "modified",
    includedState: "excluded",
    additions: 1,
    deletions: 0,
    binary: false,
  };
}

describe("buildChangedFileTree", () => {
  it("preserves folder hierarchy for changed files", () => {
    const tree = buildChangedFileTree([
      changedFile("desktop/src/App.tsx"),
      changedFile("README.md"),
      changedFile("desktop/package.json"),
    ]);

    expect(tree).toMatchObject([
      {
        kind: "directory",
        name: "desktop",
        path: "desktop",
        children: [
          {
            kind: "directory",
            name: "src",
            path: "desktop/src",
            children: [
              {
                kind: "file",
                name: "App.tsx",
                path: "desktop/src/App.tsx",
              },
            ],
          },
          {
            kind: "file",
            name: "package.json",
            path: "desktop/package.json",
          },
        ],
      },
      {
        kind: "file",
        name: "README.md",
        path: "README.md",
      },
    ]);
  });
});
