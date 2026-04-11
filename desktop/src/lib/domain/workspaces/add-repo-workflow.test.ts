import type { RepoRoot } from "@anyharness/sdk";
import { describe, expect, it, vi } from "vitest";
import { runAddRepoWorkflow } from "./add-repo-workflow";

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

describe("runAddRepoWorkflow", () => {
  it("opens repo setup after registering a new repository", async () => {
    const queryClient = {
      setQueriesData: vi.fn(),
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    };
    const ensureRuntimeReady = vi.fn().mockResolvedValue("http://localhost:7007");
    const resolveRepoRootFromPath = vi.fn().mockResolvedValue(makeRepoRoot());
    const unhideRepoRoot = vi.fn();
    const openRepoSetupModal = vi.fn();

    await runAddRepoWorkflow({
      path: "/tmp/proliferate",
      queryClient,
      ensureRuntimeReady,
      resolveRepoRootFromPath,
      unhideRepoRoot,
      openRepoSetupModal,
      workspaceCollectionsScopeKey: (runtimeUrl) => ["workspaces", runtimeUrl],
    });

    expect(resolveRepoRootFromPath).toHaveBeenCalledWith("/tmp/proliferate");
    expect(unhideRepoRoot).toHaveBeenCalledWith("repo-root-1");
    expect(openRepoSetupModal).toHaveBeenCalledWith({
      repoRootId: "repo-root-1",
      sourceRoot: "/tmp/proliferate",
      repoName: "proliferate",
    });
  });

  it("reopens repo setup when registration resolves to an existing repo root", async () => {
    const queryClient = {
      setQueriesData: vi.fn(),
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    };
    const ensureRuntimeReady = vi.fn().mockResolvedValue("http://localhost:7007");
    const resolveRepoRootFromPath = vi.fn().mockResolvedValue(
      makeRepoRoot({
        id: "repo-root-existing",
        path: "/tmp/existing-repo",
        displayName: "existing-repo",
        remoteRepoName: "existing-repo",
      }),
    );
    const unhideRepoRoot = vi.fn();
    const openRepoSetupModal = vi.fn();

    await runAddRepoWorkflow({
      path: "/tmp/existing-repo",
      queryClient,
      ensureRuntimeReady,
      resolveRepoRootFromPath,
      unhideRepoRoot,
      openRepoSetupModal,
      workspaceCollectionsScopeKey: (runtimeUrl) => ["workspaces", runtimeUrl],
    });

    expect(openRepoSetupModal).toHaveBeenCalledWith({
      repoRootId: "repo-root-existing",
      sourceRoot: "/tmp/existing-repo",
      repoName: "existing-repo",
    });
  });
});
