// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUserPreferencesLifecycle } from "@/hooks/preferences/lifecycle/use-user-preferences-lifecycle";
import { useWorktreeAutoDeleteAdoption } from "@/hooks/preferences/workflows/use-worktree-auto-delete-adoption";
import { USER_PREFERENCE_DEFAULTS } from "@/lib/domain/preferences/user/model";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

const storeMocks = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  const get = vi.fn(async (key: string) => values.get(key));
  const set = vi.fn(async (key: string, value: unknown) => {
    values.set(key, value);
  });

  return {
    values,
    get,
    set,
    getPreferencesStore: vi.fn(async () => ({ get, set })),
  };
});

vi.mock("@/lib/access/tauri/store", () => ({
  getPreferencesStore: storeMocks.getPreferencesStore,
}));

describe("useUserPreferencesLifecycle", () => {
  beforeEach(() => {
    storeMocks.values.clear();
    storeMocks.get.mockClear();
    storeMocks.set.mockClear();
    storeMocks.getPreferencesStore.mockClear();
    useUserPreferencesStore.setState({
      ...USER_PREFERENCE_DEFAULTS,
      _hydrated: false,
      _persistedMetadata: {},
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("preserves persisted metadata after bootstrap when preferences change", async () => {
    const persisted = { ...USER_PREFERENCE_DEFAULTS } as Record<string, unknown>;
    delete persisted.worktreeAutoDeleteLimit;
    storeMocks.values.set("user_preferences", persisted);

    renderHook(() => useUserPreferencesLifecycle());

    await waitFor(() => {
      expect(useUserPreferencesStore.getState()._hydrated).toBe(true);
    });

    act(() => {
      useUserPreferencesStore.getState().set("colorMode", "light");
    });

    await waitFor(() => {
      const persistedRecord = storeMocks.values.get("user_preferences") as Record<string, unknown>;
      expect(persistedRecord.colorMode).toBe("light");
      expect(persistedRecord.worktreeAutoDeleteLimit).toBeUndefined();
      expect(persistedRecord.worktreeAutoDeleteLimitBackfilled).toBe(true);
    });
  });

  it("awaits persistence when worktree cleanup adoption metadata is consumed", async () => {
    const persisted = { ...USER_PREFERENCE_DEFAULTS } as Record<string, unknown>;
    delete persisted.worktreeAutoDeleteLimit;
    storeMocks.values.set("user_preferences", persisted);

    renderHook(() => useUserPreferencesLifecycle());
    const adoption = renderHook(() => useWorktreeAutoDeleteAdoption());

    await waitFor(() => {
      expect(useUserPreferencesStore.getState()._hydrated).toBe(true);
    });
    storeMocks.set.mockClear();

    await act(async () => {
      await adoption.result.current();
    });

    expect(storeMocks.set).toHaveBeenCalledWith(
      "user_preferences",
      expect.objectContaining({
        worktreeAutoDeleteLimit: USER_PREFERENCE_DEFAULTS.worktreeAutoDeleteLimit,
      }),
    );
    const persistedRecord = storeMocks.values.get("user_preferences") as Record<string, unknown>;
    expect(persistedRecord.worktreeAutoDeleteLimitBackfilled).toBeUndefined();
    expect(persistedRecord.worktreeAutoDeleteLimit)
      .toBe(USER_PREFERENCE_DEFAULTS.worktreeAutoDeleteLimit);
  });
});
