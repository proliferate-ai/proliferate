import { describe, expect, it } from "vitest";
import {
  buildCloudRepoSettingsHref,
  buildCloudSettingsHref,
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
      focus: {},
      inviteHandoff: null,
    });
  });

  it("redirects legacy defaults and advanced sections to agent defaults", () => {
    expect(resolveSettingsSelection({
      rawSection: "defaults",
      repositories: [],
    })).toEqual({
      activeSection: "agent-defaults",
      activeRepoSourceRoot: null,
      focus: {},
      inviteHandoff: null,
    });

    expect(resolveSettingsSelection({
      rawSection: "advanced",
      repositories: [],
    })).toEqual({
      activeSection: "agent-defaults",
      activeRepoSourceRoot: null,
      focus: {},
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
      focus: {},
      inviteHandoff: null,
    });
  });

  it("falls parked Slack bot settings links back to general", () => {
    expect(resolveSettingsSelection({
      rawSection: "slack-bot",
      repositories: [],
    })).toEqual({
      activeSection: "general",
      activeRepoSourceRoot: null,
      focus: {},
      inviteHandoff: null,
    });
  });

  it("falls removed review settings links back to general", () => {
    expect(resolveSettingsSelection({
      rawSection: "review",
      repositories: [],
    })).toEqual({
      activeSection: "general",
      activeRepoSourceRoot: null,
      focus: {},
      inviteHandoff: null,
    });
  });

  it("resolves the Admin settings sections", () => {
    for (const section of [
      "organization-integrations",
      "organization-model-policy",
      "organization-limits",
    ]) {
      expect(resolveSettingsSelection({
        rawSection: section,
        repositories: [],
      })).toEqual({
        activeSection: section,
        activeRepoSourceRoot: null,
        focus: {},
        inviteHandoff: null,
      });
    }
  });

  it("preserves checkout return focus on billing settings", () => {
    expect(resolveSettingsSelection({
      rawSection: "billing",
      rawCheckout: "success",
      repositories: [],
    })).toEqual({
      activeSection: "billing",
      activeRepoSourceRoot: null,
      focus: { checkout: "success" },
      inviteHandoff: null,
    });
  });

  it("resolves a valid repo settings link", () => {
    expect(resolveSettingsSelection({
      rawSection: "repo",
      rawRepo: "/repo-a",
      repositories: [repo({ sourceRoot: "/repo-a" })],
    })).toEqual({
      activeSection: "environments",
      activeRepoSourceRoot: "/repo-a",
      focus: {},
      inviteHandoff: null,
    });
  });

  it("keeps the environments index when section repo has no selected repo", () => {
    expect(resolveSettingsSelection({
      rawSection: "repo",
      repositories: [repo({ sourceRoot: "/repo-a" })],
    })).toEqual({
      activeSection: "environments",
      activeRepoSourceRoot: null,
      focus: {},
      inviteHandoff: null,
    });
  });

  it("keeps the environments index when a repo settings link has no matching repo", () => {
    expect(resolveSettingsSelection({
      rawSection: "repo",
      rawRepo: "/repo-a",
      repositories: [],
    })).toEqual({
      activeSection: "environments",
      activeRepoSourceRoot: null,
      focus: {},
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
      activeSection: "environments",
      activeRepoSourceRoot: "/repo-a",
      focus: {
        cloudRepoOwner: "owner",
        cloudRepoName: "name",
      },
      inviteHandoff: null,
    });
  });

  it("keeps modern cloud repo settings links keyed by owner and repo", () => {
    expect(resolveSettingsSelection({
      rawSection: "environments",
      rawCloudRepoOwner: "owner",
      rawCloudRepoName: "name",
      repositories: [repo({ sourceRoot: "/repo-a" })],
    })).toEqual({
      activeSection: "environments",
      activeRepoSourceRoot: null,
      focus: {
        cloudRepoOwner: "owner",
        cloudRepoName: "name",
      },
      inviteHandoff: null,
    });
  });

  it("prefers explicit local repo settings links when both local and cloud focus are present", () => {
    expect(resolveSettingsSelection({
      rawSection: "environments",
      rawRepo: "/repo-a",
      rawCloudRepoOwner: "owner",
      rawCloudRepoName: "name",
      repositories: [repo({ sourceRoot: "/repo-a" })],
    })).toEqual({
      activeSection: "environments",
      activeRepoSourceRoot: "/repo-a",
      focus: {
        cloudRepoOwner: "owner",
        cloudRepoName: "name",
      },
      inviteHandoff: null,
    });
  });

  it("falls legacy cloudRepo links back to environments when multiple local repos match", () => {
    expect(resolveSettingsSelection({
      rawSection: "cloudRepo",
      rawCloudRepoOwner: "owner",
      rawCloudRepoName: "name",
      repositories: [
        repo({ sourceRoot: "/repo-a", repoRootId: "repo-a" }),
        repo({ sourceRoot: "/repo-b", repoRootId: "repo-b" }),
      ],
    })).toEqual({
      activeSection: "environments",
      activeRepoSourceRoot: null,
      focus: {
        cloudRepoOwner: "owner",
        cloudRepoName: "name",
      },
      inviteHandoff: null,
    });
  });

  it("redirects legacy cloud links by focus", () => {
    expect(resolveSettingsSelection({
      rawSection: "cloud",
      repositories: [],
    })).toEqual({
      activeSection: "agent-authentication",
      activeRepoSourceRoot: null,
      focus: {},
      inviteHandoff: null,
    });

    expect(resolveSettingsSelection({
      rawSection: "cloud",
      rawTarget: "target-1",
      repositories: [],
    })).toEqual({
      activeSection: "compute",
      activeRepoSourceRoot: null,
      focus: { target: "target-1" },
      inviteHandoff: null,
    });

    expect(resolveSettingsSelection({
      rawSection: "cloud",
      rawCredential: "credential-1",
      rawKind: "claude",
      repositories: [],
    })).toEqual({
      activeSection: "agent-authentication",
      activeRepoSourceRoot: null,
      focus: { credential: "credential-1", kind: "claude" },
      inviteHandoff: null,
    });
  });

  it("resolves the worktrees settings section", () => {
    expect(resolveSettingsSelection({
      rawSection: "worktrees",
      repositories: [],
    })).toEqual({
      activeSection: "worktrees",
      activeRepoSourceRoot: null,
      focus: {},
      inviteHandoff: null,
    });
  });

  it("resolves the archived chats settings section", () => {
    expect(resolveSettingsSelection({
      rawSection: "archived-chats",
      repositories: [],
    })).toEqual({
      activeSection: "archived-chats",
      activeRepoSourceRoot: null,
      focus: {},
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
      focus: {},
      inviteHandoff: "handoff-token",
    });

    expect(resolveSettingsSelection({
      rawSection: "general",
      rawInviteHandoff: "handoff-token",
      repositories: [],
    })).toEqual({
      activeSection: "general",
      activeRepoSourceRoot: null,
      focus: {},
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

  it("builds new settings links for cloud and cloud repo helpers", () => {
    expect(buildCloudSettingsHref()).toBe("/settings?section=agent-authentication");
    expect(buildCloudRepoSettingsHref("owner", "name")).toBe(
      "/settings?section=environments&cloudRepoOwner=owner&cloudRepoName=name",
    );
  });

  it("builds environment and agent-authentication focus links", () => {
    expect(buildSettingsHref({
      section: "environments",
      repo: "/repo-a",
    })).toBe("/settings?section=environments&repo=%2Frepo-a");

    expect(buildSettingsHref({
      section: "repo",
      repo: "/repo-a",
    })).toBe("/settings?section=environments&repo=%2Frepo-a");

    expect(buildSettingsHref({
      section: "agent-authentication",
      target: "target-1",
      kind: "claude",
    })).toBe("/settings?section=agent-authentication&target=target-1&kind=claude");
  });
});
