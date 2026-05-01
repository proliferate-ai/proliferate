import { beforeEach, describe, expect, it } from "vitest";
import {
  useWorkspaceFilesStore,
  workspaceFileDiffPatchKey,
} from "./workspace-files-store";

describe("workspace files tab order", () => {
  beforeEach(() => {
    useWorkspaceFilesStore.getState().reset();
  });

  it("reorders open tabs without changing the active file tab", () => {
    const store = useWorkspaceFilesStore.getState();
    store.focusFileTab("a.ts");
    store.focusFileTab("b.ts");
    store.focusFileTab("c.ts");

    useWorkspaceFilesStore.getState().reorderOpenTabs(["c.ts", "a.ts", "b.ts"]);

    expect(useWorkspaceFilesStore.getState().openTabs).toEqual(["c.ts", "a.ts", "b.ts"]);
    expect(useWorkspaceFilesStore.getState().activeFilePath).toBe("c.ts");
  });

  it("stores scoped diff patches separately for the same file tab", () => {
    const store = useWorkspaceFilesStore.getState();
    store.setDiffTab("a.ts", "unstaged patch", { scope: "unstaged" });
    store.setDiffTab("a.ts", "staged patch", { scope: "staged" });

    const state = useWorkspaceFilesStore.getState();
    expect(state.tabDiffDescriptorsByPath["a.ts"]).toEqual({
      scope: "staged",
      baseRef: null,
      oldPath: null,
    });
    expect(state.tabPatches[workspaceFileDiffPatchKey("a.ts", { scope: "unstaged" })])
      .toBe("unstaged patch");
    expect(state.tabPatches[workspaceFileDiffPatchKey("a.ts", { scope: "staged" })])
      .toBe("staged patch");
  });
});
