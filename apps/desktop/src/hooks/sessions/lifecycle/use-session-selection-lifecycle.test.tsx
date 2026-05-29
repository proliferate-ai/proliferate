// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionSelectionLifecycle } from "./use-session-selection-lifecycle";

const persistenceMocks = vi.hoisted(() => ({
  readPersistedValue: vi.fn(),
  persistValue: vi.fn(),
}));

vi.mock("@/lib/infra/persistence/preferences-persistence", () => ({
  readPersistedValue: persistenceMocks.readPersistedValue,
  persistValue: persistenceMocks.persistValue,
}));

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
    persistenceMocks.readPersistedValue.mockReset();
    persistenceMocks.persistValue.mockReset();
    persistenceMocks.readPersistedValue.mockResolvedValue(null);
    persistenceMocks.persistValue.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("hydrates the persisted logical workspace id", async () => {
    persistenceMocks.readPersistedValue.mockResolvedValue("logical-workspace-1");

    renderHook(() => useSessionSelectionLifecycle());

    await waitFor(() => {
      expect(useSessionSelectionStore.getState()._hydrated).toBe(true);
    });
    expect(useSessionSelectionStore.getState().selectedLogicalWorkspaceId)
      .toBe("logical-workspace-1");
    expect(persistenceMocks.persistValue).not.toHaveBeenCalled();
  });

  it("normalizes persisted pending workspace ids to null", async () => {
    persistenceMocks.readPersistedValue.mockResolvedValue("pending-workspace:abc");

    renderHook(() => useSessionSelectionLifecycle());

    await waitFor(() => {
      expect(useSessionSelectionStore.getState()._hydrated).toBe(true);
    });
    expect(useSessionSelectionStore.getState().selectedLogicalWorkspaceId).toBeNull();
    expect(persistenceMocks.persistValue).not.toHaveBeenCalled();
  });

  it("persists stable selection changes after hydration", async () => {
    renderHook(() => useSessionSelectionLifecycle());

    await waitFor(() => {
      expect(useSessionSelectionStore.getState()._hydrated).toBe(true);
    });

    act(() => {
      useSessionSelectionStore.getState().setSelectedLogicalWorkspaceId("logical-workspace-2");
    });
    await waitFor(() => {
      expect(persistenceMocks.persistValue).toHaveBeenCalledWith(
        "selected_logical_workspace_id",
        "logical-workspace-2",
      );
    });
  });

  it("skips transient pending workspace ids when persisting live state", async () => {
    persistenceMocks.readPersistedValue.mockResolvedValue("logical-workspace-1");
    renderHook(() => useSessionSelectionLifecycle());

    await waitFor(() => {
      expect(useSessionSelectionStore.getState()._hydrated).toBe(true);
    });

    act(() => {
      useSessionSelectionStore.getState().setSelectedLogicalWorkspaceId("pending-workspace:abc");
    });
    await flushAsyncWork();

    expect(persistenceMocks.persistValue).not.toHaveBeenCalled();
  });

  it("persists null when stable selection is cleared", async () => {
    persistenceMocks.readPersistedValue.mockResolvedValue("logical-workspace-1");
    renderHook(() => useSessionSelectionLifecycle());

    await waitFor(() => {
      expect(useSessionSelectionStore.getState()._hydrated).toBe(true);
    });

    act(() => {
      useSessionSelectionStore.getState().setSelectedLogicalWorkspaceId(null);
    });
    await waitFor(() => {
      expect(persistenceMocks.persistValue).toHaveBeenCalledWith(
        "selected_logical_workspace_id",
        null,
      );
    });
  });

  it("does not hydrate or subscribe after unmounting before the read completes", async () => {
    let resolveRead: (value: string) => void = () => {};
    persistenceMocks.readPersistedValue.mockReturnValue(new Promise((resolve) => {
      resolveRead = resolve;
    }));

    const rendered = renderHook(() => useSessionSelectionLifecycle());
    rendered.unmount();

    await act(async () => {
      resolveRead("logical-workspace-1");
      await flushAsyncWork();
    });

    expect(useSessionSelectionStore.getState()._hydrated).toBe(false);
    expect(useSessionSelectionStore.getState().selectedLogicalWorkspaceId).toBeNull();
    expect(persistenceMocks.persistValue).not.toHaveBeenCalled();
  });
});
