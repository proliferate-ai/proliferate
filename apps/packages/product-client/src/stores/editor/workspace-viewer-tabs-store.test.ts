import { beforeEach, describe, expect, it } from "vitest";
import {
  allChangesViewerTarget,
  fileDiffViewerTarget,
  fileViewerTarget,
  viewerTargetKey,
} from "#product/lib/domain/workspaces/viewer/viewer-target";
import { useWorkspaceViewerTabsStore } from "#product/stores/editor/workspace-viewer-tabs-store";

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
      initialOpenTargets: [readmeTarget, deletedTarget],
      initialActiveTargetKey: viewerTargetKey(deletedTarget),
    });

    useWorkspaceViewerTabsStore.getState().closePathReferences("src");

    expect(useWorkspaceViewerTabsStore.getState().openTargets).toEqual([readmeTarget]);
    expect(useWorkspaceViewerTabsStore.getState().activeTargetKey)
      .toBe(viewerTargetKey(readmeTarget));
  });

  it("mints monotonic focus requests and consumes them exactly once", () => {
    const store = useWorkspaceViewerTabsStore.getState();
    const key = store.openTarget(fileViewerTarget("src/app.ts"));

    store.requestViewerFocus(key);
    const first = useWorkspaceViewerTabsStore.getState().viewerFocusRequest;
    expect(first).toEqual({ targetKey: key, token: 1 });

    store.consumeViewerFocusRequest(first!.token);
    expect(useWorkspaceViewerTabsStore.getState().viewerFocusRequest).toBeNull();

    // A retrigger on the already-selected target still mints a new number.
    store.requestViewerFocus(key);
    expect(useWorkspaceViewerTabsStore.getState().viewerFocusRequest)
      .toEqual({ targetKey: key, token: 2 });
  });

  it("invalidates an unconsumed request when the active target changes", () => {
    const store = useWorkspaceViewerTabsStore.getState();
    const first = store.openTarget(fileViewerTarget("src/first.ts"));
    store.requestViewerFocus(first);

    const second = store.openTarget(fileViewerTarget("src/second.ts"));
    expect(useWorkspaceViewerTabsStore.getState().viewerFocusRequest).toBeNull();

    // A stale consume for the invalidated token is inert.
    store.requestViewerFocus(second);
    const live = useWorkspaceViewerTabsStore.getState().viewerFocusRequest!;
    store.consumeViewerFocusRequest(live.token - 1);
    expect(useWorkspaceViewerTabsStore.getState().viewerFocusRequest).toEqual(live);
  });

  it("drops a pending request when its target is closed", () => {
    const store = useWorkspaceViewerTabsStore.getState();
    const key = store.openTarget(fileViewerTarget("src/app.ts"));
    store.requestViewerFocus(key);

    store.closeTarget(key);

    expect(useWorkspaceViewerTabsStore.getState().viewerFocusRequest).toBeNull();
  });
});
