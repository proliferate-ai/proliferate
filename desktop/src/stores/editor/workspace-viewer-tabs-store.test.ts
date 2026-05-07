import { beforeEach, describe, expect, it } from "vitest";
import {
  allChangesViewerTarget,
  fileDiffViewerTarget,
  fileViewerTarget,
  viewerTargetKey,
} from "@/lib/domain/workspaces/viewer/viewer-target";
import { useWorkspaceViewerTabsStore } from "./workspace-viewer-tabs-store";

describe("workspace viewer tabs store", () => {
  beforeEach(() => {
    useWorkspaceViewerTabsStore.getState().reset();
  });

  it("renames file and diff targets under a moved path", () => {
    const fileTarget = fileViewerTarget("src/app.ts");
    const diffTarget = fileDiffViewerTarget({
      path: "src/nested/view.ts",
      oldPath: "old/view.ts",
      scope: "unstaged",
    });
    const allChangesTarget = allChangesViewerTarget({ scope: "working_tree_composite" });
    useWorkspaceViewerTabsStore.getState().prepareWorkspace({
      workspaceUiKey: "workspace-ui",
      materializedWorkspaceId: "workspace",
      anyharnessWorkspaceId: "workspace",
      runtimeUrl: "http://runtime",
      treeStateKey: "tree",
      initialOpenTargets: [fileTarget, diffTarget, allChangesTarget],
      initialActiveTargetKey: viewerTargetKey(diffTarget),
    });

    useWorkspaceViewerTabsStore.getState().renamePathReferences("src", "lib");

    expect(useWorkspaceViewerTabsStore.getState().openTargets).toEqual([
      fileViewerTarget("lib/app.ts"),
      fileDiffViewerTarget({
        path: "lib/nested/view.ts",
        oldPath: "old/view.ts",
        scope: "unstaged",
      }),
      allChangesTarget,
    ]);
    expect(useWorkspaceViewerTabsStore.getState().activeTargetKey).toBe(viewerTargetKey(
      fileDiffViewerTarget({
        path: "lib/nested/view.ts",
        oldPath: "old/view.ts",
        scope: "unstaged",
      }),
    ));
  });

  it("closes targets under a deleted path and falls back to the last remaining target", () => {
    const readmeTarget = fileViewerTarget("README.md");
    const deletedTarget = fileViewerTarget("src/app.ts");
    useWorkspaceViewerTabsStore.getState().prepareWorkspace({
      workspaceUiKey: "workspace-ui",
      materializedWorkspaceId: "workspace",
      anyharnessWorkspaceId: "workspace",
      runtimeUrl: "http://runtime",
      treeStateKey: "tree",
      initialOpenTargets: [readmeTarget, deletedTarget],
      initialActiveTargetKey: viewerTargetKey(deletedTarget),
    });

    useWorkspaceViewerTabsStore.getState().closePathReferences("src");

    expect(useWorkspaceViewerTabsStore.getState().openTargets).toEqual([readmeTarget]);
    expect(useWorkspaceViewerTabsStore.getState().activeTargetKey)
      .toBe(viewerTargetKey(readmeTarget));
  });
});
