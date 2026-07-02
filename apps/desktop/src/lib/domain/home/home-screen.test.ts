import { describe, expect, it } from "vitest";
import type { RepoConfigResponse } from "@proliferate/cloud-sdk";
import {
  buildHomeOnboardingCards,
  findHomeUnconfiguredGitHubRepository,
  resolveHomeModelProbeCardState,
} from "./home-screen";

const githubRepository = {
  sourceRoot: "/repo/proliferate",
  gitProvider: "github",
  gitOwner: "proliferate-ai",
  gitRepoName: "proliferate",
};

const gitlabRepository = {
  sourceRoot: "/repo/elsewhere",
  gitProvider: "gitlab",
  gitOwner: "proliferate-ai",
  gitRepoName: "elsewhere",
};

const configuredRepoConfig: RepoConfigResponse = {
  id: "repo-proliferate",
  gitProvider: "github",
  gitOwner: "proliferate-ai",
  gitRepoName: "proliferate",
  environments: [{
    id: "env-proliferate-cloud",
    repoConfigId: "repo-proliferate",
    kind: "cloud",
    desktopInstallId: null,
    localPath: null,
    defaultBranch: "main",
    setupScript: "",
    runCommand: "",
  }],
};

function buildCards(overrides: Partial<Parameters<typeof buildHomeOnboardingCards>[0]> = {}) {
  return buildHomeOnboardingCards({
    repositories: [githubRepository],
    repositoriesLoading: false,
    readyAgentCount: 1,
    agentsLoading: false,
    defaultChatAgentKind: "codex",
    repoConfigs: [configuredRepoConfig],
    cloudRepoConfigsLoading: false,
    ...overrides,
  });
}

describe("buildHomeOnboardingCards", () => {
  it("shows the GitHub repo card when no GitHub repositories are present", () => {
    expect(buildCards({
      repositories: [gitlabRepository],
      repoConfigs: [],
    })).toEqual([
      expect.objectContaining({
        id: "add-repository",
        title: "Add a GitHub repo",
      }),
    ]);
  });

  it("shows the default harnesses card when no usable harness default exists", () => {
    expect(buildCards({
      readyAgentCount: 0,
    })).toEqual([
      expect.objectContaining({
        id: "agent-defaults",
        title: "Configure default harnesses",
      }),
    ]);

    expect(buildCards({
      defaultChatAgentKind: "",
    })).toEqual([
      expect.objectContaining({
        id: "agent-defaults",
      }),
    ]);
  });

  it("shows the repository configuration card for an unconfigured GitHub repo", () => {
    expect(buildCards({
      repoConfigs: [],
    })).toEqual([
      expect.objectContaining({
        id: "repository-settings",
        title: "Configure your repo",
      }),
    ]);
  });

  it("hides cards while the owning state is still loading", () => {
    expect(buildCards({
      repositories: [],
      repositoriesLoading: true,
      repoConfigs: [],
    })).toEqual([]);

    expect(buildCards({
      readyAgentCount: 0,
      agentsLoading: true,
    })).toEqual([]);

    expect(buildCards({
      repoConfigs: [],
      cloudRepoConfigsLoading: true,
    })).toEqual([]);
  });
});

describe("findHomeUnconfiguredGitHubRepository", () => {
  it("returns the first GitHub repository without a saved cloud config", () => {
    expect(findHomeUnconfiguredGitHubRepository({
      repositories: [gitlabRepository, githubRepository],
      repoConfigs: [],
    })).toBe(githubRepository);
  });

  it("returns null when the GitHub repository has a configured cloud config", () => {
    expect(findHomeUnconfiguredGitHubRepository({
      repositories: [githubRepository],
      repoConfigs: [configuredRepoConfig],
    })).toBeNull();
  });
});

describe("resolveHomeModelProbeCardState", () => {
  const baseArgs = {
    dismissed: false,
    agentsLoading: false,
    isReconciling: false,
    harnessKinds: ["opencode"],
    modelCount: 3,
    agentSetupCardVisible: false,
  };

  it("is hidden when dismissed", () => {
    expect(resolveHomeModelProbeCardState({ ...baseArgs, dismissed: true }))
      .toEqual({ kind: "hidden" });
  });

  it("probes while reconciling, even mid-load", () => {
    expect(resolveHomeModelProbeCardState({
      ...baseArgs,
      isReconciling: true,
      agentsLoading: true,
    })).toEqual({ kind: "probing", harnessKinds: ["opencode"] });
  });

  it("is hidden while agents are still loading", () => {
    expect(resolveHomeModelProbeCardState({ ...baseArgs, agentsLoading: true }))
      .toEqual({ kind: "hidden" });
  });

  it("reports available models once probing settles", () => {
    expect(resolveHomeModelProbeCardState(baseArgs)).toEqual({
      kind: "done",
      modelCount: 3,
      harnessKinds: ["opencode"],
    });
  });

  it("prompts to connect a provider when no models exist", () => {
    expect(resolveHomeModelProbeCardState({ ...baseArgs, modelCount: 0 }))
      .toEqual({ kind: "none" });
  });

  it("suppresses the none state when the agent-setup card is already shown", () => {
    expect(resolveHomeModelProbeCardState({
      ...baseArgs,
      modelCount: 0,
      agentSetupCardVisible: true,
    })).toEqual({ kind: "hidden" });
  });
});
