// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOME_MODEL_GATE_BLOCKED_REASONS,
  type HomeModelGate,
} from "#product/lib/domain/home/home-model-gate";
import type {
  HomeNextDestination,
  HomeNextRepoLaunchKind,
} from "#product/lib/domain/home/home-next-launch";
import { useHomeNextState } from "#product/hooks/home/derived/use-home-next-state";

const stateMocks = vi.hoisted(() => {
  const model = {
    modelGroups: [],
    modelRegistries: [],
    effectiveModelSelection: { kind: "codex", modelId: "gpt-5.4" },
    selectedModel: null,
    isCatalogLoading: false,
    hasKnownAgents: true,
    error: null,
    modelGate: { kind: "launchable" },
    retryModelObservation: () => {},
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
  return {
    model,
    repository,
    modelArgs: null as any,
    repositoryArgs: null as any,
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


function resetMocks() {
  stateMocks.model.modelGate = { kind: "launchable" };
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
  stateMocks.modelArgs = null;
  stateMocks.repositoryArgs = null;
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
    const gates: HomeModelGate[] = [
      { kind: "launchable" },
      { kind: "selection_required" },
      ...HOME_MODEL_GATE_BLOCKED_REASONS.map((reason) => (
        { kind: "blocked", reason } as const
      )),
    ];
    for (const modelGate of gates) {
      stateMocks.model.modelGate = modelGate;
      const { result, unmount } = renderHomeNextState();

      // `toBeNull()` is the whole assertion: it dominates any not.toBe on the
      // same value, and the three literals that used to follow it appear
      // nowhere in the repo, so no render could ever have failed them.
      expect(result.current.targetDisabledReason).toBeNull();

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
    const web = renderHomeNextState({
      desktopTargetsAvailable: false,
      destination: "cowork",
      repoLaunchKind: "worktree",
    });

    expect(stateMocks.modelArgs).toMatchObject({ launchTarget: null });
    expect(stateMocks.repositoryArgs).toMatchObject({
      destination: "repository",
      repoLaunchKind: "cloud",
    });
    expect(stateMocks.modeArgs).toBeUndefined();
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
    expect(stateMocks.modelArgs.launchTarget).toMatchObject({ kind: "cloud" });
    expect(web.result.current.targetDisabledReason).toBeNull();
    expect(web.result.current.canLaunchTarget).toBe(true);
  });
});
