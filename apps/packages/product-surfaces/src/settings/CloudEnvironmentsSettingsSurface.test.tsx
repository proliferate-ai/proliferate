// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudEnvironmentsSettingsSurface } from "./CloudEnvironmentsSettingsSurface";

const cloudHooks = vi.hoisted(() => ({
  useRepositories: vi.fn(),
  useCloudRepoBranches: vi.fn(),
  useSaveRepoEnvironment: vi.fn(),
  useCloudGitRepositories: vi.fn(),
  useValidateCloudRepoBranches: vi.fn(),
  useCloudSecrets: vi.fn(),
  usePutCloudSecretEnvVar: vi.fn(),
  useDeleteCloudSecretEnvVar: vi.fn(),
  usePutCloudSecretFile: vi.fn(),
  useDeleteCloudSecretFile: vi.fn(),
  saveMutateAsync: vi.fn(),
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useRepositories: cloudHooks.useRepositories,
  useCloudRepoBranches: cloudHooks.useCloudRepoBranches,
  useSaveRepoEnvironment: cloudHooks.useSaveRepoEnvironment,
  useCloudGitRepositories: cloudHooks.useCloudGitRepositories,
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
      defaultBranch: "main",
      setupScript: "npm ci",
      runCommand: "",
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
    cloudHooks.useCloudGitRepositories.mockReturnValue({
      data: { repositories: [], nextCursor: null },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
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
      isPending: false,
      error: null,
    });
    cloudHooks.useDeleteCloudSecretEnvVar.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      error: null,
    });
    cloudHooks.usePutCloudSecretFile.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      error: null,
    });
    cloudHooks.useDeleteCloudSecretFile.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      error: null,
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
        mode="cloud-only"
        onSelectCloudEnvironment={onSelectCloudEnvironment}
        onBackToList={vi.fn()}
      />,
    );

    expect(screen.queryByText("octo/desktop-cloud")).not.toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Configure" })[0]);

    expect(onSelectCloudEnvironment).toHaveBeenCalledWith({
      gitOwner: "octo",
      gitRepoName: "desktop-cloud",
    });
  });

  it("renders hybrid local and cloud rows as one repository list", () => {
    render(
      <CloudEnvironmentsSettingsSurface
        mode="hybrid"
        localCheckouts={[{
          id: "/Users/dev/project",
          name: "project",
          description: "/Users/dev/project",
          gitOwner: "octo",
          gitRepoName: "desktop-cloud",
        }]}
        onSelectCloudEnvironment={vi.fn()}
        onSelectLocalCheckout={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );

    expect(screen.queryByText("Repositories")).not.toBeNull();
    expect(screen.queryByText("octo/desktop-cloud")).not.toBeNull();
    expect(screen.queryByText("Local")).not.toBeNull();
    expect(screen.queryAllByText("Cloud enabled")).toHaveLength(2);
  });

  it("saves cloud-only detail edits without legacy secret fields", async () => {
    render(
      <CloudEnvironmentsSettingsSurface
        mode="cloud-only"
        selectedCloudRepo={{
          gitOwner: "octo",
          gitRepoName: "web-only",
        }}
        onSelectCloudEnvironment={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );

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
        defaultBranch: "main",
        setupScript: "npm test",
        runCommand: "",
      },
    });
  });
});
