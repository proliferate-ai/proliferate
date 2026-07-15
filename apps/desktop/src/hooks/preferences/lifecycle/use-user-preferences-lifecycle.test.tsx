// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { useUserPreferencesLifecycle } from "@/hooks/preferences/lifecycle/use-user-preferences-lifecycle";
import { useWorktreeAutoDeleteAdoption } from "@/hooks/preferences/workflows/use-worktree-auto-delete-adoption";
import { USER_PREFERENCE_DEFAULTS } from "@/lib/domain/preferences/user/model";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import {
  createMemoryProductStorage,
  type MemoryProductStorage,
} from "@/test/product-storage-test-utils";
import {
  makeTestProductHost,
  productHostWrapper,
} from "@/test/product-host-test-utils";

let memory: MemoryProductStorage;
let setItemSpy: MockInstance;

function persistedUserPreferences(): Record<string, unknown> {
  return memory.readJson<Record<string, unknown>>("user_preferences") ?? {};
}

describe("useUserPreferencesLifecycle", () => {
  beforeEach(() => {
    memory = createMemoryProductStorage();
    setItemSpy = vi.spyOn(memory.storage, "setItem");
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
    memory.values.set("user_preferences", persisted);

    const host = makeTestProductHost({ overrides: { storage: memory.storage } });
    renderHook(() => useUserPreferencesLifecycle(), {
      wrapper: productHostWrapper(host),
    });

    await waitFor(() => {
      expect(useUserPreferencesStore.getState()._hydrated).toBe(true);
    });

    act(() => {
      useUserPreferencesStore.getState().set("colorMode", "light");
    });

    await waitFor(() => {
      const persistedRecord = persistedUserPreferences();
      expect(persistedRecord.colorMode).toBe("light");
      expect(persistedRecord.worktreeAutoDeleteLimit).toBeUndefined();
      expect(persistedRecord.worktreeAutoDeleteLimitBackfilled).toBe(true);
    });
  });

  it("awaits persistence when worktree cleanup adoption metadata is consumed", async () => {
    const persisted = { ...USER_PREFERENCE_DEFAULTS } as Record<string, unknown>;
    delete persisted.worktreeAutoDeleteLimit;
    memory.values.set("user_preferences", persisted);

    const host = makeTestProductHost({ overrides: { storage: memory.storage } });
    const wrapper = productHostWrapper(host);
    renderHook(() => useUserPreferencesLifecycle(), { wrapper });
    const adoption = renderHook(() => useWorktreeAutoDeleteAdoption(), { wrapper });

    await waitFor(() => {
      expect(useUserPreferencesStore.getState()._hydrated).toBe(true);
    });
    setItemSpy.mockClear();

    await act(async () => {
      await adoption.result.current();
    });

    expect(setItemSpy).toHaveBeenCalledWith("user_preferences", expect.any(String));
    const persistedRecord = persistedUserPreferences();
    expect(persistedRecord.worktreeAutoDeleteLimitBackfilled).toBeUndefined();
    expect(persistedRecord.worktreeAutoDeleteLimit)
      .toBe(USER_PREFERENCE_DEFAULTS.worktreeAutoDeleteLimit);
  });
});
