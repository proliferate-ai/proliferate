import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceFilesStore } from "./workspace-files-store";

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
    expect(useWorkspaceFilesStore.getState().activeMainTab).toEqual({
      kind: "file",
      path: "c.ts",
    });
  });
});
