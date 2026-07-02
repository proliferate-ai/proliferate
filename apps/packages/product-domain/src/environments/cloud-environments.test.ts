import { describe, expect, it } from "vitest";

import {
  blockedCloudRepositoryBranchReason,
  blockedCloudRepositoryReason,
  buildCloudEnvironmentListItems,
  buildCoreCloudEnvironmentSaveRequest,
  buildMinimalCloudEnvironmentConfigRequest,
  buildReenableCloudEnvironmentConfigRequest,
} from "./cloud-environments";

describe("cloud environment helpers", () => {
  it("projects cloud environment configs into list items", () => {
    expect(buildCloudEnvironmentListItems({
      configs: [
        { gitOwner: "acme", gitRepoName: "cloud-only", materializationStatus: "ready" },
        { gitOwner: "acme", gitRepoName: "broken", materializationStatus: "error" },
        { gitOwner: "acme", gitRepoName: "warming", materializationStatus: "running" },
      ],
    })).toMatchObject([
      {
        id: "acme/broken",
        gitOwner: "acme",
        gitRepoName: "broken",
        fullName: "acme/broken",
        cloudStatus: "error",
        description: "Cloud-only environment",
      },
      {
        id: "acme/cloud-only",
        cloudStatus: "ready",
      },
      {
        id: "acme/warming",
        cloudStatus: "running",
      },
    ]);
  });

  it("sorts by name, ignoring materialization state", () => {
    expect(buildCloudEnvironmentListItems({
      configs: [
        { gitOwner: "acme", gitRepoName: "zulu", materializationStatus: "ready" },
        { gitOwner: "acme", gitRepoName: "alpha" },
        { gitOwner: "acme", gitRepoName: "mid", materializationStatus: "error" },
      ],
    }).map((item) => item.id)).toEqual(["acme/alpha", "acme/mid", "acme/zulu"]);
  });

  it("explains repositories that cannot be cloud environments", () => {
    expect(blockedCloudRepositoryReason({ disabled: true, defaultBranch: "main", permission: "push" }))
      .toBe("Repository is disabled on GitHub.");
    expect(blockedCloudRepositoryReason({ archived: true, defaultBranch: "main", permission: "push" }))
      .toBe("Archived repositories cannot be used for cloud environments.");
    expect(blockedCloudRepositoryReason({ defaultBranch: null, permission: "push" }))
      .toBe("Repository does not have a default branch yet.");
    expect(blockedCloudRepositoryReason({ defaultBranch: "main", permission: "pull" }))
      .toBe("GitHub write access is required for cloud environments.");
    expect(blockedCloudRepositoryReason({ defaultBranch: "main", permission: "maintain" }))
      .toBeNull();
  });

  it("checks branch metadata without requiring a default branch field", () => {
    expect(blockedCloudRepositoryBranchReason({ permission: "pull" }))
      .toBe("GitHub write access is required for cloud environments.");
    expect(blockedCloudRepositoryBranchReason({ permission: "admin" })).toBeNull();
  });

  it("builds add and re-enable requests without tracked files", () => {
    expect(buildMinimalCloudEnvironmentConfigRequest("main")).toEqual({
      kind: "cloud",
      gitProvider: "github",
      defaultBranch: "main",
      setupScript: "",
      runCommand: "",
    });

    expect(buildReenableCloudEnvironmentConfigRequest({
      defaultBranch: "release",
      setupScript: "pnpm install",
      runCommand: "pnpm dev",
    }, "main")).toEqual({
      kind: "cloud",
      gitProvider: "github",
      defaultBranch: "release",
      setupScript: "pnpm install",
      runCommand: "pnpm dev",
    });
  });

  it("builds core editor save requests without legacy env or file fields", () => {
    expect(buildCoreCloudEnvironmentSaveRequest({
      defaultBranch: null,
      setupScript: "pnpm install",
      runCommand: "pnpm dev",
    })).toEqual({
      kind: "cloud",
      gitProvider: "github",
      defaultBranch: null,
      setupScript: "pnpm install",
      runCommand: "pnpm dev",
    });
  });
});
