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
  // ready agent is usually "cursor" so title assertions read cleanly; "grok"
  // appears both as an overflow name and, in its own case below, as the
  // named ready agent, because grok is a bundled descriptor present in every
  // full first-run reconcile and used to print as its raw wire kind (D-R9).
  const cursorComponent = (phase: string) => ({ agent: "cursor", phase });
  const claudeComponent = (phase: string) => ({ agent: "claude", phase });
  const codexComponent = (phase: string) => ({ agent: "codex", phase });
  const opencodeComponent = (phase: string) => ({ agent: "opencode", phase });
  const grokComponent = (phase: string) => ({ agent: "grok", phase });

  // Liveness defaults to a running, freshly-polled job (D-R10) so each case
  // below varies only the thing it is about; the liveness cases set it
  // explicitly.
  function resolveCard(
    args: Omit<
      Parameters<typeof resolveHomeReadinessCardModel>[0],
      "jobStatus" | "snapshotIsStale"
    > & { jobStatus?: string | null; snapshotIsStale?: boolean },
  ) {
    return resolveHomeReadinessCardModel({
      jobStatus: "running",
      snapshotIsStale: false,
      ...args,
    });
  }

  it("is null for a blocked gate, regardless of readiness", () => {
    expect(resolveCard({
      gateKind: "blocked",
      progressComponents: [cursorComponent("completed"), claudeComponent("downloading")],
    })).toBeNull();
  });

  it("is null while nothing is ready yet", () => {
    expect(resolveCard({
      gateKind: "selection_required",
      progressComponents: [claudeComponent("downloading")],
    })).toBeNull();
  });

  it("is null once every agent has settled (ruling 4: no 'done' card)", () => {
    expect(resolveCard({
      gateKind: "launchable",
      progressComponents: [cursorComponent("completed")],
    })).toBeNull();
  });

  it("is null with no components at all (idle, no active job)", () => {
    expect(resolveCard({
      gateKind: "selection_required",
      progressComponents: [],
    })).toBeNull();
  });

  it("groups multiple components of the same agent — ready only once every one of them settles", () => {
    expect(resolveCard({
      gateKind: "selection_required",
      progressComponents: [
        { agent: "cursor", phase: "completed" },
        { agent: "cursor", phase: "installing" },
        claudeComponent("downloading"),
      ],
    })).toBeNull();

    expect(resolveCard({
      gateKind: "selection_required",
      progressComponents: [
        { agent: "cursor", phase: "completed" },
        { agent: "cursor", phase: "verifying" },
        cursorComponent("completed"),
        claudeComponent("downloading"),
      ],
    })).toBeNull();
  });

  it("excludes a failed agent from both ready and installing (the terminal toast's concern, not this card's)", () => {
    expect(resolveCard({
      gateKind: "selection_required",
      progressComponents: [cursorComponent("completed"), claudeComponent("failed")],
    })).toBeNull();
  });

  // D-R11. The runtime skips a component when nothing was installed for it:
  // cursor cannot reach Ready in cloud, the agent is not managed-installed on
  // an installed-only pass, the platform is unsupported, or the binary was
  // already on PATH. Only the last is anything like ready, and the phase
  // cannot tell them apart — the same reason the terminal toast in this file's
  // sibling refuses to count a skipped result as a meaningful outcome. So a
  // skipped agent is not ready; it is also not installing, since nothing is
  // happening to it. The card simply says nothing about it.
  it("never calls a skipped agent ready", () => {
    expect(resolveCard({
      gateKind: "launchable",
      progressComponents: [cursorComponent("skipped"), claudeComponent("downloading")],
    })).toBeNull();

    expect(resolveCard({
      gateKind: "launchable",
      progressComponents: [
        { agent: "cursor", phase: "completed" },
        { agent: "cursor", phase: "skipped" },
        claudeComponent("downloading"),
      ],
    })).toBeNull();
  });

  it("does not name a settled skipped agent as still installing either", () => {
    expect(resolveCard({
      gateKind: "launchable",
      progressComponents: [
        codexComponent("completed"),
        cursorComponent("skipped"),
        claudeComponent("downloading"),
      ],
    })).toEqual({
      agentKind: "codex",
      title: "Codex is ready.",
      description: "You can start now. Claude Code is still installing.",
    });
  });

  it("still counts an agent with a moving component as installing despite a skipped sibling", () => {
    expect(resolveCard({
      gateKind: "launchable",
      progressComponents: [
        codexComponent("completed"),
        { agent: "cursor", phase: "skipped" },
        { agent: "cursor", phase: "downloading" },
      ],
    })).toEqual({
      agentKind: "codex",
      title: "Codex is ready.",
      description: "You can start now. Cursor is still installing.",
    });
  });

  it("names the lone still-installing agent", () => {
    expect(resolveCard({
      gateKind: "selection_required",
      progressComponents: [cursorComponent("completed"), claudeComponent("downloading")],
    })).toEqual({
      agentKind: "cursor",
      title: "Cursor is ready.",
      description: "Claude Code is still installing.",
    });
  });

  it("names both still-installing agents when there are exactly two", () => {
    expect(resolveCard({
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
    expect(resolveCard({
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

  // D-R9. grok is a bundled descriptor, so a fresh desktop first run always
  // has it in the job — the exact scenario this card exists for. It used to
  // print its raw wire kind ("grok is ready.") because the client kept its own
  // literal name map; names now come from the bundled registry, so this holds
  // for whatever the catalog ships next with no change here.
  it("names an agent the deleted client-side map had never heard of", () => {
    expect(resolveCard({
      gateKind: "launchable",
      progressComponents: [grokComponent("completed"), claudeComponent("downloading")],
    })).toEqual({
      agentKind: "grok",
      title: "Grok is ready.",
      description: "You can start now. Claude Code is still installing.",
    });
  });

  it("names grok in the still-installing sentence too", () => {
    expect(resolveCard({
      gateKind: "launchable",
      progressComponents: [cursorComponent("completed"), grokComponent("downloading")],
    })).toEqual({
      agentKind: "cursor",
      title: "Cursor is ready.",
      description: "You can start now. Grok is still installing.",
    });
  });

  // Spec correction (coordinator ruling): the frozen spec had this
  // backwards. selection_required means a model still needs picking, so
  // "You can start now." is false exactly there; launchable means ready to
  // start, so it is true exactly there.
  it("omits 'You can start now.' at selection_required — a model still needs picking", () => {
    expect(resolveCard({
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
    expect(resolveCard({
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

  // D-R10. Phases alone cannot say whether an install is still happening: the
  // snapshot keeps whatever phases it last held. Without a liveness check the
  // card's claim outlives the job permanently, which is the one thing the
  // spec says it must never do (it unmounts when the job resolves).
  describe("liveness", () => {
    // The runtime's panic path: the job is marked failed and returns without
    // finishing the agents it never reached, so they stay `queued` forever.
    const panickedJob = [
      claudeComponent("completed"),
      codexComponent("queued"),
      opencodeComponent("queued"),
    ];

    it("is null for a job that already resolved, whatever its components still say", () => {
      for (const jobStatus of ["failed", "completed", "idle", null, undefined]) {
        expect(resolveCard({
          gateKind: "launchable",
          jobStatus,
          progressComponents: panickedJob,
        })).toBeNull();
      }
    });

    it("is null when the poll can no longer refresh the snapshot it is reading", () => {
      // The reconcile poll stops permanently on a 404 even while the retained
      // snapshot says `running`, so a `running` status is not on its own
      // evidence that anything is still moving.
      expect(resolveCard({
        gateKind: "launchable",
        jobStatus: "running",
        snapshotIsStale: true,
        progressComponents: panickedJob,
      })).toBeNull();
    });

    it("shows the card for a queued or running job the poll is still following", () => {
      for (const jobStatus of ["queued", "running"]) {
        expect(resolveCard({
          gateKind: "launchable",
          jobStatus,
          progressComponents: panickedJob,
        })).toEqual({
          agentKind: "claude",
          title: "Claude Code is ready.",
          description: "You can start now. Codex and OpenCode are still installing.",
        });
      }
    });
  });
});
