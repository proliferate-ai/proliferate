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
  it("projects local and cloud environments into one repository list", () => {
    expect(buildCloudEnvironmentListItems({
      configs: [
        { gitOwner: "acme", gitRepoName: "cloud-only", configured: true, filesVersion: 2 },
        { gitOwner: "acme", gitRepoName: "disabled", configured: false, filesVersion: 3 },
        { gitOwner: "acme", gitRepoName: "local", configured: true, filesVersion: 1 },
      ],
      localCheckouts: [
        {
          gitOwner: "acme",
          gitRepoName: "local",
          sourceRoot: "/repos/local",
          name: "local",
          secondaryLabel: null,
        },
        {
          gitOwner: "acme",
          gitRepoName: "local-only",
          sourceRoot: "/repos/local-only",
          name: "local-only",
          secondaryLabel: null,
        },
        {
          gitOwner: null,
          gitRepoName: null,
          sourceRoot: "/repos/no-remote",
          name: "no-remote",
          secondaryLabel: null,
        },
      ],
    })).toMatchObject([
      {
        id: "/repos/local",
        configState: "configured",
        locationState: "local_and_cloud",
        localSourceRoot: "/repos/local",
      },
      {
        id: "/repos/local-only",
        configState: null,
        locationState: "local_only",
        localSourceRoot: "/repos/local-only",
      },
      {
        id: "/repos/no-remote",
        fullName: "no-remote",
        configState: null,
        locationState: "local_only",
      },
      {
        id: "acme/cloud-only",
        configState: "configured",
        locationState: "cloud_only",
        description: "Cloud-only environment",
      },
      {
        id: "acme/disabled",
        configState: "disabled",
        locationState: "cloud_only",
      },
    ]);
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
