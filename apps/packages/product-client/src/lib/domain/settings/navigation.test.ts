import { describe, expect, it } from "vitest";
import {
  buildBillingSettingsHref,
  buildCloudRepoSettingsHref,
  buildSettingsHref,
  resolveSettingsSelection,
} from "#product/lib/domain/settings/navigation";
import { resolveRepoScopeSelection } from "#product/lib/domain/settings/repo-scope-selection";
import type { SettingsRepositoryEntry } from "#product/lib/domain/settings/repositories";

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
    cloudConfigured: false,
    availability: "local",
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
      joinOrganizationId: null,
    });
  });

  it("redirects the legacy agent-authentication section to agent api keys", () => {
    expect(resolveSettingsSelection({
      rawSection: "agent-authentication",
      repositories: [],
    })).toEqual({
      activeSection: "agent-api-keys",
      activeRepoSourceRoot: null,
      focus: {},
      joinOrganizationId: null,
    });
  });

  it("redirects legacy defaults, advanced, and agent-defaults sections to the Claude harness page", () => {
    expect(resolveSettingsSelection({
      rawSection: "defaults",
      repositories: [],
    })).toEqual({
      activeSection: "agent-claude",
      activeRepoSourceRoot: null,
      focus: {},
      joinOrganizationId: null,
    });

    expect(resolveSettingsSelection({
      rawSection: "advanced",
      repositories: [],
    })).toEqual({
      activeSection: "agent-claude",
      activeRepoSourceRoot: null,
      focus: {},
      joinOrganizationId: null,
    });

    expect(resolveSettingsSelection({
      rawSection: "agent-defaults",
      repositories: [],
    })).toEqual({
      activeSection: "agent-claude",
      activeRepoSourceRoot: null,
      focus: {},
      joinOrganizationId: null,
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
      joinOrganizationId: null,
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
      joinOrganizationId: null,
    });
  });

  it("resolves the organization limits admin section", () => {
    // organization-limits is a live admin section (budget/limits panes), so it
    // resolves to itself rather than falling back to general.
    expect(resolveSettingsSelection({
      rawSection: "organization-limits",
      repositories: [],
    })).toEqual({
      activeSection: "organization-limits",
      activeRepoSourceRoot: null,
      focus: {},
      joinOrganizationId: null,
    });
  });

  it("falls retired keyboard settings links back to general", () => {
    expect(resolveSettingsSelection({
      rawSection: "keyboard",
      repositories: [],
    })).toEqual({
      activeSection: "general",
      activeRepoSourceRoot: null,
      focus: {},
      joinOrganizationId: null,
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
      joinOrganizationId: null,
    });
  });

  it("resolves the Admin settings sections", () => {
    for (const section of [
      "organization-members",
      "organization-model-policy",
    ]) {
      expect(resolveSettingsSelection({
        rawSection: section,
        repositories: [],
      })).toEqual({
        activeSection: section,
        activeRepoSourceRoot: null,
        focus: {},
        joinOrganizationId: null,
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
      joinOrganizationId: null,
    });
  });

  it("builds and preserves an exact organization owner for Billing", () => {
    expect(buildBillingSettingsHref({
      ownerScope: "organization",
      organizationId: "org-1",
    })).toBe(
      "/settings?section=billing&billingOwnerScope=organization&billingOrganizationId=org-1",
    );
    expect(resolveSettingsSelection({
      rawSection: "billing",
      rawBillingOwnerScope: "organization",
      rawBillingOrganizationId: "org-1",
      repositories: [],
    }).focus).toEqual({
      billingOwnerScope: "organization",
      billingOrganizationId: "org-1",
    });
  });

  it("fails closed for unsupported or malformed Billing owners", () => {
    expect(buildBillingSettingsHref({
      ownerScope: "personal",
      organizationId: null,
    })).toBeNull();
    expect(buildBillingSettingsHref({
      ownerScope: "organization",
      organizationId: " ",
    })).toBeNull();
    expect(resolveSettingsSelection({
      rawSection: "billing",
      rawBillingOwnerScope: "personal",
      rawBillingOrganizationId: "org-1",
      repositories: [],
    }).focus).toEqual({});
    expect(resolveSettingsSelection({
      rawSection: "general",
      rawBillingOwnerScope: "organization",
      rawBillingOrganizationId: "org-1",
      repositories: [],
    }).focus).toEqual({});
  });

  it("preserves OAuth return focus only on the integrations section", () => {
    expect(resolveSettingsSelection({
      rawSection: "integrations",
      rawFlowId: "flow-1",
      rawStatus: "completed",
      rawFailureCode: null,
      repositories: [],
    })).toEqual({
      activeSection: "integrations",
      activeRepoSourceRoot: null,
      focus: { flowId: "flow-1", status: "completed" },
      joinOrganizationId: null,
    });

    expect(resolveSettingsSelection({
      rawSection: "integrations",
      rawStatus: "failed",
      rawFailureCode: "access_denied",
      repositories: [],
    }).focus).toEqual({ status: "failed", failureCode: "access_denied" });

    expect(resolveSettingsSelection({
      rawSection: "general",
      rawFlowId: "flow-1",
      rawStatus: "completed",
      repositories: [],
    }).focus).toEqual({});
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
      joinOrganizationId: null,
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
      joinOrganizationId: null,
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
      joinOrganizationId: null,
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
      joinOrganizationId: null,
    });
  });

  it("resolves modern cloud repo settings links to the matching repo entry", () => {
    expect(resolveSettingsSelection({
      rawSection: "environments",
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
      joinOrganizationId: null,
    });
  });

  it("resolves cloud repo settings links to cloud-only repo entries", () => {
    expect(resolveSettingsSelection({
      rawSection: "environments",
      rawCloudRepoOwner: "owner",
      rawCloudRepoName: "name",
      repositories: [repo({
        sourceRoot: "cloud:owner/name",
        repoRootId: "",
        localWorkspaceId: null,
        cloudConfigured: true,
        availability: "cloud",
      })],
    })).toEqual({
      activeSection: "environments",
      activeRepoSourceRoot: "cloud:owner/name",
      focus: {
        cloudRepoOwner: "owner",
        cloudRepoName: "name",
      },
      joinOrganizationId: null,
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
      joinOrganizationId: null,
    });
  });

  it("resolves ambiguous legacy cloudRepo links to the first matching repo", () => {
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
      activeRepoSourceRoot: "/repo-a",
      focus: {
        cloudRepoOwner: "owner",
        cloudRepoName: "name",
      },
      joinOrganizationId: null,
    });
  });

  it("redirects legacy cloud links by focus", () => {
    expect(resolveSettingsSelection({
      rawSection: "cloud",
      repositories: [],
    })).toEqual({
      activeSection: "general",
      activeRepoSourceRoot: null,
      focus: {},
      joinOrganizationId: null,
    });

    // A recognized focus still redirects: legacy cloud billing links land on
    // the billing section. (The former target -> agent-authentication redirect
    // is gone; the Bifrost auth pane was replaced by the API key pool page.)
    expect(resolveSettingsSelection({
      rawSection: "cloud",
      rawFocus: "billing",
      repositories: [],
    })).toEqual({
      activeSection: "billing",
      activeRepoSourceRoot: null,
      focus: {},
      joinOrganizationId: null,
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
      joinOrganizationId: null,
    });
  });

  it("falls retired archived-chats settings links back to general", () => {
    expect(resolveSettingsSelection({
      rawSection: "archived-chats",
      repositories: [],
    })).toEqual({
      activeSection: "general",
      activeRepoSourceRoot: null,
      focus: {},
      joinOrganizationId: null,
    });
  });

  it("preserves organization join target only on the account section (reachable by non-admins)", () => {
    expect(resolveSettingsSelection({
      rawSection: "account",
      rawJoinOrganizationId: "org-1",
      repositories: [],
    })).toEqual({
      activeSection: "account",
      activeRepoSourceRoot: null,
      focus: { joinOrganizationId: "org-1" },
      joinOrganizationId: "org-1",
    });

    expect(resolveSettingsSelection({
      rawSection: "general",
      rawJoinOrganizationId: "org-1",
      repositories: [],
    })).toEqual({
      activeSection: "general",
      activeRepoSourceRoot: null,
      focus: {},
      joinOrganizationId: null,
    });
  });

  it("builds flat organization settings and account join links", () => {
    expect(buildSettingsHref({ section: "organization" })).toBe(
      "/settings?section=organization",
    );
    expect(buildSettingsHref({
      section: "account",
      joinOrganizationId: "org-1",
    })).toBe("/settings?section=account&joinOrganizationId=org-1");
  });

  it("builds new settings links for cloud repo helpers", () => {
    expect(buildCloudRepoSettingsHref("owner", "name")).toBe(
      "/settings?section=environments&cloudRepoOwner=owner&cloudRepoName=name",
    );
  });

  it("builds environment focus links", () => {
    expect(buildSettingsHref({
      section: "environments",
      repo: "/repo-a",
    })).toBe("/settings?section=environments&repo=%2Frepo-a");

    expect(buildSettingsHref({
      section: "repo",
      repo: "/repo-a",
    })).toBe("/settings?section=environments&repo=%2Frepo-a");
  });

  it("round-trips the repo context through href building and resolution", () => {
    const href = buildSettingsHref({
      section: "environments",
      repo: "/repo-a",
      focus: { context: "local" },
    });
    expect(href).toBe("/settings?section=environments&repo=%2Frepo-a&context=local");

    expect(resolveSettingsSelection({
      rawSection: "environments",
      rawRepo: "/repo-a",
      rawContext: "local",
      repositories: [repo({ sourceRoot: "/repo-a" })],
    })).toEqual({
      activeSection: "environments",
      activeRepoSourceRoot: "/repo-a",
      focus: { context: "local" },
      joinOrganizationId: null,
    });
  });

  it("drops invalid repo context values", () => {
    expect(resolveSettingsSelection({
      rawSection: "environments",
      rawRepo: "/repo-a",
      rawContext: "hybrid",
      repositories: [repo({ sourceRoot: "/repo-a" })],
    })).toEqual({
      activeSection: "environments",
      activeRepoSourceRoot: "/repo-a",
      focus: {},
      joinOrganizationId: null,
    });
  });

  it("drops the repo context outside repo-scope sections", () => {
    expect(resolveSettingsSelection({
      rawSection: "general",
      rawContext: "cloud",
      repositories: [],
    })).toEqual({
      activeSection: "general",
      activeRepoSourceRoot: null,
      focus: {},
      joinOrganizationId: null,
    });
  });
});

describe("resolveRepoScopeSelection", () => {
  const repositories = [
    repo({ sourceRoot: "/repo-a", repoRootId: "repo-a" }),
    repo({
      sourceRoot: "cloud:owner/name",
      repoRootId: "",
      localWorkspaceId: null,
      cloudConfigured: true,
      availability: "cloud",
    }),
  ];

  it("selects the matching repo, defaulting to the first entry", () => {
    expect(resolveRepoScopeSelection({
      repositories,
      activeRepoSourceRoot: "cloud:owner/name",
      focus: {},
    }).repository?.sourceRoot).toBe("cloud:owner/name");

    expect(resolveRepoScopeSelection({
      repositories,
      activeRepoSourceRoot: null,
      focus: {},
    }).repository?.sourceRoot).toBe("/repo-a");

    expect(resolveRepoScopeSelection({
      repositories: [],
      activeRepoSourceRoot: null,
      focus: {},
    }).repository).toBeNull();
  });

  it("prefers an explicit context focus", () => {
    expect(resolveRepoScopeSelection({
      repositories,
      activeRepoSourceRoot: "cloud:owner/name",
      focus: { context: "local" },
    }).context).toBe("local");
  });

  it("defaults to cloud for cloud deep links and cloud-only repos, else local", () => {
    expect(resolveRepoScopeSelection({
      repositories,
      activeRepoSourceRoot: "/repo-a",
      focus: { cloudRepoOwner: "owner", cloudRepoName: "name" },
    }).context).toBe("cloud");

    expect(resolveRepoScopeSelection({
      repositories,
      activeRepoSourceRoot: "cloud:owner/name",
      focus: {},
    }).context).toBe("cloud");

    expect(resolveRepoScopeSelection({
      repositories,
      activeRepoSourceRoot: "/repo-a",
      focus: {},
    }).context).toBe("local");
  });
});
