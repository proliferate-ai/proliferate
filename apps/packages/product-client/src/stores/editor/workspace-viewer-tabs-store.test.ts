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

  it("mints monotonic location requests and consumes them exactly once", () => {
    const store = useWorkspaceViewerTabsStore.getState();
    const key = store.openTarget(fileViewerTarget("src/app.ts"));

    store.requestViewerLocation(key, 40);
    const first = useWorkspaceViewerTabsStore.getState().viewerLocationRequest;
    expect(first).toEqual({ targetKey: key, line: 40, token: 1 });

    store.consumeViewerLocationRequest(first!.token);
    expect(useWorkspaceViewerTabsStore.getState().viewerLocationRequest).toBeNull();

    // A repeat activation onto the identical line still mints a new token, so
    // the same-location repeat can retrigger the jump.
    store.requestViewerLocation(key, 40);
    expect(useWorkspaceViewerTabsStore.getState().viewerLocationRequest)
      .toEqual({ targetKey: key, line: 40, token: 2 });
  });

  it("a newer location request supersedes an unconsumed older one", () => {
    const store = useWorkspaceViewerTabsStore.getState();
    const key = store.openTarget(fileViewerTarget("src/app.ts"));

    store.requestViewerLocation(key, 10);
    const stale = useWorkspaceViewerTabsStore.getState().viewerLocationRequest!;
    store.requestViewerLocation(key, 20);
    const live = useWorkspaceViewerTabsStore.getState().viewerLocationRequest!;

    expect(live).toEqual({ targetKey: key, line: 20, token: stale.token + 1 });

    // The stale token from the superseded request is inert.
    store.consumeViewerLocationRequest(stale.token);
    expect(useWorkspaceViewerTabsStore.getState().viewerLocationRequest).toEqual(live);
  });

  it("invalidates an unconsumed location request when the active target changes", () => {
    const store = useWorkspaceViewerTabsStore.getState();
    const first = store.openTarget(fileViewerTarget("src/first.ts"));
    store.requestViewerLocation(first, 5);

    const second = store.openTarget(fileViewerTarget("src/second.ts"));
    expect(useWorkspaceViewerTabsStore.getState().viewerLocationRequest).toBeNull();

    // A stale consume for the invalidated token is inert.
    store.requestViewerLocation(second, 8);
    const live = useWorkspaceViewerTabsStore.getState().viewerLocationRequest!;
    store.consumeViewerLocationRequest(live.token - 1);
    expect(useWorkspaceViewerTabsStore.getState().viewerLocationRequest).toEqual(live);
  });

  it("drops a pending location request when its target is closed", () => {
    const store = useWorkspaceViewerTabsStore.getState();
    const key = store.openTarget(fileViewerTarget("src/app.ts"));
    store.requestViewerLocation(key, 12);

    store.closeTarget(key);

    expect(useWorkspaceViewerTabsStore.getState().viewerLocationRequest).toBeNull();
  });

  it("clears a pending location request on workspace reset", () => {
    const store = useWorkspaceViewerTabsStore.getState();
    const key = store.openTarget(fileViewerTarget("src/app.ts"));
    store.requestViewerLocation(key, 3);

    store.reset();

    expect(useWorkspaceViewerTabsStore.getState().viewerLocationRequest).toBeNull();
  });
});
