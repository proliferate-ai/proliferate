// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  HomeNextDestination,
  HomeNextRepoLaunchKind,
  ModelAvailabilityState,
} from "#product/lib/domain/home/home-next-launch";
import { useHomeNextState } from "#product/hooks/home/derived/use-home-next-state";

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
    defaultBranchName: "main",
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
  const computeTargets = {
    sshTargetOptions: [],
    isLoading: false,
  } as any;

  return {
    model,
    repository,
    mode,
    computeTargets,
    modelArgs: null as any,
    repositoryArgs: null as any,
    modeArgs: null as any,
    computeTargetArgs: null as any,
  };
});

vi.mock("#product/hooks/home/derived/use-home-next-model-selection", () => ({
  useHomeNextModelSelection: (args: any) => {
    stateMocks.modelArgs = args;
    return stateMocks.model;
  },
}));

vi.mock("#product/hooks/home/derived/use-home-next-repository-selection", () => ({
  useHomeNextRepositorySelection: (args: any) => {
    stateMocks.repositoryArgs = args;
    return stateMocks.repository;
  },
}));

vi.mock("#product/hooks/home/derived/use-home-next-mode-selection", () => ({
  useHomeNextModeSelection: (args: any) => {
    stateMocks.modeArgs = args;
    return stateMocks.mode;
  },
}));

vi.mock("#product/hooks/compute/derived/use-compute-target-options", () => ({
  useComputeTargetOptions: (args: any) => {
    stateMocks.computeTargetArgs = args;
    return stateMocks.computeTargets;
  },
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
  stateMocks.computeTargets.sshTargetOptions = [];
  stateMocks.computeTargets.isLoading = false;
  stateMocks.modelArgs = null;
  stateMocks.repositoryArgs = null;
  stateMocks.modeArgs = null;
  stateMocks.computeTargetArgs = null;
}

function renderHomeNextState({
  desktopTargetsAvailable = true,
  destination = "cowork",
  repoLaunchKind = "local",
}: {
  desktopTargetsAvailable?: boolean;
  destination?: HomeNextDestination;
  repoLaunchKind?: HomeNextRepoLaunchKind;
} = {}) {
  return renderHook(() => useHomeNextState({
    desktopTargetsAvailable,
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

  it("forces the Web target model to repository Cloud and rejects local targets", () => {
    stateMocks.computeTargets.sshTargetOptions = [{ id: "ssh-target-1" }];
    stateMocks.computeTargets.isLoading = true;
    const web = renderHomeNextState({
      desktopTargetsAvailable: false,
      destination: "cowork",
      repoLaunchKind: "worktree",
    });

    expect(stateMocks.modelArgs).toMatchObject({ repoLaunchKind: "cloud" });
    expect(stateMocks.repositoryArgs).toMatchObject({
      destination: "repository",
      repoLaunchKind: "cloud",
    });
    expect(stateMocks.modeArgs).toMatchObject({ destination: "repository" });
    expect(stateMocks.computeTargetArgs).toEqual({ enabled: false });
    expect(web.result.current.sshTargetOptions).toEqual([]);
    expect(web.result.current.sshTargetsLoading).toBe(false);
    expect(web.result.current.selectedSshTarget).toBeNull();
    expect(web.result.current.launchTarget).toBeNull();
    expect(web.result.current.canLaunchTarget).toBe(false);
    web.unmount();
  });

  it("preserves a Cloud launch target in the Web target model", () => {
    stateMocks.repository.launchTarget = {
      kind: "cloud",
      gitOwner: "owner",
      gitRepoName: "repo",
      baseBranch: "main",
    };

    const web = renderHomeNextState({
      desktopTargetsAvailable: false,
      destination: "repository",
      repoLaunchKind: "cloud",
    });

    expect(web.result.current.launchTarget).toMatchObject({ kind: "cloud" });
    expect(web.result.current.targetDisabledReason).toBeNull();
    expect(web.result.current.canLaunchTarget).toBe(true);
  });
});
