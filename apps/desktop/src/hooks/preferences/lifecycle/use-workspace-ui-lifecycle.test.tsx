// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { useWorkspaceUiLifecycle } from "@/hooks/preferences/lifecycle/use-workspace-ui-lifecycle";
import {
  WORKSPACE_UI_DEFAULTS,
  WORKSPACE_UI_MIGRATION_VERSION,
  type PersistedWorkspaceUiState,
} from "@/lib/domain/preferences/workspace-ui/model";
import {
  useWorkspaceUiStore,
  type WorkspaceUiState,
} from "@/stores/preferences/workspace-ui-store";
import {
  createMemoryProductStorage,
  type MemoryProductStorage,
} from "@/test/product-storage-test-utils";
import {
  makeTestProductHost,
  productHostWrapper,
} from "@/test/product-host-test-utils";

let memory: MemoryProductStorage;
let getItemSpy: MockInstance;
let setItemSpy: MockInstance;

function renderLifecycle() {
  const host = makeTestProductHost({ overrides: { storage: memory.storage } });
  return renderHook(() => useWorkspaceUiLifecycle(), {
    wrapper: productHostWrapper(host),
  });
}

function currentWorkspaceUiState(): PersistedWorkspaceUiState {
  return {
    ...WORKSPACE_UI_DEFAULTS,
    migrationVersion: WORKSPACE_UI_MIGRATION_VERSION,
  };
}

function resetWorkspaceUiStore(): void {
  const {
    migrationVersion: _migrationVersion,
    ...current
  } = useWorkspaceUiStore.getState() as WorkspaceUiState & {
    migrationVersion?: number;
  };

  useWorkspaceUiStore.setState({
    ...current,
    ...WORKSPACE_UI_DEFAULTS,
    _hydrated: false,
    shellActivationEpochByWorkspace: {},
    pendingChatActivationByWorkspace: {},
    urgentHighlightedChatSessionByWorkspace: {},
  }, true);
}

describe("useWorkspaceUiLifecycle", () => {
  beforeEach(() => {
    cleanup();
    memory = createMemoryProductStorage();
    getItemSpy = vi.spyOn(memory.storage, "getItem");
    setItemSpy = vi.spyOn(memory.storage, "setItem");
    resetWorkspaceUiStore();
  });

  it("hydrates current workspace UI state without rewriting clean bootstrap data", async () => {
    memory.values.set("workspace_ui", {
      ...currentWorkspaceUiState(),
      archivedWorkspaceIds: ["workspace-a"],
      sidebarOpen: true,
    });

    renderLifecycle();

    await waitFor(() => {
      expect(useWorkspaceUiStore.getState()._hydrated).toBe(true);
    });

    expect(useWorkspaceUiStore.getState().archivedWorkspaceIds)
      .toEqual(["workspace-a"]);
    expect(useWorkspaceUiStore.getState().sidebarOpen).toBe(true);
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it("persists migrated legacy state and later workspace UI updates", async () => {
    memory.values.set("archivedWorkspaceIds", ["legacy-workspace"]);
    memory.values.set("lastViewedAt", {
      "legacy-workspace": "2026-01-01T00:00:00.000Z",
    });

    renderLifecycle();

    await waitFor(() => {
      expect(setItemSpy).toHaveBeenCalledTimes(1);
    });

    expect(getItemSpy).toHaveBeenCalledWith("archivedWorkspaceIds");
    expect(setItemSpy).toHaveBeenCalledWith("workspace_ui", expect.any(String));
    expect(memory.readJson("workspace_ui")).toEqual(
      expect.objectContaining({
        migrationVersion: WORKSPACE_UI_MIGRATION_VERSION,
        archivedWorkspaceIds: [],
        lastViewedAt: {},
      }),
    );

    setItemSpy.mockClear();

    act(() => {
      useWorkspaceUiStore.getState().setShowArchived(true);
    });

    await waitFor(() => {
      expect(setItemSpy).toHaveBeenCalledTimes(1);
    });

    expect(memory.readJson("workspace_ui")).toEqual(
      expect.objectContaining({
        migrationVersion: WORKSPACE_UI_MIGRATION_VERSION,
        showArchived: true,
      }),
    );
  });

  it("does not persist unhydrated-to-hydrated guard transitions", async () => {
    memory.values.set("workspace_ui", currentWorkspaceUiState());

    renderLifecycle();

    await waitFor(() => {
      expect(useWorkspaceUiStore.getState()._hydrated).toBe(true);
    });
    setItemSpy.mockClear();

    act(() => {
      useWorkspaceUiStore.setState({ _hydrated: false });
    });
    act(() => {
      useWorkspaceUiStore.getState().hydrate({
        ...currentWorkspaceUiState(),
        sidebarOpen: true,
      });
    });

    expect(useWorkspaceUiStore.getState().sidebarOpen).toBe(true);
    expect(setItemSpy).not.toHaveBeenCalled();
  });
});
