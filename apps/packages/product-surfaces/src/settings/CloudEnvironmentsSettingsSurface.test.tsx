// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudEnvironmentsSettingsSurface } from "./CloudEnvironmentsSettingsSurface";

class TestResizeObserver {
  observe() {}

  unobserve() {}

  disconnect() {}
}

vi.stubGlobal("ResizeObserver", TestResizeObserver);

const cloudHooks = vi.hoisted(() => ({
  useRepositories: vi.fn(),
  useCloudRepoBranches: vi.fn(),
  useSaveRepoEnvironment: vi.fn(),
  useGitHubAppUserAuthorizationStatus: vi.fn(),
  useStartGitHubAppUserAuthorization: vi.fn(),
  useGitHubAppInstallationStatus: vi.fn(),
  useStartGitHubAppInstallation: vi.fn(),
  useGitHubAppAccessibleRepos: vi.fn(),
  useValidateGitHubRepoAuthority: vi.fn(),
  useValidateCloudRepoBranches: vi.fn(),
  useCloudSecrets: vi.fn(),
  usePutCloudSecretEnvVar: vi.fn(),
  useDeleteCloudSecretEnvVar: vi.fn(),
  usePutCloudSecretFile: vi.fn(),
  useDeleteCloudSecretFile: vi.fn(),
  saveMutateAsync: vi.fn(),
  startUserAuthorizationMutateAsync: vi.fn(),
  startInstallationMutateAsync: vi.fn(),
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useRepositories: cloudHooks.useRepositories,
  useCloudRepoBranches: cloudHooks.useCloudRepoBranches,
  useSaveRepoEnvironment: cloudHooks.useSaveRepoEnvironment,
  useGitHubAppUserAuthorizationStatus: cloudHooks.useGitHubAppUserAuthorizationStatus,
  useStartGitHubAppUserAuthorization: cloudHooks.useStartGitHubAppUserAuthorization,
  useGitHubAppInstallationStatus: cloudHooks.useGitHubAppInstallationStatus,
  useStartGitHubAppInstallation: cloudHooks.useStartGitHubAppInstallation,
  useGitHubAppAccessibleRepos: cloudHooks.useGitHubAppAccessibleRepos,
  useValidateGitHubRepoAuthority: cloudHooks.useValidateGitHubRepoAuthority,
  useValidateCloudRepoBranches: cloudHooks.useValidateCloudRepoBranches,
  useCloudSecrets: cloudHooks.useCloudSecrets,
  usePutCloudSecretEnvVar: cloudHooks.usePutCloudSecretEnvVar,
  useDeleteCloudSecretEnvVar: cloudHooks.useDeleteCloudSecretEnvVar,
  usePutCloudSecretFile: cloudHooks.usePutCloudSecretFile,
  useDeleteCloudSecretFile: cloudHooks.useDeleteCloudSecretFile,
}));

const repoConfigs = [
  {
    id: "repo-desktop-cloud",
    ownerScope: "personal",
    gitProvider: "github",
    gitOwner: "octo",
    gitRepoName: "desktop-cloud",
    environments: [{
      id: "env-desktop-cloud",
      repoConfigId: "repo-desktop-cloud",
      kind: "cloud",
      desktopInstallId: null,
      localPath: null,
      defaultBranch: "main",
      setupScript: "",
      runCommand: "",
      materialization: {
        status: "ready",
        lastError: null,
        materializedAt: null,
      },
    }],
  },
  {
    id: "repo-web-only",
    ownerScope: "personal",
    gitProvider: "github",
    gitOwner: "octo",
    gitRepoName: "web-only",
    environments: [{
      id: "env-web-only",
      repoConfigId: "repo-web-only",
      kind: "cloud",
      desktopInstallId: null,
      localPath: null,
      defaultBranch: null,
      setupScript: "npm ci",
      runCommand: "",
      materialization: null,
    }],
  },
];

describe("CloudEnvironmentsSettingsSurface", () => {
  beforeEach(() => {
    cloudHooks.useRepositories.mockReturnValue({
      data: { repositories: repoConfigs },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    cloudHooks.useCloudRepoBranches.mockReturnValue({
      data: {
        defaultBranch: "main",
        branches: ["main", "develop"],
      },
      isLoading: false,
      error: null,
    });
    cloudHooks.saveMutateAsync.mockResolvedValue(repoConfigs[1].environments[0]);
    cloudHooks.useSaveRepoEnvironment.mockReturnValue({
      mutateAsync: cloudHooks.saveMutateAsync,
      isPending: false,
      error: null,
    });
    cloudHooks.useGitHubAppUserAuthorizationStatus.mockReturnValue({
      data: { connected: true },
      isLoading: false,
    });
    cloudHooks.useStartGitHubAppUserAuthorization.mockReturnValue({
      mutateAsync: cloudHooks.startUserAuthorizationMutateAsync,
      isPending: false,
    });
    cloudHooks.useGitHubAppInstallationStatus.mockReturnValue({
      data: { installed: true },
      isLoading: false,
    });
    cloudHooks.useStartGitHubAppInstallation.mockReturnValue({
      mutateAsync: cloudHooks.startInstallationMutateAsync,
      isPending: false,
    });
    cloudHooks.useGitHubAppAccessibleRepos.mockReturnValue({
      data: { repositories: [], nextCursor: null },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    cloudHooks.useValidateGitHubRepoAuthority.mockReturnValue({ mutateAsync: vi.fn() });
    cloudHooks.useValidateCloudRepoBranches.mockReturnValue({ mutateAsync: vi.fn() });
    cloudHooks.useCloudSecrets.mockReturnValue({
      data: {
        scopeKind: "workspace",
        version: 0,
        envVars: [],
        files: [],
        materialization: {
          status: "pending",
          lastError: null,
          materializedAt: null,
        },
      },
      isLoading: false,
      error: null,
    });
    cloudHooks.usePutCloudSecretEnvVar.mockReturnValue({
      mutate: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      error: null,
    });
    cloudHooks.useDeleteCloudSecretEnvVar.mockReturnValue({
      mutate: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      error: null,
    });
    cloudHooks.usePutCloudSecretFile.mockReturnValue({
      mutate: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      error: null,
    });
    cloudHooks.useDeleteCloudSecretFile.mockReturnValue({
      mutate: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      error: null,
    });
    cloudHooks.startUserAuthorizationMutateAsync.mockResolvedValue({
      authorizationUrl: "https://github.test/authorize",
    });
    cloudHooks.startInstallationMutateAsync.mockResolvedValue({
      installationUrl: "https://github.test/install",
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders cloud-only environments and reports selected repos by identity", () => {
    const onSelectCloudEnvironment = vi.fn();

    render(
      <CloudEnvironmentsSettingsSurface
        onSelectCloudEnvironment={onSelectCloudEnvironment}
        onBackToList={vi.fn()}
      />,
    );

    expect(screen.queryByText("octo/desktop-cloud")).not.toBeNull();
    expect(screen.queryAllByText("Cloud")).toHaveLength(2);
    expect(screen.queryByText("Cloud enabled")).toBeNull();
    expect(screen.queryByText("Cloud disabled")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Configure" })[0]);

    expect(onSelectCloudEnvironment).toHaveBeenCalledWith({
      gitOwner: "octo",
      gitRepoName: "desktop-cloud",
    });
  });

  it("flags failed materialization on list rows", () => {
    cloudHooks.useRepositories.mockReturnValue({
      data: {
        repositories: [{
          ...repoConfigs[0],
          environments: [{
            ...repoConfigs[0].environments[0],
            materialization: {
              status: "error",
              lastError: "setup exploded",
              materializedAt: null,
            },
          }],
        }],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(
      <CloudEnvironmentsSettingsSurface
        onSelectCloudEnvironment={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );

    expect(screen.queryByText("Setup failed")).not.toBeNull();
  });

  it("explains the unavailable state when cloud is disabled", () => {
    cloudHooks.useRepositories.mockImplementation((enabled?: boolean) => (
      enabled
        ? {
            data: { repositories: repoConfigs },
            isLoading: false,
            isError: false,
            refetch: vi.fn(),
          }
        : {
            data: undefined,
            isLoading: false,
            isError: false,
            refetch: vi.fn(),
          }
    ));

    render(
      <CloudEnvironmentsSettingsSurface
        enabled={false}
        cloudUnavailableReason="Sign in to Proliferate Cloud to manage cloud environments."
        onSelectCloudEnvironment={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );

    expect(screen.queryByText("Cloud environments unavailable")).not.toBeNull();
    expect(
      screen.queryByText("Sign in to Proliferate Cloud to manage cloud environments."),
    ).not.toBeNull();
    expect(screen.queryByText("Add cloud environment")).toBeNull();
  });

  it("offers a retry row when the cloud list fails to load", () => {
    const refetch = vi.fn();
    cloudHooks.useRepositories.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });

    render(
      <CloudEnvironmentsSettingsSurface
        onSelectCloudEnvironment={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );

    expect(screen.queryByText("Couldn't load cloud environments")).not.toBeNull();
    expect(screen.queryByText("Cloud environments could not be loaded.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("opens the add flow from the dashed add row", () => {
    render(
      <CloudEnvironmentsSettingsSurface
        organizationId="org-1"
        onSelectCloudEnvironment={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add cloud environment" }));

    expect(screen.queryByLabelText("Search GitHub repositories")).not.toBeNull();
  });

  it("saves cloud-only detail edits through the config section", async () => {
    render(
      <CloudEnvironmentsSettingsSurface
        selectedCloudRepo={{
          gitOwner: "octo",
          gitRepoName: "web-only",
        }}
        onSelectCloudEnvironment={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "GitHub default (main)" }));
    fireEvent.click(await screen.findByText("develop"));

    fireEvent.change(screen.getByLabelText("Cloud run command"), {
      target: { value: "make dev" },
    });
    fireEvent.change(screen.getByLabelText("Cloud setup script"), {
      target: { value: "npm test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(cloudHooks.saveMutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(cloudHooks.saveMutateAsync).toHaveBeenCalledWith({
      gitOwner: "octo",
      gitRepoName: "web-only",
      body: {
        kind: "cloud",
        gitProvider: "github",
        defaultBranch: "develop",
        setupScript: "npm test",
        runCommand: "make dev",
      },
    });
  });

  it("blocks adding cloud environments until the user authorizes the GitHub App", async () => {
    const onOpenExternalUrl = vi.fn();
    cloudHooks.useGitHubAppUserAuthorizationStatus.mockReturnValue({
      data: { connected: false, action: "connect" },
      isLoading: false,
    });

    render(
      <CloudEnvironmentsSettingsSurface
        organizationId="org-1"
        userAuthorizationReturnTo="proliferate://settings/environments"
        onOpenExternalUrl={onOpenExternalUrl}
        onSelectCloudEnvironment={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add cloud environment" }));

    expect(screen.queryByRole("heading", { name: "Authorize GitHub App" })).not.toBeNull();
    expect(screen.queryByLabelText("Search GitHub repositories")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Authorize GitHub App" }));

    await waitFor(() => {
      expect(cloudHooks.startUserAuthorizationMutateAsync).toHaveBeenCalledWith({
        returnTo: "proliferate://settings/environments",
      });
    });
    expect(onOpenExternalUrl).toHaveBeenCalledWith("https://github.test/authorize");
  });

  it("blocks adding cloud environments until an admin installs the GitHub App", async () => {
    const onOpenExternalUrl = vi.fn();
    cloudHooks.useGitHubAppInstallationStatus.mockReturnValue({
      data: { installed: false },
      isLoading: false,
    });

    render(
      <CloudEnvironmentsSettingsSurface
        organizationId="org-1"
        canManageGitHubAppInstallation
        installationReturnTo="proliferate://settings/environments"
        onOpenExternalUrl={onOpenExternalUrl}
        onSelectCloudEnvironment={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add cloud environment" }));

    expect(screen.queryByRole("heading", { name: "Install GitHub App" })).not.toBeNull();
    expect(screen.queryByLabelText("Search GitHub repositories")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Install GitHub App" }));

    await waitFor(() => {
      expect(cloudHooks.startInstallationMutateAsync).toHaveBeenCalledWith({
        organizationId: "org-1",
        options: {
          returnTo: "proliferate://settings/environments",
        },
      });
    });
    expect(onOpenExternalUrl).toHaveBeenCalledWith("https://github.test/install");
  });
});
