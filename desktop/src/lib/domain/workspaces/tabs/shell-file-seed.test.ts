import { describe, expect, it } from "vitest";
import { fileViewerTarget } from "@/lib/domain/workspaces/viewer/viewer-target";
import { fileWorkspaceShellTabKey } from "./shell-tabs";
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
      shellOrderKeys: [
        "chat:s1",
        fileWorkspaceShellTabKey("src/App.tsx"),
        fileWorkspaceShellTabKey("README.md"),
      ],
      initialOpenTargets: [
        fileViewerTarget("src/App.tsx"),
        fileViewerTarget("README.md"),
      ],
      initialActiveTargetKey: fileWorkspaceShellTabKey("README.md"),
    });
  });

  it("does not restore active files for null, chat, invalid, or absent active keys", () => {
    for (const activeShellTabKey of [null, "chat:s1", "bad", "file:missing.ts"]) {
      expect(deriveWorkspaceFileTabSeed({
        shellOrderKeys: ["chat:s1", "file:src/App.tsx"],
        activeShellTabKey,
      }).initialActiveTargetKey).toBeNull();
    }
  });
});
