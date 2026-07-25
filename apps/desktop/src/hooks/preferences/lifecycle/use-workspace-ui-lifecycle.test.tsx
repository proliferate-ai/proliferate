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

vi.mock("@/hooks/app/facade/use-product-storage-context", () => ({
  useProductStorageContext: () => ({}),
}));

vi.mock("@/lib/infra/persistence/product-storage", () => ({
  readProductStorageJson: (_context: unknown, key: string) =>
    persistenceMocks.readPersistedValue(key),
  writeProductStorageJson: (_context: unknown, key: string, value: unknown) =>
    persistenceMocks.persistValue(key, value),
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
    _persistenceRevision: 0,
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

  it("hydrates persisted settings despite a transient pending-chat action", async () => {
    let resolveRead: (value: unknown) => void = () => undefined;
    persistenceMocks.readPersistedValue.mockReturnValueOnce(new Promise((resolve) => {
      resolveRead = resolve;
    }));
    renderHook(() => useWorkspaceUiLifecycle());

    act(() => {
      useWorkspaceUiStore.getState().setPendingChatActivation({
        workspaceId: "workspace-1",
        pending: {
          attemptId: "attempt-1",
          sessionId: "session-1",
          intent: "chat:session-1",
          guardToken: 1,
          workspaceSelectionNonce: 1,
          shellEpochAtWrite: 1,
          sessionActivationEpochAtWrite: 1,
        },
      });
    });
    expect(useWorkspaceUiStore.getState()._persistenceRevision).toBe(0);

    await act(async () => resolveRead({
      ...currentWorkspaceUiState(),
      sidebarOpen: true,
    }));
    await waitFor(() => expect(useWorkspaceUiStore.getState()._hydrated).toBe(true));

    expect(useWorkspaceUiStore.getState().sidebarOpen).toBe(true);
    expect(
      useWorkspaceUiStore.getState()
        .pendingChatActivationByWorkspace["workspace-1"]?.attemptId,
    ).toBe("attempt-1");
    expect(persistenceMocks.persistValue).not.toHaveBeenCalled();
  });

  it("keeps the whole live workspace UI record when it changes during hydration", async () => {
    let resolveRead: (value: unknown) => void = () => undefined;
    persistenceMocks.readPersistedValue.mockReturnValueOnce(new Promise((resolve) => {
      resolveRead = resolve;
    }));

    renderHook(() => useWorkspaceUiLifecycle());
    act(() => useWorkspaceUiStore.getState().setShowArchived(true));
    await act(async () => resolveRead({
      ...currentWorkspaceUiState(),
      showArchived: false,
      sidebarOpen: true,
    }));
    await waitFor(() => expect(useWorkspaceUiStore.getState()._hydrated).toBe(true));

    expect(useWorkspaceUiStore.getState().showArchived).toBe(true);
    expect(useWorkspaceUiStore.getState().sidebarOpen)
      .toBe(WORKSPACE_UI_DEFAULTS.sidebarOpen);
    await waitFor(() => {
      expect(persistenceMocks.persistValue).toHaveBeenCalledWith(
        "workspace_ui",
        expect.objectContaining({
          showArchived: true,
          sidebarOpen: WORKSPACE_UI_DEFAULTS.sidebarOpen,
        }),
      );
    });
  });

  it("persists header-tab fallback materialization through the tracked action", async () => {
    persistenceMocks.values.set("workspace_ui", currentWorkspaceUiState());
    renderHook(() => useWorkspaceUiLifecycle());
    await waitFor(() => expect(useWorkspaceUiStore.getState()._hydrated).toBe(true));
    persistenceMocks.persistValue.mockClear();

    act(() => {
      useWorkspaceUiStore.getState().materializeWorkspaceHeaderTabFallbacks(
        "workspace-new",
        { visibleChatSessionIds: ["session-from-fallback"] },
      );
    });

    await waitFor(() => {
      expect(persistenceMocks.persistValue).toHaveBeenCalledWith(
        "workspace_ui",
        expect.objectContaining({
          visibleChatSessionIdsByWorkspace: {
            "workspace-new": ["session-from-fallback"],
          },
        }),
      );
    });
  });
});
