// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { useRepoPreferencesLifecycle } from "@/hooks/preferences/lifecycle/use-repo-preferences-lifecycle";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";
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

function renderLifecycle() {
  const host = makeTestProductHost({ overrides: { storage: memory.storage } });
  return renderHook(() => useRepoPreferencesLifecycle(), {
    wrapper: productHostWrapper(host),
  });
}

describe("useRepoPreferencesLifecycle", () => {
  beforeEach(() => {
    cleanup();
    memory = createMemoryProductStorage();
    setItemSpy = vi.spyOn(memory.storage, "setItem");
    useRepoPreferencesStore.setState({
      _hydrated: false,
      repoConfigs: {},
    });
  });

  it("hydrates from the current persisted repo preferences record", async () => {
    memory.values.set("repo_preferences", {
      "/repo-a": {
        defaultBranch: " main ",
        setupScript: "pnpm install",
      },
    });

    renderLifecycle();

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
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it("falls back to legacy repoConfigs when the current record is missing", async () => {
    memory.values.set("repoConfigs", {
      "/legacy-repo": {
        defaultBranch: " develop ",
        runCommand: "pnpm dev",
      },
    });

    renderLifecycle();

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
    renderLifecycle();

    await waitFor(() => {
      expect(useRepoPreferencesStore.getState()._hydrated).toBe(true);
    });
    setItemSpy.mockClear();

    act(() => {
      useRepoPreferencesStore.getState().setRepoConfig("/repo-a", {
        defaultBranch: " main ",
        setupScript: "pnpm install",
      });
    });

    await waitFor(() => {
      expect(setItemSpy).toHaveBeenCalledWith(
        "repo_preferences",
        expect.any(String),
      );
    });
    expect(memory.readJson("repo_preferences")).toEqual({
      "/repo-a": {
        defaultBranch: "main",
        setupScript: "pnpm install",
        runCommand: "",
      },
    });
  });
});
