// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";
import { useRepoSetupModalState } from "./use-repo-setup-modal-state";

const SOURCE_ROOT = "/tmp/proliferate";

function resetRepoPreferences() {
  useRepoPreferencesStore.setState({
    _hydrated: false,
    repoConfigs: {},
  });
}

describe("useRepoSetupModalState", () => {
  beforeEach(() => {
    resetRepoPreferences();
  });

  afterEach(() => {
    cleanup();
    resetRepoPreferences();
  });

  it("keeps edits local until save is called", () => {
    const { result } = renderHook(() => useRepoSetupModalState(SOURCE_ROOT));

    act(() => {
      result.current.setDefaultBranch("main");
      result.current.setSetupScript("pnpm install");
      result.current.setRunCommand("make dev");
    });

    expect(useRepoPreferencesStore.getState().repoConfigs[SOURCE_ROOT]).toBeUndefined();

    act(() => {
      result.current.save();
    });

    expect(useRepoPreferencesStore.getState().repoConfigs[SOURCE_ROOT]).toEqual({
      defaultBranch: "main",
      setupScript: "pnpm install",
      runCommand: "make dev",
    });
  });

  it("saves auto branch as null", () => {
    useRepoPreferencesStore.setState({
      repoConfigs: {
        [SOURCE_ROOT]: {
          defaultBranch: "develop",
          setupScript: "",
          runCommand: "",
        },
      },
    });

    const { result } = renderHook(() => useRepoSetupModalState(SOURCE_ROOT));

    act(() => {
      result.current.setDefaultBranch(null);
    });
    act(() => {
      result.current.save();
    });

    expect(useRepoPreferencesStore.getState().repoConfigs[SOURCE_ROOT]?.defaultBranch).toBeNull();
  });

  it("loads async saved config into a pristine draft", () => {
    const { result } = renderHook(() => useRepoSetupModalState(SOURCE_ROOT));

    expect(result.current.defaultBranch).toBeNull();
    expect(result.current.setupScript).toBe("");
    expect(result.current.runCommand).toBe("");

    act(() => {
      useRepoPreferencesStore.setState({
        repoConfigs: {
          [SOURCE_ROOT]: {
            defaultBranch: "main",
            setupScript: "pnpm install",
            runCommand: "make dev",
          },
        },
      });
    });

    expect(result.current.defaultBranch).toBe("main");
    expect(result.current.setupScript).toBe("pnpm install");
    expect(result.current.runCommand).toBe("make dev");
  });

  it("preserves dirty fields while hydrating pristine fields and baseline", () => {
    const { result } = renderHook(() => useRepoSetupModalState(SOURCE_ROOT));

    act(() => {
      result.current.setSetupScript("edited setup");
    });
    act(() => {
      useRepoPreferencesStore.setState({
        repoConfigs: {
          [SOURCE_ROOT]: {
            defaultBranch: "main",
            setupScript: "saved setup",
            runCommand: "make dev",
          },
        },
      });
    });

    expect(result.current.defaultBranch).toBe("main");
    expect(result.current.setupScript).toBe("edited setup");
    expect(result.current.runCommand).toBe("make dev");
    expect(result.current.dirty).toBe(true);
  });
});
