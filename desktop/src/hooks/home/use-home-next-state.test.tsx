// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  HomeNextDestination,
  HomeNextRepoLaunchKind,
  ModelAvailabilityState,
} from "@/lib/domain/home/home-next-launch";
import { useHomeNextState } from "./use-home-next-state";

const stateMocks = vi.hoisted(() => {
  const model = {
    modelGroups: [],
    modelRegistries: [],
    effectiveModelSelection: { kind: "codex", modelId: "gpt-5.4" },
    selectedModel: null,
    isLoading: false,
    error: null,
    modelAvailabilityState: "launchable",
  } as any;
  const repository = {
    repositories: [],
    selectedRepository: {
      sourceRoot: "/repo",
      name: "repo",
      secondaryLabel: null,
      workspaceCount: 0,
      repoRootId: "repo-root-1",
      localWorkspaceId: "local-1",
      gitProvider: "github",
      gitOwner: "owner",
      gitRepoName: "repo",
    },
    selectedBranchName: "main",
    branchOptions: ["main"],
    branchQuery: {
      isLoading: false,
      isError: false,
    },
    cloudActive: true,
    cloudRepoTarget: {
      gitOwner: "owner",
      gitRepoName: "repo",
    },
    cloudRepoAction: { kind: "create" },
    cloudRepoActionBySourceRoot: {},
    launchTarget: { kind: "local", sourceRoot: "/repo" },
  } as any;
  const mode = {
    modeOptions: [],
    effectiveMode: null,
    effectiveModeId: null,
  } as any;

  return { model, repository, mode };
});

vi.mock("@/hooks/home/use-home-next-model-selection", () => ({
  useHomeNextModelSelection: () => stateMocks.model,
}));

vi.mock("@/hooks/home/use-home-next-repository-selection", () => ({
  useHomeNextRepositorySelection: () => stateMocks.repository,
}));

vi.mock("@/hooks/home/use-home-next-mode-selection", () => ({
  useHomeNextModeSelection: () => stateMocks.mode,
}));

function resetMocks() {
  stateMocks.model.modelAvailabilityState = "launchable";
  stateMocks.model.effectiveModelSelection = { kind: "codex", modelId: "gpt-5.4" };
  stateMocks.repository.selectedRepository = {
    sourceRoot: "/repo",
    name: "repo",
    secondaryLabel: null,
    workspaceCount: 0,
    repoRootId: "repo-root-1",
    localWorkspaceId: "local-1",
    gitProvider: "github",
    gitOwner: "owner",
    gitRepoName: "repo",
  };
  stateMocks.repository.selectedBranchName = "main";
  stateMocks.repository.branchOptions = ["main"];
  stateMocks.repository.branchQuery = {
    isLoading: false,
    isError: false,
  };
  stateMocks.repository.cloudActive = true;
  stateMocks.repository.cloudRepoTarget = {
    gitOwner: "owner",
    gitRepoName: "repo",
  };
  stateMocks.repository.cloudRepoAction = { kind: "create" };
  stateMocks.repository.launchTarget = { kind: "local", sourceRoot: "/repo" };
}

function renderHomeNextState({
  destination = "cowork",
  repoLaunchKind = "local",
}: {
  destination?: HomeNextDestination;
  repoLaunchKind?: HomeNextRepoLaunchKind;
} = {}) {
  return renderHook(() => useHomeNextState({
    destination,
    repositorySelection: { kind: "auto" },
    repoLaunchKind,
    modelSelectionOverride: null,
    baseBranchOverride: null,
    modeOverrideId: null,
  }));
}

describe("useHomeNextState", () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("does not surface model availability as target disabled copy", () => {
    for (const modelAvailabilityState of [
      "loading",
      "load_error",
      "no_launchable_model",
      "launchable",
    ] satisfies ModelAvailabilityState[]) {
      stateMocks.model.modelAvailabilityState = modelAvailabilityState;
      const { result, unmount } = renderHomeNextState();

      expect(result.current.targetDisabledReason).toBeNull();
      expect(result.current.targetDisabledReason).not.toBe("Loading models");
      expect(result.current.targetDisabledReason).not.toBe("Couldn't load models");
      expect(result.current.targetDisabledReason).not.toBe("No ready models");

      unmount();
    }
  });

  it("keeps target-specific disabled reasons", () => {
    stateMocks.repository.selectedRepository = null;
    const noRepo = renderHomeNextState({ destination: "repository", repoLaunchKind: "worktree" });
    expect(noRepo.result.current.targetDisabledReason).toBe("Choose a repository");
    noRepo.unmount();

    resetMocks();
    stateMocks.repository.branchQuery = { isLoading: true, isError: false };
    const loadingBranches = renderHomeNextState({
      destination: "repository",
      repoLaunchKind: "worktree",
    });
    expect(loadingBranches.result.current.targetDisabledReason).toBe("Loading branches");
    loadingBranches.unmount();

    resetMocks();
    stateMocks.repository.selectedBranchName = null;
    const noBranch = renderHomeNextState({ destination: "repository", repoLaunchKind: "worktree" });
    expect(noBranch.result.current.targetDisabledReason).toBe("Choose a base branch");
    noBranch.unmount();
  });
});
