// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

const persistenceMocks = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  const readPersistedValue = vi.fn(async (key: string) => values.get(key));
  const persistValue = vi.fn(async (key: string, value: unknown) => {
    values.set(key, value);
  });

  return {
    values,
    readPersistedValue,
    persistValue,
  };
});

vi.mock("@/lib/infra/persistence/preferences-persistence", () => ({
  readPersistedValue: persistenceMocks.readPersistedValue,
  persistValue: persistenceMocks.persistValue,
}));

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
    persistenceMocks.values.clear();
    persistenceMocks.readPersistedValue.mockClear();
    persistenceMocks.persistValue.mockClear();
    resetWorkspaceUiStore();
  });

  it("hydrates current workspace UI state without rewriting clean bootstrap data", async () => {
    persistenceMocks.values.set("workspace_ui", {
      ...currentWorkspaceUiState(),
      archivedWorkspaceIds: ["workspace-a"],
      sidebarOpen: true,
    });

    renderHook(() => useWorkspaceUiLifecycle());

    await waitFor(() => {
      expect(useWorkspaceUiStore.getState()._hydrated).toBe(true);
    });

    expect(useWorkspaceUiStore.getState().archivedWorkspaceIds)
      .toEqual(["workspace-a"]);
    expect(useWorkspaceUiStore.getState().sidebarOpen).toBe(true);
    expect(persistenceMocks.persistValue).not.toHaveBeenCalled();
  });

  it("persists migrated legacy state and later workspace UI updates", async () => {
    persistenceMocks.values.set("archivedWorkspaceIds", ["legacy-workspace"]);
    persistenceMocks.values.set("lastViewedAt", {
      "legacy-workspace": "2026-01-01T00:00:00.000Z",
    });

    renderHook(() => useWorkspaceUiLifecycle());

    await waitFor(() => {
      expect(persistenceMocks.persistValue).toHaveBeenCalledTimes(1);
    });

    expect(persistenceMocks.readPersistedValue)
      .toHaveBeenCalledWith("archivedWorkspaceIds");
    expect(persistenceMocks.persistValue).toHaveBeenCalledWith(
      "workspace_ui",
      expect.objectContaining({
        migrationVersion: WORKSPACE_UI_MIGRATION_VERSION,
        archivedWorkspaceIds: [],
        lastViewedAt: {},
      }),
    );

    persistenceMocks.persistValue.mockClear();

    act(() => {
      useWorkspaceUiStore.getState().setShowArchived(true);
    });

    await waitFor(() => {
      expect(persistenceMocks.persistValue).toHaveBeenCalledTimes(1);
    });

    expect(persistenceMocks.persistValue).toHaveBeenCalledWith(
      "workspace_ui",
      expect.objectContaining({
        migrationVersion: WORKSPACE_UI_MIGRATION_VERSION,
        showArchived: true,
      }),
    );
  });

  it("does not persist unhydrated-to-hydrated guard transitions", async () => {
    persistenceMocks.values.set("workspace_ui", currentWorkspaceUiState());

    renderHook(() => useWorkspaceUiLifecycle());

    await waitFor(() => {
      expect(useWorkspaceUiStore.getState()._hydrated).toBe(true);
    });
    persistenceMocks.persistValue.mockClear();

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
    expect(persistenceMocks.persistValue).not.toHaveBeenCalled();
  });
});
