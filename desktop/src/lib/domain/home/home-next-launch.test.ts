import { describe, expect, it } from "vitest";
import type {
  AgentSummary,
  GitBranchRef,
  ModelRegistry,
  ModelRegistryModel,
  Workspace,
} from "@anyharness/sdk";
import {
  buildHomeNextModelGroups,
  buildHomeNextAgentOptions,
  findHomeNextLocalWorkspace,
  findHomeNextMatchingWorkspace,
  localBranchNames,
  resolveEffectiveHomeModelSelection,
  resolveHomeLaunchTarget,
  resolveHomeNextDefaultBranchName,
  resolveSelectedHomeNextAgentOption,
} from "./home-next-launch";

function branch(overrides: Partial<GitBranchRef> & { name: string }): GitBranchRef {
  return {
    isDefault: false,
    isHead: false,
    isRemote: false,
    upstream: null,
    ...overrides,
  };
}

function workspace(overrides: Partial<Workspace>): Workspace {
  return {
    id: "workspace-1",
    kind: "worktree",
    repoRootId: "repo-root-1",
    path: "/tmp/repo/workspace-1",
    surface: "standard",
    lifecycleState: "active",
    cleanupState: "none",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

function agent(overrides: Partial<AgentSummary> & { kind: string }): AgentSummary {
  return {
    displayName: overrides.displayName ?? overrides.kind,
    readiness: "ready",
    installState: "installed",
    credentialState: "ready",
    expectedEnvVars: [],
    nativeRequired: false,
    supportsLogin: true,
    agentProcess: {
      installed: true,
      role: "agent",
    },
    ...overrides,
    kind: overrides.kind,
  };
}

function registry(overrides: Partial<ModelRegistry> & { kind: string }): ModelRegistry {
  return {
    kind: overrides.kind,
    displayName: overrides.displayName ?? overrides.kind,
    defaultModelId: overrides.defaultModelId ?? "default-model",
    models: overrides.models ?? [
      model("default-model", "Default Model", true),
    ],
  };
}

function model(id: string, displayName: string, isDefault: boolean): ModelRegistryModel {
  return {
    id,
    displayName,
    isDefault,
    status: "active",
  };
}

describe("home-next branch helpers", () => {
  it("filters remote branches and returns stable local branch names", () => {
    expect(localBranchNames([
      branch({ name: "origin/main", isRemote: true }),
      branch({ name: "feature/b" }),
      branch({ name: "feature/a" }),
      branch({ name: "feature/a" }),
    ])).toEqual(["feature/a", "feature/b"]);
  });

  it("prefers a saved default branch when it exists locally", () => {
    expect(resolveHomeNextDefaultBranchName({
      branchRefs: [branch({ name: "dev" }), branch({ name: "main" })],
      savedDefaultBranch: "dev",
      repoRootDefaultBranch: "main",
    })).toBe("dev");
  });

  it("ignores stale saved defaults and uses the repo root default", () => {
    expect(resolveHomeNextDefaultBranchName({
      branchRefs: [branch({ name: "trunk" }), branch({ name: "main" })],
      savedDefaultBranch: "old-branch",
      repoRootDefaultBranch: "trunk",
    })).toBe("trunk");
  });

  it("falls back to git default and then the first local branch without inventing main", () => {
    expect(resolveHomeNextDefaultBranchName({
      branchRefs: [branch({ name: "zebra" }), branch({ name: "alpha", isDefault: true })],
      repoRootDefaultBranch: "missing",
    })).toBe("alpha");

    expect(resolveHomeNextDefaultBranchName({
      branchRefs: [branch({ name: "zebra" }), branch({ name: "alpha" })],
      repoRootDefaultBranch: "missing",
    })).toBe("alpha");
  });

  it("returns null for remote-only or empty branch lists", () => {
    expect(resolveHomeNextDefaultBranchName({
      branchRefs: [branch({ name: "origin/main", isRemote: true })],
    })).toBeNull();
    expect(resolveHomeNextDefaultBranchName({ branchRefs: [] })).toBeNull();
  });
});

describe("findHomeNextMatchingWorkspace", () => {
  it("matches by repo root and raw branch, excluding archived and cowork workspaces", () => {
    const match = findHomeNextMatchingWorkspace({
      repoRootId: "repo-root-1",
      branchName: "feature/raw-name",
      archivedWorkspaceIds: ["archived"],
      workspaceLastInteracted: {},
      workspaces: [
        workspace({ id: "label-only", currentBranch: "Feature Raw Name" }),
        workspace({ id: "archived", currentBranch: "feature/raw-name" }),
        workspace({ id: "cowork", surface: "cowork", currentBranch: "feature/raw-name" }),
        workspace({ id: "match", currentBranch: "feature/raw-name" }),
      ],
    });

    expect(match?.id).toBe("match");
  });

  it("prefers most recently interacted, then most recently updated", () => {
    const match = findHomeNextMatchingWorkspace({
      repoRootId: "repo-root-1",
      branchName: "feature/test",
      archivedWorkspaceIds: [],
      workspaceLastInteracted: {
        old: "2026-04-03T00:00:00.000Z",
        newer: "2026-04-04T00:00:00.000Z",
      },
      workspaces: [
        workspace({ id: "updated", currentBranch: "feature/test", updatedAt: "2026-04-10T00:00:00.000Z" }),
        workspace({ id: "old", currentBranch: "feature/test", updatedAt: "2026-04-01T00:00:00.000Z" }),
        workspace({ id: "newer", currentBranch: "feature/test", updatedAt: "2026-04-02T00:00:00.000Z" }),
      ],
    });

    expect(match?.id).toBe("newer");
  });
});

describe("findHomeNextLocalWorkspace", () => {
  it("selects only non-archived local checkouts and ignores worktrees", () => {
    const match = findHomeNextLocalWorkspace({
      repoRootId: "repo-root-1",
      archivedWorkspaceIds: ["archived-local"],
      workspaceLastInteracted: {
        local: "2026-04-03T00:00:00.000Z",
      },
      workspaces: [
        workspace({ id: "worktree", kind: "worktree" }),
        workspace({ id: "archived-local", kind: "local" }),
        workspace({ id: "local", kind: "local" }),
      ],
    });

    expect(match?.id).toBe("local");
  });
});

describe("home-next agent helpers", () => {
  it("resolves ready agent options with registry-backed default models", () => {
    const options = buildHomeNextAgentOptions(
      [
        agent({ kind: "codex", displayName: "Codex" }),
        agent({ kind: "claude", displayName: "Claude" }),
      ],
      [
        registry({
          kind: "codex",
          displayName: "Codex",
          defaultModelId: "gpt-5.4",
          models: [model("gpt-5.4", "GPT-5.4", true)],
        }),
        registry({
          kind: "claude",
          displayName: "Claude",
          defaultModelId: "opus",
          models: [model("opus", "Opus", true)],
        }),
      ],
    );

    expect(options.map((option) => option.kind)).toEqual(["claude", "codex"]);
    expect(resolveSelectedHomeNextAgentOption(options, "codex")).toMatchObject({
      kind: "codex",
      modelId: "gpt-5.4",
      modelDisplayName: "GPT-5.4",
    });
  });

  it("marks ready agents without a registry model as disabled", () => {
    const options = buildHomeNextAgentOptions([agent({ kind: "codex" })], []);

    expect(options[0]).toMatchObject({
      kind: "codex",
      modelId: null,
      disabledReason: "No launchable model",
    });
  });
});

describe("home-next model helpers", () => {
  it("builds all ready registry models and treats encoded model ids as opaque", () => {
    const groups = buildHomeNextModelGroups(
      [
        agent({ kind: "cursor", displayName: "Cursor" }),
        agent({ kind: "missing", displayName: "Missing", readiness: "install_required" }),
      ],
      [
        registry({
          kind: "cursor",
          displayName: "Cursor",
          defaultModelId: "default[]",
          models: [
            model("default[]", "Auto", true),
            model("gpt-5.4[reasoning=medium,fast=false]", "GPT 5.4", false),
          ],
        }),
        registry({
          kind: "missing",
          displayName: "Missing",
          models: [model("missing-model", "Missing", true)],
        }),
      ],
      { kind: "cursor", modelId: "gpt-5.4[reasoning=medium,fast=false]" },
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.models.map((model) => model.modelId)).toEqual([
      "default[]",
      "gpt-5.4[reasoning=medium,fast=false]",
    ]);
    expect(groups[0]?.models[1]?.isSelected).toBe(true);
  });

  it("resolves model defaults from user preference, provider default, then first model", () => {
    const groups = buildHomeNextModelGroups(
      [agent({ kind: "codex" }), agent({ kind: "claude" })],
      [
        registry({
          kind: "codex",
          defaultModelId: "gpt-5.4",
          models: [
            model("gpt-5.4-mini", "Mini", false),
            model("gpt-5.4", "GPT 5.4", true),
          ],
        }),
        registry({
          kind: "claude",
          defaultModelId: null,
          models: [model("sonnet", "Sonnet", false)],
        }),
      ],
      null,
    );

    expect(resolveEffectiveHomeModelSelection(groups, null, {
      defaultChatAgentKind: "claude",
      defaultChatModelIdByAgentKind: {
        claude: "sonnet",
      },
    })).toEqual({ kind: "claude", modelId: "sonnet" });
    expect(resolveEffectiveHomeModelSelection(groups, null, {
      defaultChatAgentKind: "missing",
      defaultChatModelIdByAgentKind: {
        missing: "missing",
      },
    })).toEqual({ kind: "claude", modelId: "sonnet" });
  });
});

describe("resolveHomeLaunchTarget", () => {
  const repository = {
    sourceRoot: "/repo",
    name: "repo",
    secondaryLabel: null,
    workspaceCount: 1,
    repoRootId: "repo-root-1",
    localWorkspaceId: "worktree-source",
    gitProvider: "github",
    gitOwner: "owner",
    gitRepoName: "repo",
  };

  it("resolves cloud base branch without generating a target branch", () => {
    expect(resolveHomeLaunchTarget({
      destination: "repository",
      repository,
      repoLaunchKind: "cloud",
      baseBranch: "main",
      existingLocalWorkspaceId: null,
    })).toEqual({
      kind: "cloud",
      gitOwner: "owner",
      gitRepoName: "repo",
      baseBranch: "main",
    });
  });

  it("resolves local with only a strict local checkout id", () => {
    expect(resolveHomeLaunchTarget({
      destination: "repository",
      repository,
      repoLaunchKind: "local",
      baseBranch: null,
      existingLocalWorkspaceId: "local-1",
    })).toEqual({
      kind: "local",
      sourceRoot: "/repo",
      existingWorkspaceId: "local-1",
    });
  });
});
