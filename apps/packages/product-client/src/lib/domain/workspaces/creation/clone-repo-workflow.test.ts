import { describe, expect, it, vi } from "vitest";
import type { RepoRoot } from "@anyharness/sdk";
import { AddRepoIdentityMismatchError } from "#product/lib/domain/workspaces/creation/add-repo-workflow";
import {
  githubHttpsCloneUrl,
  runCloneRepoWorkflow,
} from "#product/lib/domain/workspaces/creation/clone-repo-workflow";

const REPO = { gitProvider: "github", gitOwner: "acme", gitRepoName: "rocket" };

function makeRepoRoot(overrides: Partial<RepoRoot> = {}): RepoRoot {
  return {
    id: "root-1",
    kind: "managed",
    path: "/Users/dev/code/rocket",
    displayName: "rocket",
    defaultBranch: "main",
    remoteProvider: "github",
    remoteOwner: "acme",
    remoteRepoName: "rocket",
    remoteUrl: "https://github.com/acme/rocket.git",
    createdAt: "2026-07-16T00:00:00Z",
    updatedAt: "2026-07-16T00:00:00Z",
    ...overrides,
  };
}

function baseArgs(overrides: Partial<Parameters<typeof runCloneRepoWorkflow>[0]> = {}) {
  return {
    repo: REPO,
    destinationPath: "/Users/dev/code/rocket",
    operationId: "op-1",
    ensureRuntimeReady: vi.fn(async () => "http://runtime"),
    materializeRepoRoot: vi.fn(async () => ({ repoRoot: makeRepoRoot() })),
    upsertRepoRootInWorkspaceCollections: vi.fn(),
    invalidateWorkspaceCollections: vi.fn(async () => {}),
    saveLocalRepoEnvironment: vi.fn(),
    unhideRepoRoot: vi.fn(),
    ...overrides,
  };
}

describe("runCloneRepoWorkflow", () => {
  it("builds an un-credentialed HTTPS clone URL", () => {
    expect(githubHttpsCloneUrl("acme", "rocket")).toBe("https://github.com/acme/rocket.git");
  });

  it("clones with the exact repository target and reuses the operation id", async () => {
    const args = baseArgs();
    await runCloneRepoWorkflow(args);

    expect(args.materializeRepoRoot).toHaveBeenCalledWith({
      operationId: "op-1",
      destinationPath: "/Users/dev/code/rocket",
      mode: "clone_or_adopt",
      repository: {
        provider: "github",
        owner: "acme",
        name: "rocket",
        cloneUrl: "https://github.com/acme/rocket.git",
      },
    });
    expect(args.upsertRepoRootInWorkspaceCollections).toHaveBeenCalledWith(
      "http://runtime",
      expect.objectContaining({ id: "root-1" }),
    );
    expect(args.saveLocalRepoEnvironment).toHaveBeenCalled();
    expect(args.invalidateWorkspaceCollections).toHaveBeenCalledWith("http://runtime");
  });

  it("rejects a wrong adopted repo and performs no mutation", async () => {
    const args = baseArgs({
      materializeRepoRoot: vi.fn(async () => ({
        repoRoot: makeRepoRoot({ remoteOwner: "other", remoteRepoName: "different" }),
      })),
    });

    await expect(runCloneRepoWorkflow(args)).rejects.toBeInstanceOf(AddRepoIdentityMismatchError);
    expect(args.upsertRepoRootInWorkspaceCollections).not.toHaveBeenCalled();
    expect(args.saveLocalRepoEnvironment).not.toHaveBeenCalled();
    expect(args.invalidateWorkspaceCollections).not.toHaveBeenCalled();
  });
});
