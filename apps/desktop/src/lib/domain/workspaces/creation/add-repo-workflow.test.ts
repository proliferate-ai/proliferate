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
    const ensureRuntimeReady = vi.fn().mockResolvedValue("http://localhost:7007");
    const resolveRepoRootFromPath = vi.fn().mockResolvedValue(makeRepoRoot());
    const upsertRepoRootInWorkspaceCollections = vi.fn();
    const invalidateWorkspaceCollections = vi.fn().mockResolvedValue(undefined);
    const saveLocalRepoEnvironment = vi.fn();
    const unhideRepoRoot = vi.fn();
    const openRepoSetupModal = vi.fn();

    await runAddRepoWorkflow({
      path: "/tmp/proliferate",
      ensureRuntimeReady,
      resolveRepoRootFromPath,
      upsertRepoRootInWorkspaceCollections,
      invalidateWorkspaceCollections,
      saveLocalRepoEnvironment,
      unhideRepoRoot,
      openRepoSetupModal,
    });

    expect(resolveRepoRootFromPath).toHaveBeenCalledWith("/tmp/proliferate");
    expect(upsertRepoRootInWorkspaceCollections).toHaveBeenCalledWith(
      "http://localhost:7007",
      expect.objectContaining({
      id: "repo-root-1",
      }),
    );
    expect(invalidateWorkspaceCollections).toHaveBeenCalledWith("http://localhost:7007");
    expect(saveLocalRepoEnvironment).toHaveBeenCalledWith(expect.objectContaining({
      id: "repo-root-1",
    }));
    expect(unhideRepoRoot).toHaveBeenCalledWith("repo-root-1");
    expect(openRepoSetupModal).toHaveBeenCalledWith({
      sourceRoot: "/tmp/proliferate",
      repoName: "proliferate",
    });
  });

  it("reopens repo setup when registration resolves to an existing repo root", async () => {
    const ensureRuntimeReady = vi.fn().mockResolvedValue("http://localhost:7007");
    const resolveRepoRootFromPath = vi.fn().mockResolvedValue(
      makeRepoRoot({
        id: "repo-root-existing",
        path: "/tmp/existing-repo",
        displayName: "existing-repo",
        remoteRepoName: "existing-repo",
      }),
    );
    const upsertRepoRootInWorkspaceCollections = vi.fn();
    const invalidateWorkspaceCollections = vi.fn().mockResolvedValue(undefined);
    const unhideRepoRoot = vi.fn();
    const openRepoSetupModal = vi.fn();

    await runAddRepoWorkflow({
      path: "/tmp/existing-repo",
      ensureRuntimeReady,
      resolveRepoRootFromPath,
      upsertRepoRootInWorkspaceCollections,
      invalidateWorkspaceCollections,
      unhideRepoRoot,
      openRepoSetupModal,
    });

    expect(openRepoSetupModal).toHaveBeenCalledWith({
      sourceRoot: "/tmp/existing-repo",
      repoName: "existing-repo",
    });
  });
});
