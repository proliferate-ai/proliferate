import type { Workspace } from "@anyharness/sdk";
import { describe, expect, it, vi } from "vitest";
import { runAddRepoWorkflow } from "./add-repo-workflow";

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: overrides.id ?? "repo-1",
    kind: overrides.kind ?? "repo",
    surfaceKind: overrides.surfaceKind ?? "code",
    path: overrides.path ?? "/tmp/proliferate",
    sourceRepoRootPath: overrides.sourceRepoRootPath ?? "/tmp/proliferate",
    sourceWorkspaceId: overrides.sourceWorkspaceId ?? null,
    gitProvider: "gitProvider" in overrides ? overrides.gitProvider : "github",
    gitOwner: "gitOwner" in overrides ? overrides.gitOwner : "proliferate-ai",
    gitRepoName: "gitRepoName" in overrides ? overrides.gitRepoName : "proliferate",
    originalBranch: "originalBranch" in overrides ? overrides.originalBranch : "main",
    currentBranch: "currentBranch" in overrides ? overrides.currentBranch : "main",
    defaultSessionId: "defaultSessionId" in overrides ? overrides.defaultSessionId : null,
    executionSummary: overrides.executionSummary,
    createdAt: overrides.createdAt ?? "2026-04-06T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-06T10:00:00.000Z",
  };
}

describe("runAddRepoWorkflow", () => {
  it("opens repo setup after registering a new repository", async () => {
    const queryClient = {
      setQueriesData: vi.fn(),
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    };
    const ensureRuntimeReady = vi.fn().mockResolvedValue("http://localhost:7007");
    const registerRepoWorkspace = vi.fn().mockResolvedValue(makeWorkspace());
    const unarchiveWorkspace = vi.fn();
    const openRepoSetupModal = vi.fn();

    await runAddRepoWorkflow({
      path: "/tmp/proliferate",
      queryClient,
      ensureRuntimeReady,
      registerRepoWorkspace,
      unarchiveWorkspace,
      openRepoSetupModal,
      workspaceCollectionsScopeKey: (runtimeUrl) => ["workspaces", runtimeUrl],
    });

    expect(registerRepoWorkspace).toHaveBeenCalledWith({
      path: "/tmp/proliferate",
      connection: { runtimeUrl: "http://localhost:7007" },
    });
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
    const registerRepoWorkspace = vi.fn().mockResolvedValue(
      makeWorkspace({
        id: "repo-existing",
        sourceRepoRootPath: "/tmp/existing-repo",
        gitRepoName: "existing-repo",
      }),
    );
    const unarchiveWorkspace = vi.fn();
    const openRepoSetupModal = vi.fn();

    await runAddRepoWorkflow({
      path: "/tmp/existing-repo",
      queryClient,
      ensureRuntimeReady,
      registerRepoWorkspace,
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
