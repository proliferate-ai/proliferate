import type { RepoRoot, ResolveWorkspaceResponse } from "@anyharness/sdk";
import { describe, expect, it, vi } from "vitest";
import { runAddRepoWorkflow } from "./add-repo-workflow";

function makeResolvedWorkspace(
  overrides: Partial<ResolveWorkspaceResponse["workspace"]> = {},
): ResolveWorkspaceResponse["workspace"] {
  return {
    id: "repo-1",
    kind: "local",
    repoRootId: "repo-root-1",
    path: "/tmp/proliferate",
    surface: "standard",
    originalBranch: "main",
    currentBranch: "main",
    executionSummary: null,
    createdAt: "2026-04-06T10:00:00.000Z",
    updatedAt: "2026-04-06T10:00:00.000Z",
    ...overrides,
  };
}

function makeRepoRoot(overrides: Partial<RepoRoot> = {}): RepoRoot {
  return {
    id: overrides.id ?? "repo-root-1",
    kind: overrides.kind ?? "external",
    path: overrides.path ?? "/tmp/proliferate",
    displayName: overrides.displayName ?? "proliferate",
    defaultBranch: overrides.defaultBranch ?? "main",
    remoteProvider: overrides.remoteProvider ?? "github",
    remoteOwner: overrides.remoteOwner ?? "proliferate-ai",
    remoteRepoName: overrides.remoteRepoName ?? "proliferate",
    remoteUrl: overrides.remoteUrl ?? null,
    createdAt: overrides.createdAt ?? "2026-04-06T09:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-06T09:00:00.000Z",
  };
}

function makeResolveWorkspaceResponse(
  overrides: Partial<ResolveWorkspaceResponse> = {},
): ResolveWorkspaceResponse {
  return {
    repoRoot: overrides.repoRoot ?? makeRepoRoot(),
    workspace: overrides.workspace ?? makeResolvedWorkspace(),
  };
}

describe("runAddRepoWorkflow", () => {
  it("opens repo setup after registering a new repository", async () => {
    const queryClient = {
      setQueriesData: vi.fn(),
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    };
    const ensureRuntimeReady = vi.fn().mockResolvedValue("http://localhost:7007");
    const resolveWorkspaceFromPath = vi.fn().mockResolvedValue(makeResolveWorkspaceResponse());
    const unarchiveWorkspace = vi.fn();
    const openRepoSetupModal = vi.fn();

    await runAddRepoWorkflow({
      path: "/tmp/proliferate",
      queryClient,
      ensureRuntimeReady,
      resolveWorkspaceFromPath,
      unarchiveWorkspace,
      openRepoSetupModal,
      workspaceCollectionsScopeKey: (runtimeUrl) => ["workspaces", runtimeUrl],
    });

    expect(resolveWorkspaceFromPath).toHaveBeenCalledWith("/tmp/proliferate");
    expect(unarchiveWorkspace).toHaveBeenCalledWith("repo-1");
    expect(openRepoSetupModal).toHaveBeenCalledWith({
      workspaceId: "repo-1",
      sourceRoot: "/tmp/proliferate",
      repoName: "proliferate",
    });
  });

  it("reopens repo setup when registration resolves to an existing repo workspace", async () => {
    const queryClient = {
      setQueriesData: vi.fn(),
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    };
    const ensureRuntimeReady = vi.fn().mockResolvedValue("http://localhost:7007");
    const resolveWorkspaceFromPath = vi.fn().mockResolvedValue(
      makeResolveWorkspaceResponse({
        repoRoot: makeRepoRoot({
          id: "repo-root-existing",
          path: "/tmp/existing-repo",
          displayName: "existing-repo",
          remoteRepoName: "existing-repo",
        }),
        workspace: makeResolvedWorkspace({
          id: "repo-existing",
          repoRootId: "repo-root-existing",
          path: "/tmp/existing-repo",
        }),
      }),
    );
    const unarchiveWorkspace = vi.fn();
    const openRepoSetupModal = vi.fn();

    await runAddRepoWorkflow({
      path: "/tmp/existing-repo",
      queryClient,
      ensureRuntimeReady,
      resolveWorkspaceFromPath,
      unarchiveWorkspace,
      openRepoSetupModal,
      workspaceCollectionsScopeKey: (runtimeUrl) => ["workspaces", runtimeUrl],
    });

    expect(openRepoSetupModal).toHaveBeenCalledWith({
      workspaceId: "repo-existing",
      sourceRoot: "/tmp/existing-repo",
      repoName: "existing-repo",
    });
  });
});
