// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FILE_TREE_DOCK_STORAGE_KEY,
  LEGACY_FILE_TREE_OVERLAY_STORAGE_KEY,
} from "#product/lib/domain/files/file-tree-dock-state";
import {
  makeTestProductHost,
  productHostWrapper,
} from "#product/test/product-host-test-utils";
import {
  resetFileTreeStoreForTests,
  selectFileTreeDesiredWidth,
  selectFileTreeRequestedVisibility,
  useFileTreeStore,
} from "#product/stores/editor/file-tree-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { resetFileTreeDockPersistenceForTests } from "#product/hooks/workspaces/lifecycle/files/file-tree-dock-persistence-coordinator";
import { useFileTreeDockPersistenceLifecycle } from "#product/hooks/workspaces/lifecycle/files/use-file-tree-dock-persistence-lifecycle";
import {
  createFileTreeDockStorageHarness,
  type FileTreeDockStorageHarness,
} from "#product/hooks/workspaces/lifecycle/files/file-tree-dock-persistence-test-support";

const KEY = FILE_TREE_DOCK_STORAGE_KEY;

let harness: FileTreeDockStorageHarness;

function renderLifecycle(
  storageHarness: FileTreeDockStorageHarness = harness,
  captureException: (error: unknown) => void = () => {},
) {
  const host = makeTestProductHost({
    overrides: {
      storage: storageHarness.storage,
      telemetry: {
        captureException: captureException as never,
        captureMessage: (() => {}) as never,
        addBreadcrumb: (() => {}) as never,
      } as never,
    },
  });
  return renderHook(() => useFileTreeDockPersistenceLifecycle(), {
    wrapper: productHostWrapper(host),
  });
}

function store() {
  return useFileTreeStore.getState();
}

beforeEach(() => {
  cleanup();
  resetFileTreeStoreForTests();
  resetFileTreeDockPersistenceForTests();
  useSessionSelectionStore.getState().clearSelection();
  harness = createFileTreeDockStorageHarness();
});

afterEach(() => {
  cleanup();
  resetFileTreeStoreForTests();
  resetFileTreeDockPersistenceForTests();
  useSessionSelectionStore.getState().clearSelection();
});

describe("useFileTreeDockPersistenceLifecycle", () => {
  it("hydrates the dock record into synchronous store state", async () => {
    harness.seed(KEY, {
      version: 1,
      width: 520,
      requestedVisibilityByWorkspace: { "logical-1": true },
    });

    renderLifecycle();

    await waitFor(() => {
      expect(selectFileTreeDesiredWidth(store())).toBe(520);
    });
    expect(
      selectFileTreeRequestedVisibility(store(), {
        primaryKey: "logical-1",
        fallbackKey: null,
      }),
    ).toBe(true);
  });

  it("migrates the legacy width and removes the old key after the new write", async () => {
    harness.seed(LEGACY_FILE_TREE_OVERLAY_STORAGE_KEY, { width: 512 });

    renderLifecycle();

    await waitFor(() => {
      expect(harness.values.has(LEGACY_FILE_TREE_OVERLAY_STORAGE_KEY)).toBe(false);
    });
    expect(selectFileTreeDesiredWidth(store())).toBe(512);
    expect(harness.readJson(KEY)).toEqual({
      version: 1,
      width: 512,
      requestedVisibilityByWorkspace: {},
    });
  });

  it("relays user mutations to the serialized writer", async () => {
    const { unmount } = renderLifecycle();
    await waitFor(() => expect(harness.callCount("get", KEY)).toBe(1));

    store().setDesiredWidth(640);
    await waitFor(() => {
      expect(harness.readJson(KEY)).toEqual({
        version: 1,
        width: 640,
        requestedVisibilityByWorkspace: {},
      });
    });

    unmount();
    // A detached lifecycle performs no further hydration reads on remount of the
    // same storage authority beyond the retained lane's own work.
    store().setDesiredWidth(660);
    await Promise.resolve();
    expect(harness.readJson<{ width: number }>(KEY)?.width).toBe(640);
  });

  it("promotes the materialized fallback once the logical key is selected", async () => {
    useSessionSelectionStore.getState().activateWorkspace({
      logicalWorkspaceId: null,
      workspaceId: "ws-1",
    });
    const { rerender } = renderLifecycle();
    await waitFor(() => expect(harness.callCount("get", KEY)).toBe(1));

    store().setRequestedVisibility({ primaryKey: "ws-1", fallbackKey: "ws-1" }, true);
    await waitFor(() => {
      expect(harness.readJson(KEY)).toEqual({
        version: 1,
        width: 400,
        requestedVisibilityByWorkspace: { "ws-1": true },
      });
    });

    useSessionSelectionStore.getState().activateWorkspace({
      logicalWorkspaceId: "logical-1",
      workspaceId: "ws-1",
    });
    rerender();

    await waitFor(() => {
      expect(harness.readJson(KEY)).toEqual({
        version: 1,
        width: 400,
        requestedVisibilityByWorkspace: { "logical-1": true },
      });
    });
    expect(store().requestedVisibilityByWorkspace).toEqual({ "logical-1": true });
  });

  it("reuses one authority across a telemetry-only host refresh", async () => {
    const firstCapture = vi.fn();
    const { unmount } = renderLifecycle(harness, firstCapture);
    await waitFor(() => expect(harness.callCount("get", KEY)).toBe(1));
    unmount();

    const secondCapture = vi.fn();
    renderLifecycle(harness, secondCapture);
    await waitFor(() => expect(harness.callCount("get", KEY)).toBe(1));

    harness.failNext("set", KEY, 2);
    store().setDesiredWidth(500);
    await waitFor(() => expect(harness.callCount("set", KEY)).toBe(2));
    expect(firstCapture).not.toHaveBeenCalled();
    expect(secondCapture).toHaveBeenCalled();
    // Diagnostics stay categorical: no payload, key contents, or identifiers.
    expect(secondCapture.mock.calls[0][1]).toEqual({
      tags: {
        domain: "file_tree_dock_persistence",
        operation: "write",
        outcome: "failed",
      },
    });
    expect(selectFileTreeDesiredWidth(store())).toBe(500);
  });

  it("gives a different storage object an isolated authority", async () => {
    harness.seed(KEY, { version: 1, width: 300, requestedVisibilityByWorkspace: {} });
    const { unmount } = renderLifecycle();
    await waitFor(() => expect(selectFileTreeDesiredWidth(store())).toBe(300));
    unmount();

    const other = createFileTreeDockStorageHarness();
    other.seed(KEY, { version: 1, width: 900, requestedVisibilityByWorkspace: {} });
    renderLifecycle(other);

    await waitFor(() => expect(selectFileTreeDesiredWidth(store())).toBe(900));
    expect(other.callCount("get", KEY)).toBe(1);
  });
});
