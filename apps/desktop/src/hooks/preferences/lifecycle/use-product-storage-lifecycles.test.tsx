// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useHomeNextTargetSelectionLifecycle } from "@/hooks/home/lifecycle/use-home-next-target-selection-lifecycle";
import {
  resetHomeNextTargetSelectionForTests,
  useHomeNextTargetSelectionState,
} from "@/hooks/home/ui/use-home-next-target-selection-state";
import {
  clearCloudDisplayNameBackfillSuppression,
  isCloudDisplayNameBackfillSuppressed,
  resetCloudDisplayNameBackfillSuppressionForTests,
  suppressCloudDisplayNameBackfill,
  useCloudDisplayNameBackfillSuppressionLifecycle,
} from "@/hooks/workspaces/lifecycle/cloud-display-name-backfill-suppression";
import {
  CHAT_DIFF_PREFERENCES_STORAGE_KEY,
  useChatDiffPreferencesStore,
} from "@/stores/chat/chat-diff-preferences-store";
import {
  FILE_TREE_DEFAULT_WIDTH,
  FILE_TREE_STORAGE_KEY,
  useFileTreeStore,
} from "@/stores/editor/file-tree-store";
import { useChatDiffPreferencesLifecycle } from "./use-chat-diff-preferences-lifecycle";
import { useFileTreePreferencesLifecycle } from "./use-file-tree-preferences-lifecycle";

const persistenceMocks = vi.hoisted(() => {
  const values = new Map<string, string>();
  const getItem = vi.fn(async (key: string) => values.get(key) ?? null);
  const setItem = vi.fn(async (key: string, value: string) => {
    values.set(key, value);
  });
  const removeItem = vi.fn(async (key: string) => {
    values.delete(key);
  });
  const captureException = vi.fn();
  const context = {
    storage: { getItem, setItem, removeItem },
    captureException,
  };
  return { values, getItem, setItem, removeItem, captureException, context };
});

vi.mock("@/hooks/app/facade/use-product-storage-context", () => ({
  useProductStorageContext: () => persistenceMocks.context,
}));

describe("small product persistence lifecycles", () => {
  beforeEach(() => {
    cleanup();
    persistenceMocks.values.clear();
    persistenceMocks.getItem.mockReset();
    persistenceMocks.getItem.mockImplementation(async (key: string) => (
      persistenceMocks.values.get(key) ?? null
    ));
    persistenceMocks.setItem.mockClear();
    persistenceMocks.removeItem.mockClear();
    persistenceMocks.captureException.mockReset();
    useChatDiffPreferencesStore.setState({
      wrapLongLines: false,
      _hydrated: false,
      _persistenceRevision: 0,
    });
    useFileTreeStore.setState({
      width: FILE_TREE_DEFAULT_WIDTH,
      _hydrated: false,
      _persistenceRevision: 0,
    });
    resetHomeNextTargetSelectionForTests();
    resetCloudDisplayNameBackfillSuppressionForTests();
  });

  afterEach(cleanup);

  it("hydrates chat preferences before subscribing and writes the exact record", async () => {
    persistenceMocks.values.set(
      CHAT_DIFF_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ wrapLongLines: true }),
    );
    renderHook(() => useChatDiffPreferencesLifecycle());

    await waitFor(() => {
      expect(useChatDiffPreferencesStore.getState()._hydrated).toBe(true);
    });
    expect(useChatDiffPreferencesStore.getState().wrapLongLines).toBe(true);
    expect(persistenceMocks.setItem).not.toHaveBeenCalled();

    act(() => useChatDiffPreferencesStore.getState().toggleWrapLongLines());
    await waitFor(() => {
      expect(persistenceMocks.setItem).toHaveBeenCalledWith(
        CHAT_DIFF_PREFERENCES_STORAGE_KEY,
        JSON.stringify({ wrapLongLines: false }),
      );
    });
  });

  it("does not let a late chat read overwrite a live action", async () => {
    let resolveRead: (value: string | null) => void = () => undefined;
    persistenceMocks.getItem.mockReturnValueOnce(new Promise((resolve) => {
      resolveRead = resolve;
    }));
    renderHook(() => useChatDiffPreferencesLifecycle());
    act(() => useChatDiffPreferencesStore.getState().setWrapLongLines(true));
    await act(async () => resolveRead(JSON.stringify({ wrapLongLines: false })));

    await waitFor(() => {
      expect(useChatDiffPreferencesStore.getState()._hydrated).toBe(true);
    });
    expect(useChatDiffPreferencesStore.getState().wrapLongLines).toBe(true);
    expect(persistenceMocks.setItem).toHaveBeenCalledWith(
      CHAT_DIFF_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ wrapLongLines: true }),
    );
  });

  it("uses the chat revision to reject an ABA late-read overwrite", async () => {
    let resolveRead: (value: string | null) => void = () => undefined;
    persistenceMocks.getItem.mockReturnValueOnce(new Promise((resolve) => {
      resolveRead = resolve;
    }));
    renderHook(() => useChatDiffPreferencesLifecycle());
    act(() => {
      useChatDiffPreferencesStore.getState().setWrapLongLines(true);
      useChatDiffPreferencesStore.getState().setWrapLongLines(false);
    });
    await act(async () => resolveRead(JSON.stringify({ wrapLongLines: true })));

    await waitFor(() => expect(useChatDiffPreferencesStore.getState()._hydrated).toBe(true));
    expect(useChatDiffPreferencesStore.getState().wrapLongLines).toBe(false);
    expect(persistenceMocks.setItem).toHaveBeenCalledWith(
      CHAT_DIFF_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ wrapLongLines: false }),
    );
  });

  it("hydrates and persists file-tree width through ProductStorage", async () => {
    persistenceMocks.values.set(
      FILE_TREE_STORAGE_KEY,
      JSON.stringify({ width: 512 }),
    );
    renderHook(() => useFileTreePreferencesLifecycle());
    await waitFor(() => expect(useFileTreeStore.getState()._hydrated).toBe(true));
    expect(useFileTreeStore.getState().width).toBe(512);
    expect(persistenceMocks.setItem).not.toHaveBeenCalled();

    act(() => useFileTreeStore.getState().setWidth(600));
    await waitFor(() => {
      expect(persistenceMocks.setItem).toHaveBeenCalledWith(
        FILE_TREE_STORAGE_KEY,
        JSON.stringify({ width: 600 }),
      );
    });
  });

  it("uses the file-tree revision to reject an ABA late-read overwrite", async () => {
    let resolveRead: (value: string | null) => void = () => undefined;
    persistenceMocks.getItem.mockReturnValueOnce(new Promise((resolve) => {
      resolveRead = resolve;
    }));
    renderHook(() => useFileTreePreferencesLifecycle());
    act(() => {
      useFileTreeStore.getState().setWidth(500);
      useFileTreeStore.getState().setWidth(FILE_TREE_DEFAULT_WIDTH);
    });
    await act(async () => resolveRead(JSON.stringify({ width: 512 })));

    await waitFor(() => expect(useFileTreeStore.getState()._hydrated).toBe(true));
    expect(useFileTreeStore.getState().width).toBe(FILE_TREE_DEFAULT_WIDTH);
    expect(persistenceMocks.setItem).toHaveBeenCalledWith(
      FILE_TREE_STORAGE_KEY,
      JSON.stringify({ width: FILE_TREE_DEFAULT_WIDTH }),
    );
  });

  it.each(["throws", "rejects"] as const)(
    "hydrates after a rejected read even when telemetry capture %s",
    async (captureFailure) => {
      persistenceMocks.getItem.mockRejectedValueOnce(new Error("read failed"));
      if (captureFailure === "throws") {
        persistenceMocks.captureException.mockImplementationOnce(() => {
          throw new Error("capture failed");
        });
      } else {
        persistenceMocks.captureException.mockRejectedValueOnce(new Error("capture failed"));
      }

      renderHook(() => useChatDiffPreferencesLifecycle());
      await waitFor(() => expect(useChatDiffPreferencesStore.getState()._hydrated).toBe(true));

      expect(useChatDiffPreferencesStore.getState().wrapLongLines).toBe(false);
      expect(persistenceMocks.setItem).not.toHaveBeenCalled();
    },
  );

  it("keeps live state after a rejected write and persists a later change", async () => {
    persistenceMocks.setItem.mockRejectedValueOnce(new Error("write failed"));
    renderHook(() => useChatDiffPreferencesLifecycle());
    await waitFor(() => expect(useChatDiffPreferencesStore.getState()._hydrated).toBe(true));

    act(() => useChatDiffPreferencesStore.getState().setWrapLongLines(true));
    await waitFor(() => expect(persistenceMocks.captureException).toHaveBeenCalled());
    expect(useChatDiffPreferencesStore.getState().wrapLongLines).toBe(true);

    act(() => useChatDiffPreferencesStore.getState().setWrapLongLines(false));
    await waitFor(() => {
      expect(persistenceMocks.setItem).toHaveBeenLastCalledWith(
        CHAT_DIFF_PREFERENCES_STORAGE_KEY,
        JSON.stringify({ wrapLongLines: false }),
      );
    });
    expect(useChatDiffPreferencesStore.getState().wrapLongLines).toBe(false);
  });

  it("hydrates and persists Home Next target selection", async () => {
    persistenceMocks.values.set("home_next_target_selection.v1", JSON.stringify({
      destination: "repository",
      repositorySelection: { kind: "auto" },
      repoLaunchKind: "worktree",
      selectedSshTargetId: null,
      baseBranchOverride: null,
    }));
    renderHook(() => useHomeNextTargetSelectionLifecycle());
    const selection = renderHook(() => useHomeNextTargetSelectionState());
    await waitFor(() => expect(selection.result.current.destination).toBe("repository"));
    expect(persistenceMocks.setItem).not.toHaveBeenCalled();

    act(() => selection.result.current.setRepoLaunchKind("local"));
    await waitFor(() => {
      expect(persistenceMocks.setItem).toHaveBeenCalledWith(
        "home_next_target_selection.v1",
        expect.stringContaining('"repoLaunchKind":"local"'),
      );
    });
  });

  it("writes back a Home Next action that wins a late hydration race", async () => {
    let resolveRead: (value: string | null) => void = () => undefined;
    persistenceMocks.getItem.mockReturnValueOnce(new Promise((resolve) => {
      resolveRead = resolve;
    }));
    renderHook(() => useHomeNextTargetSelectionLifecycle());
    const selection = renderHook(() => useHomeNextTargetSelectionState());

    act(() => selection.result.current.setDestination("repository"));
    await act(async () => resolveRead(JSON.stringify({
      destination: "cowork",
      repositorySelection: { kind: "repository", sourceRoot: "/persisted" },
      repoLaunchKind: "cloud",
      selectedSshTargetId: "ssh-persisted",
      baseBranchOverride: "persisted-branch",
    })));

    expect(selection.result.current.destination).toBe("repository");
    expect(selection.result.current.repositorySelection).toEqual({ kind: "auto" });
    expect(selection.result.current.repoLaunchKind).toBe("worktree");
    expect(selection.result.current.selectedSshTargetId).toBeNull();
    expect(selection.result.current.baseBranchOverride).toBeNull();
    await waitFor(() => {
      expect(persistenceMocks.setItem).toHaveBeenCalledWith(
        "home_next_target_selection.v1",
        expect.stringContaining('"destination":"repository"'),
      );
    });
  });

  it("persists Cloud display-name suppression and removes an empty map", async () => {
    renderHook(() => useCloudDisplayNameBackfillSuppressionLifecycle());
    await waitFor(() => expect(persistenceMocks.getItem).toHaveBeenCalled());

    act(() => suppressCloudDisplayNameBackfill("cloud-1"));
    expect(isCloudDisplayNameBackfillSuppressed("cloud-1")).toBe(true);
    await waitFor(() => expect(persistenceMocks.setItem).toHaveBeenCalled());

    act(() => clearCloudDisplayNameBackfillSuppression("cloud-1"));
    await waitFor(() => {
      expect(persistenceMocks.removeItem).toHaveBeenCalledWith(
        "proliferate.cloudDisplayNameBackfillSuppression.v1",
      );
    });
  });

  it("writes back Cloud suppression that wins a late hydration race", async () => {
    let resolveRead: (value: string | null) => void = () => undefined;
    persistenceMocks.getItem.mockReturnValueOnce(new Promise((resolve) => {
      resolveRead = resolve;
    }));
    renderHook(() => useCloudDisplayNameBackfillSuppressionLifecycle());

    act(() => suppressCloudDisplayNameBackfill("cloud-1"));
    await act(async () => resolveRead(JSON.stringify({ "cloud-persisted": true })));

    expect(isCloudDisplayNameBackfillSuppressed("cloud-1")).toBe(true);
    expect(isCloudDisplayNameBackfillSuppressed("cloud-persisted")).toBe(false);
    await waitFor(() => {
      expect(persistenceMocks.setItem).toHaveBeenCalledWith(
        "proliferate.cloudDisplayNameBackfillSuppression.v1",
        JSON.stringify({ "cloud-1": true }),
      );
    });
  });
});
