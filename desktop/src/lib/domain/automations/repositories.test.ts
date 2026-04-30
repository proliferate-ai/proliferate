import { describe, expect, it } from "vitest";
import type {
  CloudRepoConfigSummary,
  CloudWorkspaceSummary,
} from "@/lib/integrations/cloud/client";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";
import { buildAutomationRepositoryOptions } from "./repositories";

function repoConfig(overrides: Partial<CloudRepoConfigSummary>): CloudRepoConfigSummary {
  return {
    gitOwner: "proliferate-ai",
    gitRepoName: "proliferate",
    configured: true,
    configuredAt: "2026-04-20T00:00:00Z",
    filesVersion: 0,
    ...overrides,
  };
}

function repository(overrides: Partial<SettingsRepositoryEntry>): SettingsRepositoryEntry {
  return {
    sourceRoot: "/repo",
    name: "repo",
    secondaryLabel: null,
    workspaceCount: 1,
    repoRootId: "repo-root",
    localWorkspaceId: "workspace",
    gitProvider: "github",
    gitOwner: "proliferate-ai",
    gitRepoName: "proliferate",
    ...overrides,
  };
}

function cloudWorkspace(owner: string, name: string): CloudWorkspaceSummary {
  return {
    repo: {
      provider: "github",
      owner,
      name,
      branch: "main",
      baseBranch: "main",
    },
  } as CloudWorkspaceSummary;
}

describe("buildAutomationRepositoryOptions", () => {
  it("includes GitHub repositories known from local workspace metadata", () => {
    const options = buildAutomationRepositoryOptions({
      repoConfigs: [],
      repositories: [repository({
        gitOwner: "acme",
        gitRepoName: "rocket",
      })],
    });

    expect(options).toEqual([
      {
        gitOwner: "acme",
        gitRepoName: "rocket",
        label: "acme/rocket",
      },
    ]);
  });

  it("keeps repo-config rows and local repo entries deduplicated", () => {
    const options = buildAutomationRepositoryOptions({
      repoConfigs: [
        repoConfig({ gitOwner: "acme", gitRepoName: "rocket", configured: false }),
      ],
      cloudWorkspaces: [
        cloudWorkspace("acme", "rocket"),
      ],
      repositories: [
        repository({ gitOwner: "acme", gitRepoName: "rocket" }),
        repository({ gitOwner: "proliferate-ai", gitRepoName: "proliferate" }),
      ],
    });

    expect(options.map((option) => option.label)).toEqual([
      "acme/rocket",
      "proliferate-ai/proliferate",
    ]);
  });

  it("includes GitHub repositories known only from cloud workspaces", () => {
    const options = buildAutomationRepositoryOptions({
      repoConfigs: [],
      cloudWorkspaces: [cloudWorkspace("octo", "app")],
      repositories: [],
    });

    expect(options.map((option) => option.label)).toEqual(["octo/app"]);
  });

  it("skips repositories without GitHub owner/name metadata", () => {
    const options = buildAutomationRepositoryOptions({
      repoConfigs: [],
      repositories: [repository({ gitOwner: null, gitRepoName: null })],
    });

    expect(options).toEqual([]);
  });
});
