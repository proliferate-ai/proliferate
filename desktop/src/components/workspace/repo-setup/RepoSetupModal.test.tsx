// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitBranchRef, SetupHint } from "@anyharness/sdk";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";
import { RepoSetupModal } from "./RepoSetupModal";

const SOURCE_ROOT = "/tmp/proliferate";

const queryMocks = vi.hoisted(() => ({
  detectionResult: {
    hints: [
      {
        id: "hint-1",
        category: "build_tool",
        label: "Install dependencies",
        detectedFile: "package.json",
        suggestedCommand: "pnpm install",
      },
    ],
  },
  detecting: false,
  branchRefs: [
    {
      name: "main",
      isDefault: true,
      isHead: false,
      isRemote: false,
      upstream: null,
    },
    {
      name: "develop",
      isDefault: false,
      isHead: false,
      isRemote: false,
      upstream: null,
    },
  ],
}));

vi.mock("@anyharness/sdk-react", () => ({
  useDetectRepoRootSetupQuery: () => ({
    data: queryMocks.detectionResult,
    isLoading: queryMocks.detecting,
  }),
  useRepoRootGitBranchesQuery: () => ({
    data: queryMocks.branchRefs,
  }),
}));

function resetRepoPreferences() {
  useRepoPreferencesStore.setState({
    _hydrated: false,
    repoConfigs: {},
  });
}

function renderModal(onClose = vi.fn()) {
  render(
    <RepoSetupModal
      repoRootId="repo-root-1"
      sourceRoot={SOURCE_ROOT}
      repoName="proliferate"
      onClose={onClose}
    />,
  );
  return { onClose };
}

describe("RepoSetupModal", () => {
  beforeEach(() => {
    resetRepoPreferences();
    queryMocks.detectionResult = {
      hints: [
        {
          id: "hint-1",
          category: "build_tool",
          label: "Install dependencies",
          detectedFile: "package.json",
          suggestedCommand: "pnpm install",
        },
      ] satisfies SetupHint[],
    };
    queryMocks.detecting = false;
    queryMocks.branchRefs = [
      {
        name: "main",
        isDefault: true,
        isHead: false,
        isRemote: false,
        upstream: null,
      },
      {
        name: "develop",
        isDefault: false,
        isHead: false,
        isRemote: false,
        upstream: null,
      },
    ] satisfies GitBranchRef[];
  });

  afterEach(() => {
    cleanup();
    resetRepoPreferences();
  });

  it("does not persist edits when skipped", () => {
    const { onClose } = renderModal();

    fireEvent.click(screen.getByText("Customize defaults"));
    fireEvent.change(screen.getByPlaceholderText("make dev PROFILE=my-profile"), {
      target: { value: "make dev" },
    });
    fireEvent.change(screen.getByPlaceholderText("One command per line..."), {
      target: { value: "pnpm install" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useRepoPreferencesStore.getState().repoConfigs[SOURCE_ROOT]).toBeUndefined();
  });

  it("does not apply detected hints unless explicitly toggled", () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(useRepoPreferencesStore.getState().repoConfigs[SOURCE_ROOT]).toEqual({
      defaultBranch: null,
      setupScript: "",
      runCommand: "",
    });
  });

  it("shows auto-detected branch without materializing it on save", () => {
    renderModal();

    expect(screen.getByRole("button", { name: /Auto-detect \(main\)/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(useRepoPreferencesStore.getState().repoConfigs[SOURCE_ROOT]?.defaultBranch).toBeNull();
  });

  it("saves explicit branch, setup script, and run command", () => {
    renderModal();

    fireEvent.click(screen.getByText("Customize defaults"));
    fireEvent.click(screen.getByRole("button", { name: /Auto-detect \(main\)/ }));
    fireEvent.click(screen.getByText("develop"));
    fireEvent.change(screen.getByPlaceholderText("make dev PROFILE=my-profile"), {
      target: { value: "make dev PROFILE=test" },
    });
    fireEvent.change(screen.getByPlaceholderText("One command per line..."), {
      target: { value: "pnpm install" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(useRepoPreferencesStore.getState().repoConfigs[SOURCE_ROOT]).toEqual({
      defaultBranch: "develop",
      setupScript: "pnpm install",
      runCommand: "make dev PROFILE=test",
    });
  });
});
