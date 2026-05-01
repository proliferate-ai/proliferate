import { describe, expect, it } from "vitest";
import { deriveWorkspaceFileTabSeed } from "./shell-file-seed";

describe("deriveWorkspaceFileTabSeed", () => {
  it("keeps valid chat and file shell keys while restoring only ordered file paths", () => {
    expect(deriveWorkspaceFileTabSeed({
      shellOrderKeys: [
        "chat:s1",
        "file:src/App.tsx",
        "bad",
        "file:src/App.tsx",
        "file:README.md",
      ],
      activeShellTabKey: "file:README.md",
    })).toEqual({
      shellOrderKeys: ["chat:s1", "file:src/App.tsx", "file:README.md"],
      initialOpenTabs: ["src/App.tsx", "README.md"],
      initialActiveFilePath: "README.md",
    });
  });

  it("does not restore active files for null, chat, invalid, or absent active keys", () => {
    for (const activeShellTabKey of [null, "chat:s1", "bad", "file:missing.ts"]) {
      expect(deriveWorkspaceFileTabSeed({
        shellOrderKeys: ["chat:s1", "file:src/App.tsx"],
        activeShellTabKey,
      }).initialActiveFilePath).toBeNull();
    }
  });
});
