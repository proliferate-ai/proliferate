import { describe, expect, it, vi } from "vitest";
import {
  continueCloudRepositoryIntent,
  repoForCloudRepositoryIntent,
  requirementForCloudRepositoryIntent,
  type CloudRepositoryIntent,
} from "#product/lib/domain/workspaces/cloud/cloud-repository-intent";

const REPO = { gitProvider: "github", gitOwner: "acme", gitRepoName: "rocket" } as const;

describe("cloud repository intent", () => {
  it("maps every cloud intent to the managed_cloud requirement", () => {
    expect(requirementForCloudRepositoryIntent({ kind: "set_up_cloud", repo: REPO }))
      .toBe("managed_cloud");
    expect(requirementForCloudRepositoryIntent({ kind: "add_cloud_repository" }))
      .toBe("managed_cloud");
  });

  it("resolves the target repo, or null for the repo-agnostic add flow", () => {
    expect(repoForCloudRepositoryIntent({ kind: "set_up_cloud", repo: REPO })).toEqual(REPO);
    expect(repoForCloudRepositoryIntent({ kind: "add_cloud_repository" })).toBeNull();
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
    });

    expect(saveCloudEnvironment).toHaveBeenCalledTimes(1);
    expect(createCloudWorkspace).not.toHaveBeenCalled();
  });

  it("does nothing for the repo-agnostic add intent (picker owns its own save)", async () => {
    const saveCloudEnvironment = vi.fn(async () => {});
    const createCloudWorkspace = vi.fn(async () => {});

    await continueCloudRepositoryIntent({
      intent: { kind: "add_cloud_repository" },
      cloudEnvironmentConfigured: false,
      saveCloudEnvironment,
      createCloudWorkspace,
    });

    expect(saveCloudEnvironment).not.toHaveBeenCalled();
    expect(createCloudWorkspace).not.toHaveBeenCalled();
  });
});
