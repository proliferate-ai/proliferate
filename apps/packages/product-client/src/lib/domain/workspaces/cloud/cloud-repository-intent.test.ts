import { describe, expect, it, vi } from "vitest";
import {
  continueCloudRepositoryIntent,
  repoForCloudRepositoryIntent,
  requirementForCloudRepositoryIntent,
  type CloudRepositoryIntent,
} from "#product/lib/domain/workspaces/cloud/cloud-repository-intent";

const REPO = { gitProvider: "github", gitOwner: "acme", gitRepoName: "rocket" } as const;

describe("cloud repository intent", () => {
  it("maps Clone to GitHub access without requiring managed Cloud", () => {
    expect(requirementForCloudRepositoryIntent({ kind: "set_up_cloud", repo: REPO }))
      .toBe("managed_cloud");
    expect(requirementForCloudRepositoryIntent({ kind: "add_cloud_repository", repo: REPO }))
      .toBe("managed_cloud");
    expect(requirementForCloudRepositoryIntent({
      kind: "create_cloud_workspace",
      repo: REPO,
      continuation: { repoGroupKeyToExpand: null, baseBranch: null },
    })).toBe("managed_cloud");
    expect(requirementForCloudRepositoryIntent({ kind: "clone_from_github", repo: REPO }))
      .toBe("github_repository_access");
  });

  it("resolves the target repo for every intent", () => {
    expect(repoForCloudRepositoryIntent({ kind: "set_up_cloud", repo: REPO })).toEqual(REPO);
    expect(repoForCloudRepositoryIntent({ kind: "add_cloud_repository", repo: REPO }))
      .toEqual(REPO);
    expect(repoForCloudRepositoryIntent({ kind: "clone_from_github", repo: REPO })).toEqual(REPO);
  });

  it("saves the repo environment BEFORE creating the workspace (setup-and-continue)", async () => {
    const order: string[] = [];
    const saveCloudEnvironment = vi.fn(async () => { order.push("save"); });
    const createCloudWorkspace = vi.fn(async () => { order.push("create"); });
    const intent: CloudRepositoryIntent = {
      kind: "create_cloud_workspace",
      repo: REPO,
      continuation: { repoGroupKeyToExpand: "/repos/rocket", baseBranch: null },
    };

    await continueCloudRepositoryIntent({
      intent,
      cloudEnvironmentConfigured: false,
      saveCloudEnvironment,
      createCloudWorkspace,
      cloneFromGitHub: vi.fn(),
    });

    expect(order).toEqual(["save", "create"]);
    expect(saveCloudEnvironment).toHaveBeenCalledWith(REPO);
    expect(createCloudWorkspace).toHaveBeenCalledWith(REPO, intent.continuation);
  });

  it("does not recreate an already-configured environment on workspace-create retry", async () => {
    const saveCloudEnvironment = vi.fn(async () => {});
    const createCloudWorkspace = vi.fn(async () => {});

    await continueCloudRepositoryIntent({
      intent: {
        kind: "create_cloud_workspace",
        repo: REPO,
        continuation: { repoGroupKeyToExpand: null, baseBranch: null },
      },
      cloudEnvironmentConfigured: true,
      saveCloudEnvironment,
      createCloudWorkspace,
      cloneFromGitHub: vi.fn(),
    });

    expect(saveCloudEnvironment).not.toHaveBeenCalled();
    expect(createCloudWorkspace).toHaveBeenCalledTimes(1);
  });

  it("saves the environment but creates no workspace for a set_up_cloud intent", async () => {
    const saveCloudEnvironment = vi.fn(async () => {});
    const createCloudWorkspace = vi.fn(async () => {});

    await continueCloudRepositoryIntent({
      intent: { kind: "set_up_cloud", repo: REPO },
      cloudEnvironmentConfigured: false,
      saveCloudEnvironment,
      createCloudWorkspace,
      cloneFromGitHub: vi.fn(),
    });

    expect(saveCloudEnvironment).toHaveBeenCalledTimes(1);
    expect(createCloudWorkspace).not.toHaveBeenCalled();
  });

  it("saves and completes the selected Add Repository intent through the shared host", async () => {
    const saveCloudEnvironment = vi.fn(async () => {});
    const createCloudWorkspace = vi.fn(async () => {});
    const onRepositoryRegistered = vi.fn();

    await continueCloudRepositoryIntent({
      intent: { kind: "add_cloud_repository", repo: REPO },
      cloudEnvironmentConfigured: false,
      saveCloudEnvironment,
      createCloudWorkspace,
      onRepositoryRegistered,
      cloneFromGitHub: vi.fn(),
    });

    expect(saveCloudEnvironment).toHaveBeenCalledWith(REPO);
    expect(createCloudWorkspace).not.toHaveBeenCalled();
    expect(onRepositoryRegistered).toHaveBeenCalledWith(REPO);
  });

  it("clones locally without saving a Cloud environment", async () => {
    const saveCloudEnvironment = vi.fn(async () => {});
    const createCloudWorkspace = vi.fn(async () => {});
    const cloneFromGitHub = vi.fn(async () => {});

    await continueCloudRepositoryIntent({
      intent: { kind: "clone_from_github", repo: REPO },
      cloudEnvironmentConfigured: false,
      saveCloudEnvironment,
      createCloudWorkspace,
      cloneFromGitHub,
    });

    expect(cloneFromGitHub).toHaveBeenCalledWith(REPO);
    expect(saveCloudEnvironment).not.toHaveBeenCalled();
    expect(createCloudWorkspace).not.toHaveBeenCalled();
  });
});
