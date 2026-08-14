import { describe, expect, it, vi } from "vitest";
import type { CloudGitRepositorySummary } from "@proliferate/cloud-sdk";

import {
  buildGitHubAppPrerequisiteBlocker,
  buildGitHubSetupSteps,
  buildGitHubWaitingView,
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

  it("gives every prerequisite blocker a checklist, never a bare explanation", () => {
    const blockers = [
      buildGitHubAppPrerequisiteBlocker(blockerInput({ organizationId: null })),
      buildGitHubAppPrerequisiteBlocker(blockerInput({ userAuthorizationLoading: true })),
      buildGitHubAppPrerequisiteBlocker(blockerInput({ userAuthorizationConnected: false })),
      buildGitHubAppPrerequisiteBlocker(blockerInput({ installationInstalled: false })),
      buildGitHubAppPrerequisiteBlocker(blockerInput({
        installationInstalled: false,
        canManageGitHubAppInstallation: false,
      })),
    ];

    for (const blocker of blockers) {
      expect(blocker?.steps?.length, blocker?.title).toBeGreaterThan(0);
      expect(
        blocker?.steps?.filter((step) => step.status === "current").length,
        blocker?.title,
      ).toBe(1);
    }
  });

  it("keeps host-truthful return guidance on the current step and generic copy without a host", () => {
    const desktop = buildGitHubSetupSteps({
      userAuthorized: false,
      installationInstalled: false,
      returnGuidance: "GitHub opens in your browser, then returns you to Proliferate Desktop.",
    });
    expect(desktop[0]?.description).toBe(
      "GitHub opens in your browser, then returns you to Proliferate Desktop.",
    );

    const hostless = buildGitHubSetupSteps({
      userAuthorized: false,
      installationInstalled: false,
    });
    expect(hostless[0]?.description).toBe(
      "Connect the GitHub account that can access the repository.",
    );
  });

  it("parks on GitHub with a manual re-check, and on an admin for a non-privileged member", () => {
    const onCheckAgain = vi.fn();
    const onCancel = vi.fn();

    const authorizing = buildGitHubWaitingView({
      step: "authorize",
      canManageInstallation: true,
      onCheckAgain,
      onCancel,
    });
    expect(authorizing.title).toBe("Finish authorizing on GitHub");
    expect(authorizing.checkAgainLabel).toBe("I've done this — Check again");
    expect(authorizing.requestText).toBeNull();
    authorizing.onCheckAgain();
    expect(onCheckAgain).toHaveBeenCalledTimes(1);

    const installing = buildGitHubWaitingView({
      step: "install",
      canManageInstallation: true,
      onCheckAgain,
      onCancel,
    });
    expect(installing.title).toBe("Finish installing on GitHub");

    const waitingOnAdmin = buildGitHubWaitingView({
      step: "install",
      canManageInstallation: false,
      onCheckAgain,
      onCancel,
    });
    expect(waitingOnAdmin.title).toBe("Waiting on an admin");
    // The non-admin has nothing to do on GitHub, so the label drops the claim.
    expect(waitingOnAdmin.checkAgainLabel).toBe("Check again");
    expect(waitingOnAdmin.requestText).toBe(cloudEnvironmentAdminRequestCopy());
  });

  it("names the in-flight re-check so the button is not silently inert", () => {
    expect(buildGitHubWaitingView({
      step: "authorize",
      canManageInstallation: true,
      checking: true,
      onCheckAgain: vi.fn(),
      onCancel: vi.fn(),
    }).checkAgainLabel).toBe("Checking…");
  });

  it("derives host return guidance and the unchanged admin request copy", () => {
    expect(githubSetupReturnSurface("proliferate://settings", null)).toBe("desktop");
    expect(githubSetupReturnSurface("https://app.test/settings", null)).toBe("web");
    expect(cloudEnvironmentAdminRequestCopy()).toBe(
      "Please install the Proliferate GitHub App for our organization so we can add Cloud environments.",
    );
  });
});
