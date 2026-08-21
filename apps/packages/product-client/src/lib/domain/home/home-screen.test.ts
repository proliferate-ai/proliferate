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
  // Sourced from the live reconcile job's per-component progress (D-R1/D-R2
  // fix), not hand-built ready/installing agent lists: this is the exact
  // shape the runtime hands back, one entry per component per agent, and
  // grouping-by-agent is part of what this function must get right. The
  // ready agent is always "cursor" (a kind with a proper mapped display
  // name) so title assertions read cleanly; a fourth installing agent uses
  // "grok" — unmapped in PROVIDER_DISPLAY_NAMES (a separate, already
  // quarantined gap) — deliberately kept out of the visible name slot so its
  // raw-kind fallback never leaks into an assertion.
  const cursorComponent = (phase: string) => ({ agent: "cursor", phase });
  const claudeComponent = (phase: string) => ({ agent: "claude", phase });
  const codexComponent = (phase: string) => ({ agent: "codex", phase });
  const opencodeComponent = (phase: string) => ({ agent: "opencode", phase });
  const grokComponent = (phase: string) => ({ agent: "grok", phase });

  it("is null for a blocked gate, regardless of readiness", () => {
    expect(resolveHomeReadinessCardModel({
      gateKind: "blocked",
      progressComponents: [cursorComponent("completed"), claudeComponent("downloading")],
    })).toBeNull();
  });

  it("is null while nothing is ready yet", () => {
    expect(resolveHomeReadinessCardModel({
      gateKind: "selection_required",
      progressComponents: [claudeComponent("downloading")],
    })).toBeNull();
  });

  it("is null once every agent has settled (ruling 4: no 'done' card)", () => {
    expect(resolveHomeReadinessCardModel({
      gateKind: "launchable",
      progressComponents: [cursorComponent("completed")],
    })).toBeNull();
  });

  it("is null with no components at all (idle, no active job)", () => {
    expect(resolveHomeReadinessCardModel({
      gateKind: "selection_required",
      progressComponents: [],
    })).toBeNull();
  });

  it("groups multiple components of the same agent — ready only once every one of them settles", () => {
    expect(resolveHomeReadinessCardModel({
      gateKind: "selection_required",
      progressComponents: [
        { agent: "cursor", phase: "completed" },
        { agent: "cursor", phase: "installing" },
        claudeComponent("downloading"),
      ],
    })).toBeNull();

    expect(resolveHomeReadinessCardModel({
      gateKind: "selection_required",
      progressComponents: [
        { agent: "cursor", phase: "completed" },
        { agent: "cursor", phase: "skipped" },
        claudeComponent("downloading"),
      ],
    })).toMatchObject({ agentKind: "cursor" });
  });

  it("excludes a failed agent from both ready and installing (the terminal toast's concern, not this card's)", () => {
    expect(resolveHomeReadinessCardModel({
      gateKind: "selection_required",
      progressComponents: [cursorComponent("completed"), claudeComponent("failed")],
    })).toBeNull();
  });

  it("names the lone still-installing agent", () => {
    expect(resolveHomeReadinessCardModel({
      gateKind: "selection_required",
      progressComponents: [cursorComponent("completed"), claudeComponent("downloading")],
    })).toEqual({
      agentKind: "cursor",
      title: "Cursor is ready.",
      description: "Claude Code is still installing.",
    });
  });

  it("names both still-installing agents when there are exactly two", () => {
    expect(resolveHomeReadinessCardModel({
      gateKind: "selection_required",
      progressComponents: [
        cursorComponent("completed"),
        claudeComponent("downloading"),
        codexComponent("queued"),
      ],
    })).toEqual({
      agentKind: "cursor",
      title: "Cursor is ready.",
      description: "Claude Code and Codex are still installing.",
    });
  });

  it("names the first and overflows the rest as a count (the artifact's 4-agent shape)", () => {
    expect(resolveHomeReadinessCardModel({
      gateKind: "selection_required",
      progressComponents: [
        cursorComponent("completed"),
        claudeComponent("downloading"),
        codexComponent("queued"),
        opencodeComponent("queued"),
        grokComponent("queued"),
      ],
    })).toEqual({
      agentKind: "cursor",
      title: "Cursor is ready.",
      description: "Claude Code and 3 others are still installing.",
    });
  });

  // Spec correction (coordinator ruling): the frozen spec had this
  // backwards. selection_required means a model still needs picking, so
  // "You can start now." is false exactly there; launchable means ready to
  // start, so it is true exactly there.
  it("omits 'You can start now.' at selection_required — a model still needs picking", () => {
    expect(resolveHomeReadinessCardModel({
      gateKind: "selection_required",
      progressComponents: [
        cursorComponent("completed"),
        claudeComponent("downloading"),
        codexComponent("queued"),
        opencodeComponent("queued"),
        grokComponent("queued"),
      ],
    })).toEqual({
      agentKind: "cursor",
      title: "Cursor is ready.",
      description: "Claude Code and 3 others are still installing.",
    });
  });

  it("adds 'You can start now.' once the gate is launchable", () => {
    expect(resolveHomeReadinessCardModel({
      gateKind: "launchable",
      progressComponents: [
        cursorComponent("completed"),
        claudeComponent("downloading"),
        codexComponent("queued"),
        opencodeComponent("queued"),
        grokComponent("queued"),
      ],
    })).toEqual({
      agentKind: "cursor",
      title: "Cursor is ready.",
      description: "You can start now. Claude Code and 3 others are still installing.",
    });
  });
});
