import { describe, expect, it } from "vitest";
import {
  fileViewerTarget,
  promptAttachmentViewerTarget,
  viewerTargetKey,
} from "#product/lib/domain/workspaces/viewer/viewer-target";
import { fileWorkspaceShellTabKey } from "#product/lib/domain/workspaces/tabs/shell-tabs";
import { deriveWorkspaceFileTabSeed } from "#product/lib/domain/workspaces/tabs/shell-file-seed";

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

  it("does not restore session-local attachment preview targets", () => {
    const attachmentKey = viewerTargetKey(promptAttachmentViewerTarget({
      origin: "draft",
      attachmentId: "attachment:one",
      name: "notes.txt",
      mimeType: "text/plain",
      attachmentKind: "text_resource",
      attachmentSource: "paste",
      objectUrl: "blob:attachment-one",
    }));

    expect(deriveWorkspaceFileTabSeed({
      shellOrderKeys: ["chat:s1", attachmentKey, "file:README.md"],
      activeShellTabKey: attachmentKey,
      rightPanelHeaderOrderKeys: [attachmentKey],
      rightPanelActiveEntryKey: attachmentKey,
    })).toEqual({
      shellOrderKeys: ["chat:s1", fileWorkspaceShellTabKey("README.md")],
      initialOpenTargets: [fileViewerTarget("README.md")],
      initialActiveTargetKey: null,
    });
  });
});
