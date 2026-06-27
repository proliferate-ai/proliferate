// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudEnvironmentsSettingsSurface } from "./CloudEnvironmentsSettingsSurface";

const cloudHooks = vi.hoisted(() => ({
  useCloudRepoConfigs: vi.fn(),
  useCloudRepoConfig: vi.fn(),
  useCloudRepoBranches: vi.fn(),
  useSaveCloudRepoConfig: vi.fn(),
  useCloudGitRepositories: vi.fn(),
  useValidateCloudRepoBranches: vi.fn(),
  useLoadCloudRepoConfig: vi.fn(),
  useCloudSecrets: vi.fn(),
  usePutCloudSecretEnvVar: vi.fn(),
  useDeleteCloudSecretEnvVar: vi.fn(),
  usePutCloudSecretFile: vi.fn(),
  useDeleteCloudSecretFile: vi.fn(),
  saveMutateAsync: vi.fn(),
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useCloudRepoConfigs: cloudHooks.useCloudRepoConfigs,
  useCloudRepoConfig: cloudHooks.useCloudRepoConfig,
  useCloudRepoBranches: cloudHooks.useCloudRepoBranches,
  useSaveCloudRepoConfig: cloudHooks.useSaveCloudRepoConfig,
  useCloudGitRepositories: cloudHooks.useCloudGitRepositories,
  useValidateCloudRepoBranches: cloudHooks.useValidateCloudRepoBranches,
  useLoadCloudRepoConfig: cloudHooks.useLoadCloudRepoConfig,
  useCloudSecrets: cloudHooks.useCloudSecrets,
  usePutCloudSecretEnvVar: cloudHooks.usePutCloudSecretEnvVar,
  useDeleteCloudSecretEnvVar: cloudHooks.useDeleteCloudSecretEnvVar,
  usePutCloudSecretFile: cloudHooks.usePutCloudSecretFile,
  useDeleteCloudSecretFile: cloudHooks.useDeleteCloudSecretFile,
}));

const cloudConfigs = [
  {
    gitOwner: "octo",
    gitRepoName: "desktop-cloud",
    configured: true,
    configuredAt: "2026-05-24T09:00:00.000Z",
    filesVersion: 0,
  },
  {
    gitOwner: "octo",
    gitRepoName: "web-only",
    configured: false,
    configuredAt: "2026-05-23T09:00:00.000Z",
    filesVersion: 1,
  },
];

function repoConfig(overrides: Record<string, unknown> = {}) {
  return {
    configured: false,
    configuredAt: "2026-05-23T09:00:00.000Z",
    defaultBranch: "main",
    envVars: { FEATURE_FLAG: "1" },
    setupScript: "npm ci",
    runCommand: "",
    filesVersion: 1,
    trackedFiles: [],
    ...overrides,
  };
}

describe("CloudEnvironmentsSettingsSurface", () => {
  beforeEach(() => {
    cloudHooks.useCloudRepoConfigs.mockReturnValue({
      data: { configs: cloudConfigs },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    cloudHooks.useCloudRepoConfig.mockReturnValue({
      data: repoConfig(),
      isLoading: false,
    });
    cloudHooks.useCloudRepoBranches.mockReturnValue({
      data: {
        defaultBranch: "main",
        branches: ["main", "develop"],
      },
      isLoading: false,
      error: null,
    });
    cloudHooks.saveMutateAsync.mockResolvedValue(repoConfig({ configured: true }));
    cloudHooks.useSaveCloudRepoConfig.mockReturnValue({
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
    cloudHooks.useLoadCloudRepoConfig.mockReturnValue({ mutateAsync: vi.fn() });
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
    expect(screen.queryByText("Cloud enabled")).not.toBeNull();
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

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(cloudHooks.saveMutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(cloudHooks.saveMutateAsync).toHaveBeenCalledWith({
      gitOwner: "octo",
      gitRepoName: "web-only",
      body: {
        configured: true,
        defaultBranch: "main",
        setupScript: "npm ci",
        runCommand: "",
      },
    });
  });
});
