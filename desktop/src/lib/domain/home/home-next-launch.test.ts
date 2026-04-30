import { describe, expect, it } from "vitest";
import type { AgentSummary, GitBranchRef, ModelRegistry, Workspace } from "@anyharness/sdk";
import {
  buildHomeNextAgentOptions,
  findHomeNextMatchingWorkspace,
  localBranchNames,
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
      {
        id: "default-model",
        displayName: "Default Model",
        isDefault: true,
      },
    ],
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
          models: [{ id: "gpt-5.4", displayName: "GPT-5.4", isDefault: true }],
        }),
        registry({
          kind: "claude",
          displayName: "Claude",
          defaultModelId: "opus",
          models: [{ id: "opus", displayName: "Opus", isDefault: true }],
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
