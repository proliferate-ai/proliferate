import { describe, expect, it } from "vitest";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";
import type {
  CloudRepoConfigSummary,
  CloudWorkspaceSummary,
} from "@/lib/integrations/cloud/client";
import {
  buildAutomationTargetState,
  type AutomationTargetSelection,
} from "./target-selection";

function repoConfig(
  overrides: Partial<CloudRepoConfigSummary> & {
    gitOwner: string;
    gitRepoName: string;
  },
): CloudRepoConfigSummary {
  return {
    gitOwner: overrides.gitOwner,
    gitRepoName: overrides.gitRepoName,
    configured: overrides.configured ?? true,
    configuredAt: overrides.configuredAt ?? "2026-01-01T00:00:00Z",
    filesVersion: overrides.filesVersion ?? 1,
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
  };
}

function cloudWorkspace(
  owner: string,
  name: string,
): CloudWorkspaceSummary {
  return {
    id: `${owner}-${name}-workspace`,
    displayName: null,
    repo: {
      provider: "github",
      owner,
      name,
      branch: "main",
      baseBranch: "main",
    },
    status: "ready",
    workspaceStatus: "ready",
    runtime: {
      environmentId: "runtime",
      generation: 1,
      status: "running",
      actionBlockKind: null,
      actionBlockReason: null,
    },
    statusDetail: null,
    lastError: null,
    templateVersion: null,
    updatedAt: null,
    createdAt: null,
    actionBlockKind: null,
    actionBlockReason: null,
    postReadyPhase: "complete",
    postReadyFilesTotal: 0,
    postReadyFilesApplied: 0,
    postReadyStartedAt: null,
    postReadyCompletedAt: null,
    repoFilesLastFailedPath: null,
    origin: null,
  } as CloudWorkspaceSummary;
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
  it("merges local and cloud metadata for the same repo", () => {
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
      : row.kind)).toEqual(["cloud", "local"]);
    expect(state.selectedTarget).toMatchObject(target("cloud"));
  });

  it("derives configure-cloud rows as action-only rows", () => {
    const state = buildAutomationTargetState({
      repoConfigs: [repoConfig({
        gitOwner: "proliferate-ai",
        gitRepoName: "proliferate",
        configured: false,
        configuredAt: null,
      })],
      cloudWorkspaces: [],
      repositories: [],
      selectedTarget: null,
    });

    expect(state.canSubmit).toBe(false);
    expect(state.selectedTarget).toBeNull();
    expect(state.groups[0]?.rows).toMatchObject([
      {
        kind: "configureCloud",
        gitOwner: "proliferate-ai",
        gitRepoName: "proliferate",
      },
    ]);
  });

  it("defaults create mode to usable cloud, then local, then null", () => {
    const cloud = buildAutomationTargetState({
      repoConfigs: [repoConfig({ gitOwner: "proliferate-ai", gitRepoName: "cloud" })],
      cloudWorkspaces: [],
      repositories: [
        localRepository({ gitOwner: "proliferate-ai", gitRepoName: "local" }),
      ],
      selectedTarget: null,
    });
    const unavailableCloud = buildAutomationTargetState({
      repoConfigs: [repoConfig({ gitOwner: "proliferate-ai", gitRepoName: "cloud" })],
      cloudWorkspaces: [],
      repositories: [
        localRepository({ gitOwner: "proliferate-ai", gitRepoName: "local" }),
      ],
      selectedTarget: null,
      cloudAvailable: false,
    });
    const empty = buildAutomationTargetState({
      repoConfigs: [],
      cloudWorkspaces: [],
      repositories: [],
      selectedTarget: null,
    });

    expect(cloud.selectedTarget).toMatchObject(target("cloud", "proliferate-ai", "cloud"));
    expect(unavailableCloud.selectedTarget).toMatchObject(target("local", "proliferate-ai", "local"));
    expect(empty.selectedTarget).toBeNull();
  });

  it("can use an existing cloud workspace as a configured cloud target", () => {
    const state = buildAutomationTargetState({
      repoConfigs: [],
      cloudWorkspaces: [cloudWorkspace("proliferate-ai", "cloud")],
      repositories: [],
      selectedTarget: null,
    });

    expect(state.canSubmit).toBe(true);
    expect(state.selectedTarget).toMatchObject(target("cloud", "proliferate-ai", "cloud"));
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
