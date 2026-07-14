// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import {
  createMemoryProductStorage,
  type MemoryProductStorage,
} from "@/test/product-storage-test-utils";
import {
  makeTestProductHost,
  productHostWrapper,
} from "@/test/product-host-test-utils";
import { useSessionSelectionLifecycle } from "./use-session-selection-lifecycle";

let memory: MemoryProductStorage;
let setItemSpy: MockInstance;
let removeItemSpy: MockInstance;

const SELECTION_KEY = "selected_logical_workspace_id";

function renderLifecycle() {
  const host = makeTestProductHost({ overrides: { storage: memory.storage } });
  return renderHook(() => useSessionSelectionLifecycle(), {
    wrapper: productHostWrapper(host),
  });
}

function resetSelectionStore(): void {
  useSessionSelectionStore.setState({
    _hydrated: false,
    pendingWorkspaceEntry: null,
    selectedLogicalWorkspaceId: null,
    selectedWorkspaceId: null,
    workspaceSelectionNonce: 0,
    workspaceArrivalEvent: null,
    activeSessionId: null,
    activeSessionVersion: 0,
    sessionActivationIntentEpochByWorkspace: {},
    hotPaintGate: null,
  });
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("useSessionSelectionLifecycle", () => {
  beforeEach(() => {
    cleanup();
    resetSelectionStore();
    memory = createMemoryProductStorage();
    setItemSpy = vi.spyOn(memory.storage, "setItem");
    removeItemSpy = vi.spyOn(memory.storage, "removeItem");
  });

  afterEach(() => {
    cleanup();
  });

  it("hydrates the persisted logical workspace id", async () => {
    memory.values.set(SELECTION_KEY, "logical-workspace-1");

    renderLifecycle();

    await waitFor(() => {
      expect(useSessionSelectionStore.getState()._hydrated).toBe(true);
    });
    expect(useSessionSelectionStore.getState().selectedLogicalWorkspaceId)
      .toBe("logical-workspace-1");
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(removeItemSpy).not.toHaveBeenCalled();
  });

  it("normalizes persisted pending workspace ids to null", async () => {
    memory.values.set(SELECTION_KEY, "pending-workspace:abc");

    renderLifecycle();

    await waitFor(() => {
      expect(useSessionSelectionStore.getState()._hydrated).toBe(true);
    });
    expect(useSessionSelectionStore.getState().selectedLogicalWorkspaceId).toBeNull();
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it("persists stable selection changes after hydration", async () => {
    renderLifecycle();

    await waitFor(() => {
      expect(useSessionSelectionStore.getState()._hydrated).toBe(true);
    });

    act(() => {
      useSessionSelectionStore.getState().setSelectedLogicalWorkspaceId("logical-workspace-2");
    });
    await waitFor(() => {
      expect(setItemSpy).toHaveBeenCalledWith(SELECTION_KEY, "logical-workspace-2");
    });
  });

  it("skips transient pending workspace ids when persisting live state", async () => {
    memory.values.set(SELECTION_KEY, "logical-workspace-1");
    renderLifecycle();

    await waitFor(() => {
      expect(useSessionSelectionStore.getState()._hydrated).toBe(true);
    });

    act(() => {
      useSessionSelectionStore.getState().setSelectedLogicalWorkspaceId("pending-workspace:abc");
    });
    await flushAsyncWork();

    expect(setItemSpy).not.toHaveBeenCalled();
    expect(removeItemSpy).not.toHaveBeenCalled();
  });

  it("removes the persisted key when stable selection is cleared", async () => {
    memory.values.set(SELECTION_KEY, "logical-workspace-1");
    renderLifecycle();

    await waitFor(() => {
      expect(useSessionSelectionStore.getState()._hydrated).toBe(true);
    });

    act(() => {
      useSessionSelectionStore.getState().setSelectedLogicalWorkspaceId(null);
    });
    await waitFor(() => {
      expect(removeItemSpy).toHaveBeenCalledWith(SELECTION_KEY);
    });
    expect(memory.values.has(SELECTION_KEY)).toBe(false);
  });

  it("does not hydrate or subscribe after unmounting before the read completes", async () => {
    let resolveRead: (value: string) => void = () => {};
    getItemSpyResolvingWith((resolve) => {
      resolveRead = resolve;
    });

    const rendered = renderLifecycle();
    rendered.unmount();

    await act(async () => {
      resolveRead("logical-workspace-1");
      await flushAsyncWork();
    });

    expect(useSessionSelectionStore.getState()._hydrated).toBe(false);
    expect(useSessionSelectionStore.getState().selectedLogicalWorkspaceId).toBeNull();
    expect(setItemSpy).not.toHaveBeenCalled();
  });
});

function getItemSpyResolvingWith(
  register: (resolve: (value: string) => void) => void,
): void {
  vi.spyOn(memory.storage, "getItem").mockImplementation(
    () =>
      new Promise<string | null>((resolve) => {
        register((value) => resolve(value));
      }),
  );
}
