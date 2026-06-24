import type { RepoRoot, Workspace } from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";
import {
  buildRepositoryNewWorkspaceCommandScope,
  buildSelectedWorkspaceNewWorkspaceCommandScope,
  buildSidebarNewWorkspaceCommandScope,
  resolveNewWorkspaceCommandTarget,
} from "@/lib/domain/workspaces/creation/new-workspace-command";

const repoRoot = {
  id: "repo-root-1",
  path: "/repos/proliferate",
  displayName: "Proliferate",
  remoteProvider: "github",
  remoteOwner: "proliferate-ai",
  remoteRepoName: "proliferate",
  defaultBranch: "main",
} as RepoRoot;

const localWorkspace = {
  id: "workspace-local",
  kind: "local",
  surface: "standard",
  path: "/repos/proliferate",
  repoRootId: "repo-root-1",
  currentBranch: "main",
  originalBranch: "main",
  lifecycleState: "active",
  cleanupState: "none",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} satisfies Workspace;

const repository = {
  sourceRoot: "/repos/proliferate",
  name: "proliferate",
  secondaryLabel: null,
  workspaceCount: 1,
  repoRootId: "repo-root-1",
  localWorkspaceId: "workspace-local",
  gitProvider: "github",
  gitOwner: "proliferate-ai",
  gitRepoName: "proliferate",
  cloudConfigured: false,
  availability: "local",
} satisfies SettingsRepositoryEntry;

describe("new workspace command targets", () => {
  it("resolves sidebar menu scope for all workspace creation variants", () => {
    const scope = buildSidebarNewWorkspaceCommandScope({
      sourceRoot: "/repos/proliferate",
      localSourceRoot: "/repos/proliferate",
      repoRootId: "repo-root-1",
      cloudRepoTarget: {
        gitOwner: "proliferate-ai",
        gitRepoName: "proliferate",
      },
    });

    expect(resolveNewWorkspaceCommandTarget({
      commandKind: "local",
      scope,
    })).toMatchObject({
      commandKind: "local",
      sourceRoot: "/repos/proliferate",
      repoGroupKeyToExpand: "/repos/proliferate",
      disabledReason: null,
    });

    expect(resolveNewWorkspaceCommandTarget({
      commandKind: "worktree",
      scope,
    })).toMatchObject({
      commandKind: "worktree",
      repoRootId: "repo-root-1",
      sourceWorkspaceId: null,
      repoGroupKeyToExpand: "/repos/proliferate",
      disabledReason: null,
    });

    expect(resolveNewWorkspaceCommandTarget({
      commandKind: "cloud",
      scope,
      cloudRepoAction: { kind: "create", label: "New cloud workspace" },
    })).toMatchObject({
      commandKind: "cloud",
      cloudActionKind: "create",
      target: {
        gitOwner: "proliferate-ai",
        gitRepoName: "proliferate",
      },
      repoGroupKeyToExpand: "/repos/proliferate",
      disabledReason: null,
    });
  });

  it("uses Home repository selection and branch override as command scope", () => {
    const scope = buildRepositoryNewWorkspaceCommandScope(
      repository,
      "feature/base",
      "home",
      "main",
    );

    expect(resolveNewWorkspaceCommandTarget({
      commandKind: "worktree",
      scope,
    })).toMatchObject({
      commandKind: "worktree",
      repoRootId: "repo-root-1",
      sourceWorkspaceId: "workspace-local",
      baseBranch: "feature/base",
      defaultBranch: "main",
      repoGroupKeyToExpand: "/repos/proliferate",
      disabledReason: null,
    });

    expect(resolveNewWorkspaceCommandTarget({
      commandKind: "cloud",
      scope,
      cloudRepoAction: { kind: "create", label: "New cloud workspace" },
    })).toMatchObject({
      commandKind: "cloud",
      cloudActionKind: "create",
      target: {
        gitOwner: "proliferate-ai",
        gitRepoName: "proliferate",
        baseBranch: "feature/base",
      },
      disabledReason: null,
    });
  });

  it("falls back to the selected workspace repository when no explicit scope exists", () => {
    const scope = buildSelectedWorkspaceNewWorkspaceCommandScope({
      selectedWorkspaceId: "workspace-local",
      workspaces: [localWorkspace],
      cloudWorkspaces: [],
      repoRoots: [repoRoot],
    });

    expect(scope).toMatchObject({
      source: "selected-workspace",
      repoGroupKeyToExpand: "/repos/proliferate",
      localSourceRoot: "/repos/proliferate",
      repoRootId: "repo-root-1",
      sourceWorkspaceId: "workspace-local",
      cloudRepoTarget: {
        gitOwner: "proliferate-ai",
        gitRepoName: "proliferate",
      },
    });
  });

  it("keeps cloud configuration states distinct from missing targets", () => {
    const scope = buildSidebarNewWorkspaceCommandScope({
      sourceRoot: "/repos/proliferate",
      localSourceRoot: "/repos/proliferate",
      repoRootId: "repo-root-1",
      cloudRepoTarget: {
        gitOwner: "proliferate-ai",
        gitRepoName: "proliferate",
      },
    });

    expect(resolveNewWorkspaceCommandTarget({
      commandKind: "cloud",
      scope,
      cloudRepoAction: { kind: "loading", label: "Loading cloud..." },
    })).toEqual({
      commandKind: "cloud",
      disabledReason: "Cloud repository settings are loading.",
    });

    expect(resolveNewWorkspaceCommandTarget({
      commandKind: "cloud",
      scope,
      cloudRepoAction: { kind: "configure", label: "Configure cloud" },
    })).toMatchObject({
      commandKind: "cloud",
      cloudActionKind: "configure",
      disabledReason: null,
    });

    expect(resolveNewWorkspaceCommandTarget({
      commandKind: "cloud",
      scope: null,
      cloudRepoAction: { kind: "hidden", label: null },
    })).toEqual({
      commandKind: "cloud",
      disabledReason: "Select a repository workspace first.",
    });
  });
});
