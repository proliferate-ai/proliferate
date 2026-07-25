// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRepoPreferencesLifecycle } from "@/hooks/preferences/lifecycle/use-repo-preferences-lifecycle";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";

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

describe("useRepoPreferencesLifecycle", () => {
  beforeEach(() => {
    cleanup();
    persistenceMocks.values.clear();
    persistenceMocks.readPersistedValue.mockClear();
    persistenceMocks.persistValue.mockClear();
    useRepoPreferencesStore.setState({
      _hydrated: false,
      _persistenceRevision: 0,
      repoConfigs: {},
    });
  });

  it("hydrates from the current persisted repo preferences record", async () => {
    persistenceMocks.values.set("repo_preferences", {
      "/repo-a": {
        defaultBranch: " main ",
        setupScript: "pnpm install",
      },
    });

    renderHook(() => useRepoPreferencesLifecycle());

    await waitFor(() => {
      expect(useRepoPreferencesStore.getState()._hydrated).toBe(true);
    });

    expect(useRepoPreferencesStore.getState().repoConfigs).toEqual({
      "/repo-a": {
        defaultBranch: "main",
        setupScript: "pnpm install",
        runCommand: "",
      },
    });
    expect(persistenceMocks.persistValue).not.toHaveBeenCalled();
  });

  it("falls back to legacy repoConfigs when the current record is missing", async () => {
    persistenceMocks.values.set("repoConfigs", {
      "/legacy-repo": {
        defaultBranch: " develop ",
        runCommand: "pnpm dev",
      },
    });

    renderHook(() => useRepoPreferencesLifecycle());

    await waitFor(() => {
      expect(useRepoPreferencesStore.getState()._hydrated).toBe(true);
    });

    expect(useRepoPreferencesStore.getState().repoConfigs).toEqual({
      "/legacy-repo": {
        defaultBranch: "develop",
        setupScript: "",
        runCommand: "pnpm dev",
      },
    });
  });

  it("persists repo preference changes after hydration", async () => {
    renderHook(() => useRepoPreferencesLifecycle());

    await waitFor(() => {
      expect(useRepoPreferencesStore.getState()._hydrated).toBe(true);
    });
    persistenceMocks.persistValue.mockClear();

    act(() => {
      useRepoPreferencesStore.getState().setRepoConfig("/repo-a", {
        defaultBranch: " main ",
        setupScript: "pnpm install",
      });
    });

    await waitFor(() => {
      expect(persistenceMocks.persistValue).toHaveBeenCalledWith("repo_preferences", {
        "/repo-a": {
          defaultBranch: "main",
          setupScript: "pnpm install",
          runCommand: "",
        },
      });
    });
  });

  it("keeps the whole live repo record when it changes during hydration", async () => {
    let resolveRead: (value: unknown) => void = () => undefined;
    persistenceMocks.readPersistedValue.mockReturnValueOnce(new Promise((resolve) => {
      resolveRead = resolve;
    }));

    renderHook(() => useRepoPreferencesLifecycle());
    act(() => {
      useRepoPreferencesStore.getState().setRepoConfig("/repo-live", {
        defaultBranch: "feature/live",
      });
    });
    await act(async () => resolveRead({
      "/repo-persisted": {
        defaultBranch: "main",
        setupScript: "pnpm install",
      },
    }));
    await waitFor(() => expect(useRepoPreferencesStore.getState()._hydrated).toBe(true));

    expect(useRepoPreferencesStore.getState().repoConfigs).toEqual({
      "/repo-live": {
        defaultBranch: "feature/live",
        setupScript: "",
        runCommand: "",
      },
    });
    await waitFor(() => {
      expect(persistenceMocks.persistValue).toHaveBeenCalledWith(
        "repo_preferences",
        useRepoPreferencesStore.getState().repoConfigs,
      );
    });
  });
});
