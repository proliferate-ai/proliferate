import { describe, expect, it } from "vitest";
import type { RepoConfigResponse } from "@proliferate/cloud-sdk";
import {
  buildHomeOnboardingCards,
  findHomeUnconfiguredGitHubRepository,
  resolveHomeReadinessCardModel,
} from "#product/lib/domain/home/home-screen";

const githubRepository = {
  sourceRoot: "/repo/proliferate",
  gitProvider: "github",
  gitOwner: "proliferate-ai",
  gitRepoName: "proliferate",
  commitInstructions: "",
};

const gitlabRepository = {
  sourceRoot: "/repo/elsewhere",
  gitProvider: "gitlab",
  gitOwner: "proliferate-ai",
  gitRepoName: "elsewhere",
  commitInstructions: "",
};

const configuredRepoConfig: RepoConfigResponse = {
  id: "repo-proliferate",
  gitProvider: "github",
  gitOwner: "proliferate-ai",
  gitRepoName: "proliferate",
  commitInstructions: "",
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

describe("resolveHomeReadinessCardModel", () => {
  const grok = { kind: "grok", displayName: "Grok" };
  const claude = { kind: "claude", displayName: "Claude" };
  const codex = { kind: "codex", displayName: "Codex" };
  const opencode = { kind: "opencode", displayName: "OpenCode" };
  const cursor = { kind: "cursor", displayName: "Cursor" };

  it("is null for a blocked gate, regardless of readiness", () => {
    expect(resolveHomeReadinessCardModel({
      gateKind: "blocked",
      readyAgents: [grok],
      installingAgents: [claude],
    })).toBeNull();
  });

  it("is null while nothing is ready yet", () => {
    expect(resolveHomeReadinessCardModel({
      gateKind: "selection_required",
      readyAgents: [],
      installingAgents: [claude],
    })).toBeNull();
  });

  it("is null once every agent has settled (ruling 4: no 'done' card)", () => {
    expect(resolveHomeReadinessCardModel({
      gateKind: "launchable",
      readyAgents: [grok],
      installingAgents: [],
    })).toBeNull();
  });

  it("names the lone still-installing agent", () => {
    expect(resolveHomeReadinessCardModel({
      gateKind: "selection_required",
      readyAgents: [grok],
      installingAgents: [claude],
    })).toEqual({
      agentKind: "grok",
      title: "Grok is ready.",
      description: "You can start now. Claude is still installing.",
    });
  });

  it("names both still-installing agents when there are exactly two", () => {
    expect(resolveHomeReadinessCardModel({
      gateKind: "selection_required",
      readyAgents: [grok],
      installingAgents: [claude, codex],
    })).toEqual({
      agentKind: "grok",
      title: "Grok is ready.",
      description: "You can start now. Claude and Codex are still installing.",
    });
  });

  it("names the first and overflows the rest as a count (the artifact's 4-agent shape)", () => {
    expect(resolveHomeReadinessCardModel({
      gateKind: "selection_required",
      readyAgents: [grok],
      installingAgents: [claude, codex, opencode, cursor],
    })).toEqual({
      agentKind: "grok",
      title: "Grok is ready.",
      description: "You can start now. Claude and 3 others are still installing.",
    });
  });

  it("drops 'You can start now.' once the gate is launchable", () => {
    expect(resolveHomeReadinessCardModel({
      gateKind: "launchable",
      readyAgents: [grok],
      installingAgents: [claude, codex, opencode, cursor],
    })).toEqual({
      agentKind: "grok",
      title: "Grok is ready.",
      description: "Claude and 3 others are still installing.",
    });
  });
});
