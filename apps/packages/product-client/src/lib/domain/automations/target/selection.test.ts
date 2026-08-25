import { describe, expect, it } from "vitest";
import type { SettingsRepositoryEntry } from "#product/lib/domain/settings/repositories";
import type {
  AutomationTargetCloudWorkspaceRecord,
  AutomationTargetRepoConfigRecord,
} from "#product/lib/domain/automations/target/records";
import {
  buildAutomationTargetState,
  type AutomationTargetSelection,
} from "#product/lib/domain/automations/target/selection";

function repoConfig(
  overrides: Partial<AutomationTargetRepoConfigRecord> & {
    gitOwner: string;
    gitRepoName: string;
  },
): AutomationTargetRepoConfigRecord {
  return {
    gitOwner: overrides.gitOwner,
    gitRepoName: overrides.gitRepoName,
    configured: overrides.configured ?? true,
  };
}

function localRepository(
  overrides: Partial<SettingsRepositoryEntry> & {
    gitOwner: string;
    gitRepoName: string;
  },
): SettingsRepositoryEntry {
  return {
    sourceRoot: overrides.sourceRoot ?? `/repos/${overrides.gitRepoName}`,
    name: overrides.name ?? overrides.gitRepoName,
    secondaryLabel: overrides.secondaryLabel ?? null,
    workspaceCount: overrides.workspaceCount ?? 1,
    repoRootId: overrides.repoRootId ?? `${overrides.gitOwner}-${overrides.gitRepoName}`,
    localWorkspaceId: overrides.localWorkspaceId ?? "local-workspace",
    gitProvider: overrides.gitProvider ?? "github",
    gitOwner: overrides.gitOwner,
    gitRepoName: overrides.gitRepoName,
    cloudConfigured: overrides.cloudConfigured ?? false,
    availability: overrides.availability ?? "local",
  };
}

function cloudWorkspace(
  owner: string,
  name: string,
): AutomationTargetCloudWorkspaceRecord {
  return {
    repo: {
      provider: "github",
      owner,
      name,
    },
  };
}

function target(
  executionTarget: AutomationTargetSelection["executionTarget"],
  gitOwner = "proliferate-ai",
  gitRepoName = "proliferate",
): AutomationTargetSelection {
  return {
    executionTarget,
    gitOwner,
    gitRepoName,
  };
}

describe("buildAutomationTargetState", () => {
  // Cloud is culled (PRO-10): a fresh automation is only ever offered local
  // targets, never a cloud target or a "Configure cloud" action row.
  it("offers only the local target for a configured-cloud + local repo", () => {
    const state = buildAutomationTargetState({
      repoConfigs: [repoConfig({ gitOwner: "Proliferate-AI", gitRepoName: "Proliferate" })],
      cloudWorkspaces: [],
      repositories: [
        localRepository({
          gitOwner: "proliferate-ai",
          gitRepoName: "proliferate",
          name: "Proliferate local",
        }),
      ],
      selectedTarget: null,
    });

    expect(state.groups).toHaveLength(1);
    expect(state.groups[0]?.rows.map((row) => row.kind === "target"
      ? row.target.executionTarget
      : row.kind)).toEqual(["local"]);
    expect(state.selectedTarget).toMatchObject(target("local"));
  });

  it("no longer derives a configure-cloud action row", () => {
    const state = buildAutomationTargetState({
      repoConfigs: [repoConfig({
        gitOwner: "proliferate-ai",
        gitRepoName: "proliferate",
        configured: false,
      })],
      cloudWorkspaces: [],
      repositories: [],
      selectedTarget: null,
    });

    expect(state.canSubmit).toBe(false);
    expect(state.selectedTarget).toBeNull();
    expect(state.groups[0]?.rows ?? []).toEqual([]);
  });

  it("defaults create mode to local, then null — never cloud", () => {
    const withLocal = buildAutomationTargetState({
      repoConfigs: [repoConfig({ gitOwner: "proliferate-ai", gitRepoName: "cloud" })],
      cloudWorkspaces: [],
      repositories: [
        localRepository({ gitOwner: "proliferate-ai", gitRepoName: "local" }),
      ],
      selectedTarget: null,
    });
    const empty = buildAutomationTargetState({
      repoConfigs: [],
      cloudWorkspaces: [],
      repositories: [],
      selectedTarget: null,
    });

    expect(withLocal.selectedTarget).toMatchObject(target("local", "proliferate-ai", "local"));
    expect(empty.selectedTarget).toBeNull();
  });

  it("no longer offers an existing cloud workspace as a create target", () => {
    const state = buildAutomationTargetState({
      repoConfigs: [],
      cloudWorkspaces: [cloudWorkspace("proliferate-ai", "cloud")],
      repositories: [],
      selectedTarget: null,
    });

    expect(state.canSubmit).toBe(false);
    expect(state.selectedTarget).toBeNull();
    expect(state.groups[0]?.rows ?? []).toEqual([]);
  });

  it("constrains edit mode to the saved repo identity", () => {
    const state = buildAutomationTargetState({
      repoConfigs: [
        repoConfig({ gitOwner: "proliferate-ai", gitRepoName: "saved" }),
        repoConfig({ gitOwner: "proliferate-ai", gitRepoName: "other" }),
      ],
      cloudWorkspaces: [],
      repositories: [
        localRepository({ gitOwner: "proliferate-ai", gitRepoName: "saved" }),
        localRepository({ gitOwner: "proliferate-ai", gitRepoName: "other" }),
      ],
      selectedTarget: target("local", "proliferate-ai", "other"),
      savedTarget: target("cloud", "proliferate-ai", "saved"),
      editRepoIdentity: {
        gitOwner: "proliferate-ai",
        gitRepoName: "saved",
      },
    });

    expect(state.groups).toHaveLength(1);
    expect(state.groups[0]?.gitRepoName).toBe("saved");
    expect(state.selectedTarget).toMatchObject(target("cloud", "proliferate-ai", "saved"));
  });

  it("preserves unavailable saved edit targets as disabled rows", () => {
    const state = buildAutomationTargetState({
      repoConfigs: [],
      cloudWorkspaces: [],
      repositories: [
        localRepository({ gitOwner: "proliferate-ai", gitRepoName: "saved" }),
      ],
      selectedTarget: null,
      savedTarget: target("cloud", "proliferate-ai", "saved"),
      editRepoIdentity: {
        gitOwner: "proliferate-ai",
        gitRepoName: "saved",
      },
    });

    expect(state.selectedTarget).toMatchObject(target("cloud", "proliferate-ai", "saved"));
    expect(state.canSubmit).toBe(false);
    expect(state.selectedRow?.disabledReason).toBe("Cloud workspace is not configured.");
  });
});
