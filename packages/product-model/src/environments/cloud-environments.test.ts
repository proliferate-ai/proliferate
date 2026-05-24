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
  it("projects configured and disabled cloud environments with local checkout state", () => {
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
      ],
    })).toMatchObject([
      {
        id: "acme/local",
        configState: "configured",
        localState: "local_and_cloud",
        localSourceRoot: "/repos/local",
      },
      {
        id: "acme/cloud-only",
        configState: "configured",
        localState: "cloud_only",
        description: "Cloud-only environment",
      },
      {
        id: "acme/disabled",
        configState: "disabled",
        localState: "cloud_only",
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
      configured: true,
      defaultBranch: "main",
      envVars: {},
      setupScript: "",
      runCommand: "",
    });

    expect(buildReenableCloudEnvironmentConfigRequest({
      configured: false,
      defaultBranch: "release",
      envVars: { API_BASE_URL: "https://api.example" },
      setupScript: "pnpm install",
      runCommand: "pnpm dev",
    }, "main")).toEqual({
      configured: true,
      defaultBranch: "release",
      envVars: { API_BASE_URL: "https://api.example" },
      setupScript: "pnpm install",
      runCommand: "pnpm dev",
    });
  });

  it("builds core editor save requests without files and normalizes env keys", () => {
    expect(buildCoreCloudEnvironmentSaveRequest({
      defaultBranch: null,
      envVars: { " B ": "2", "": "ignored", A: "1" },
      setupScript: "pnpm install",
      runCommand: "pnpm dev",
    })).toEqual({
      configured: true,
      defaultBranch: null,
      envVars: { A: "1", B: "2" },
      setupScript: "pnpm install",
      runCommand: "pnpm dev",
    });

    expect(buildCoreCloudEnvironmentSaveRequest({
      configured: false,
      defaultBranch: "main",
      envVars: { A: "1" },
      setupScript: "x",
      runCommand: "y",
    })).toEqual({
      configured: false,
      defaultBranch: null,
      envVars: {},
      setupScript: "",
      runCommand: "",
    });
  });
});
