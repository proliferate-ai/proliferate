import { describe, expect, it } from "vitest";
import {
  buildSettingsHref,
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
  it("redirects the legacy configuration section to general", () => {
    expect(resolveSettingsSelection({
      rawSection: "configuration",
      repositories: [],
    })).toEqual({
      activeSection: "general",
      activeRepoSourceRoot: null,
      inviteHandoff: null,
    });
  });

  it("redirects legacy defaults and advanced sections to general", () => {
    expect(resolveSettingsSelection({
      rawSection: "defaults",
      repositories: [],
    })).toEqual({
      activeSection: "general",
      activeRepoSourceRoot: null,
      inviteHandoff: null,
    });

    expect(resolveSettingsSelection({
      rawSection: "advanced",
      repositories: [],
    })).toEqual({
      activeSection: "general",
      activeRepoSourceRoot: null,
      inviteHandoff: null,
    });
  });

  it("falls unknown sections back to general", () => {
    expect(resolveSettingsSelection({
      rawSection: "unknown",
      repositories: [],
    })).toEqual({
      activeSection: "general",
      activeRepoSourceRoot: null,
      inviteHandoff: null,
    });
  });

  it("resolves the review settings section", () => {
    expect(resolveSettingsSelection({
      rawSection: "review",
      repositories: [],
    })).toEqual({
      activeSection: "review",
      activeRepoSourceRoot: null,
      inviteHandoff: null,
    });
  });

  it("resolves a valid repo settings link", () => {
    expect(resolveSettingsSelection({
      rawSection: "repo",
      rawRepo: "/repo-a",
      repositories: [repo({ sourceRoot: "/repo-a" })],
    })).toEqual({
      activeSection: "repo",
      activeRepoSourceRoot: "/repo-a",
      inviteHandoff: null,
    });
  });

  it("keeps the environments index when section repo has no selected repo", () => {
    expect(resolveSettingsSelection({
      rawSection: "repo",
      repositories: [repo({ sourceRoot: "/repo-a" })],
    })).toEqual({
      activeSection: "repo",
      activeRepoSourceRoot: null,
      inviteHandoff: null,
    });
  });

  it("keeps the environments index when a repo settings link has no matching repo", () => {
    expect(resolveSettingsSelection({
      rawSection: "repo",
      rawRepo: "/repo-a",
      repositories: [],
    })).toEqual({
      activeSection: "repo",
      activeRepoSourceRoot: null,
      inviteHandoff: null,
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
      inviteHandoff: null,
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
      inviteHandoff: null,
    });
  });

  it("preserves organization invite handoff only on the organization section", () => {
    expect(resolveSettingsSelection({
      rawSection: "organization",
      rawInviteHandoff: "handoff-token",
      repositories: [],
    })).toEqual({
      activeSection: "organization",
      activeRepoSourceRoot: null,
      inviteHandoff: "handoff-token",
    });

    expect(resolveSettingsSelection({
      rawSection: "general",
      rawInviteHandoff: "handoff-token",
      repositories: [],
    })).toEqual({
      activeSection: "general",
      activeRepoSourceRoot: null,
      inviteHandoff: null,
    });
  });

  it("builds flat organization settings links with optional invite handoff", () => {
    expect(buildSettingsHref({ section: "organization" })).toBe(
      "/settings?section=organization",
    );
    expect(buildSettingsHref({
      section: "organization",
      inviteHandoff: "handoff-token",
    })).toBe("/settings?section=organization&inviteHandoff=handoff-token");
  });
});
