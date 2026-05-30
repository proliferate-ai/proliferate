import { describe, expect, it } from "vitest";
import type {
  GitPanelFile,
  GitPanelReviewFile,
} from "@/lib/domain/workspaces/changes/git-panel-diff";
import { buildChangedFileTree } from "@/lib/domain/workspaces/changes/changed-file-tree";

function changedFile(path: string): GitPanelReviewFile {
  const currentDiff: GitPanelFile = {
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
  return {
    key: currentDiff.key,
    path,
    oldPath: null,
    displayPath: path,
    currentDiff,
  };
}

describe("buildChangedFileTree", () => {
  it("preserves folder hierarchy for changed files", () => {
    const tree = buildChangedFileTree([
      changedFile("apps/desktop/src/App.tsx"),
      changedFile("README.md"),
      changedFile("apps/desktop/package.json"),
    ]);

    expect(tree).toMatchObject([
      {
        kind: "directory",
        name: "apps",
        path: "apps",
        children: [
          {
            kind: "directory",
            name: "desktop",
            path: "apps/desktop",
            children: [
              {
                kind: "directory",
                name: "src",
                path: "apps/desktop/src",
                children: [
                  {
                    kind: "file",
                    name: "App.tsx",
                    path: "apps/desktop/src/App.tsx",
                  },
                ],
              },
              {
                kind: "file",
                name: "package.json",
                path: "apps/desktop/package.json",
              },
            ],
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
