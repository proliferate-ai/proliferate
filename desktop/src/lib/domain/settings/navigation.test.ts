import { describe, expect, it } from "vitest";
import {
  resolveSettingsSelection,
} from "@/lib/domain/settings/navigation";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";

function repo(overrides: Partial<SettingsRepositoryEntry>): SettingsRepositoryEntry {
  return {
    sourceRoot: "/repo",
    name: "repo",
    secondaryLabel: null,
    workspaceCount: 1,
    repoRootId: "repo-root",
    localWorkspaceId: "workspace",
    gitProvider: "github",
    gitOwner: "owner",
    gitRepoName: "name",
    ...overrides,
  };
}

describe("settings navigation", () => {
  it("redirects the legacy configuration section to defaults", () => {
    expect(resolveSettingsSelection({
      rawSection: "configuration",
      repositories: [],
    })).toEqual({
      activeSection: "defaults",
      activeRepoSourceRoot: null,
    });
  });

  it("falls unknown sections back to the first valid section", () => {
    expect(resolveSettingsSelection({
      rawSection: "unknown",
      repositories: [],
    })).toEqual({
      activeSection: "agents",
      activeRepoSourceRoot: null,
    });
  });

  it("resolves the review settings section", () => {
    expect(resolveSettingsSelection({
      rawSection: "review",
      repositories: [],
    })).toEqual({
      activeSection: "review",
      activeRepoSourceRoot: null,
    });
  });

  it("redirects legacy cloudRepo links when exactly one local repo matches", () => {
    expect(resolveSettingsSelection({
      rawSection: "cloudRepo",
      rawCloudRepoOwner: "owner",
      rawCloudRepoName: "name",
      repositories: [repo({ sourceRoot: "/repo-a" })],
    })).toEqual({
      activeSection: "repo",
      activeRepoSourceRoot: "/repo-a",
    });
  });

  it("falls legacy cloudRepo links back to Cloud when multiple local repos match", () => {
    expect(resolveSettingsSelection({
      rawSection: "cloudRepo",
      rawCloudRepoOwner: "owner",
      rawCloudRepoName: "name",
      repositories: [
        repo({ sourceRoot: "/repo-a", repoRootId: "repo-a" }),
        repo({ sourceRoot: "/repo-b", repoRootId: "repo-b" }),
      ],
    })).toEqual({
      activeSection: "cloud",
      activeRepoSourceRoot: null,
    });
  });
});
