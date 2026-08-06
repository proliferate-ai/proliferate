import { describe, expect, it, vi } from "vitest";
import type { CloudGitRepositorySummary } from "@proliferate/cloud-sdk";

import {
  buildGitHubAppPrerequisiteBlocker,
  cloudEnvironmentAdminRequestCopy,
  githubSetupReturnSurface,
  mergeRepositories,
  projectCloudRepoPickerRepositories,
} from "./cloud-repo-picker-model";

function repositoryFixture(
  id: string,
  overrides: Partial<CloudGitRepositorySummary> = {},
): CloudGitRepositorySummary {
  const [gitOwner, gitRepoName] = id.split("/");
  return {
    gitProvider: "github",
    gitOwner,
    gitRepoName,
    fullName: id,
    defaultBranch: "main",
    private: false,
    fork: false,
    archived: false,
    disabled: false,
    permission: "write",
    configured: false,
    repoConfigState: "missing",
    ...overrides,
  } as CloudGitRepositorySummary;
}

function blockerInput(
  overrides: Partial<Parameters<typeof buildGitHubAppPrerequisiteBlocker>[0]> = {},
): Parameters<typeof buildGitHubAppPrerequisiteBlocker>[0] {
  return {
    organizationId: "org-1",
    canManageGitHubAppInstallation: true,
    userAuthorizationLoading: false,
    userAuthorizationConnected: true,
    userAuthorizationNeedsReconnect: false,
    authorizingUser: false,
    installationLoading: false,
    installationInstalled: true,
    installingGitHubApp: false,
    onAuthorizeUser: vi.fn(),
    onInstallGitHubApp: vi.fn(),
    onCopyAdminRequest: vi.fn(),
    returnSurface: "web",
    ...overrides,
  };
}

describe("cloud repo picker model", () => {
  it("preserves prerequisite precedence before repository selection", () => {
    expect(buildGitHubAppPrerequisiteBlocker(blockerInput({
      organizationId: null,
      userAuthorizationLoading: true,
      userAuthorizationConnected: false,
      installationInstalled: false,
    }))?.title).toBe("Organization required");
    expect(buildGitHubAppPrerequisiteBlocker(blockerInput({
      userAuthorizationConnected: false,
      installationInstalled: false,
    }))?.title).toBe("Authorize GitHub App");
    expect(buildGitHubAppPrerequisiteBlocker(blockerInput({
      installationInstalled: false,
    }))?.title).toBe("Install GitHub App");
    expect(buildGitHubAppPrerequisiteBlocker(blockerInput())).toBeNull();
  });

  it("preserves repository order while replacing duplicate catalog entries", () => {
    const current = [
      repositoryFixture("acme/one"),
      repositoryFixture("acme/two"),
    ];
    const merged = mergeRepositories(current, [
      repositoryFixture("acme/one", { defaultBranch: "trunk" }),
      repositoryFixture("acme/three"),
    ]);

    expect(merged.map((repo) => repo.fullName)).toEqual([
      "acme/one",
      "acme/two",
      "acme/three",
    ]);
    expect(merged[0]?.defaultBranch).toBe("trunk");
    expect(projectCloudRepoPickerRepositories(merged)[0]).toMatchObject({
      id: "acme/one",
      fullName: "acme/one",
      defaultBranch: "trunk",
    });
  });

  it("derives host return guidance and the unchanged admin request copy", () => {
    expect(githubSetupReturnSurface("proliferate://settings", null)).toBe("desktop");
    expect(githubSetupReturnSurface("https://app.test/settings", null)).toBe("web");
    expect(cloudEnvironmentAdminRequestCopy()).toBe(
      "Please install the Proliferate GitHub App for our organization so we can add Cloud environments.",
    );
  });
});
