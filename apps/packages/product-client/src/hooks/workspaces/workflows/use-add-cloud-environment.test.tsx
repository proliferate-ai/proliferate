// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudGitRepositorySummary } from "@proliferate/cloud-sdk";

import { useAddCloudEnvironment } from "./use-add-cloud-environment";

const access = vi.hoisted(() => ({
  userAuthorization: {
    data: { connected: true, action: null as string | null },
    isLoading: false,
  },
  startUserAuthorization: {
    isPending: false,
    mutateAsync: vi.fn(),
  },
  installation: {
    data: { installed: true },
    isLoading: false,
  },
  startInstallation: {
    isPending: false,
    mutateAsync: vi.fn(),
  },
  catalog: {
    data: null as { repositories: CloudGitRepositorySummary[]; nextCursor: string | null } | null,
    error: null as unknown,
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  },
  validateAuthority: { mutateAsync: vi.fn() },
  validateBranches: { mutateAsync: vi.fn() },
  saveEnvironment: { mutateAsync: vi.fn() },
}));

vi.mock("#product/hooks/access/cloud/use-github-repository-picker-access", () => ({
  useGitHubRepositoryPickerAccess: () => ({
    userAuthorization: access.userAuthorization,
    startUserAuthorization: access.startUserAuthorization,
    installation: access.installation,
    startInstallation: access.startInstallation,
    catalog: access.catalog,
  }),
}));

vi.mock("#product/hooks/access/cloud/use-cloud-environment-access", () => ({
  useCloudEnvironmentAccess: () => ({
    validateAuthority: access.validateAuthority,
    validateBranches: access.validateBranches,
    saveEnvironment: access.saveEnvironment,
  }),
}));

function repository(
  overrides: Partial<CloudGitRepositorySummary> = {},
): CloudGitRepositorySummary {
  return {
    gitProvider: "github",
    gitOwner: "acme",
    gitRepoName: "widgets",
    fullName: "acme/widgets",
    defaultBranch: "main",
    private: false,
    fork: false,
    archived: false,
    disabled: false,
    permission: "push",
    configured: false,
    repoConfigState: "missing",
    ...overrides,
  } as CloudGitRepositorySummary;
}

function renderPicker(overrides: Partial<Parameters<typeof useAddCloudEnvironment>[0]> = {}) {
  const onEnvironmentAdded = vi.fn();
  const onRepositorySelected = overrides.onRepositorySelected;
  const rendered = renderHook(() => useAddCloudEnvironment({
    enabled: true,
    organizationId: "org-1",
    canManageGitHubAppInstallation: true,
    onOpenExternalUrl: vi.fn(),
    onCopyText: vi.fn(),
    onEnvironmentAdded,
    ...overrides,
  }));
  return { ...rendered, onEnvironmentAdded, onRepositorySelected };
}

describe("useAddCloudEnvironment", () => {
  beforeEach(() => {
    access.userAuthorization.data = { connected: true, action: null };
    access.userAuthorization.isLoading = false;
    access.installation.data = { installed: true };
    access.installation.isLoading = false;
    access.catalog.data = { repositories: [repository()], nextCursor: null };
    access.catalog.error = null;
    access.catalog.isLoading = false;
    access.catalog.isFetching = false;
    access.startUserAuthorization.isPending = false;
    access.startInstallation.isPending = false;
    for (const mock of [
      access.startUserAuthorization.mutateAsync,
      access.startInstallation.mutateAsync,
      access.catalog.refetch,
      access.validateAuthority.mutateAsync,
      access.validateBranches.mutateAsync,
      access.saveEnvironment.mutateAsync,
    ]) {
      mock.mockReset();
    }
  });

  it("validates authority, validates branches, saves, then reports the added repository", async () => {
    const order: string[] = [];
    access.validateAuthority.mutateAsync.mockImplementation(async () => {
      order.push("authority");
      return { authorized: true, status: "authorized" };
    });
    access.validateBranches.mutateAsync.mockImplementation(async () => {
      order.push("branches");
      return {
        defaultBranch: "main",
        branches: ["main"],
        permission: "push",
        archived: false,
        disabled: false,
      };
    });
    access.saveEnvironment.mutateAsync.mockImplementation(async () => {
      order.push("save");
      return {};
    });
    const rendered = renderPicker({
      onEnvironmentAdded: (repoId) => {
        order.push(`added:${repoId}`);
      },
    });

    await waitFor(() => expect(rendered.result.current.repositories).toHaveLength(1));
    act(() => {
      rendered.result.current.onAddRepository(rendered.result.current.repositories[0]!);
    });

    await waitFor(() => {
      expect(order).toEqual(["authority", "branches", "save", "added:acme/widgets"]);
    });
    expect(access.saveEnvironment.mutateAsync).toHaveBeenCalledWith({
      gitOwner: "acme",
      gitRepoName: "widgets",
      body: {
        kind: "cloud",
        gitProvider: "github",
        defaultBranch: "main",
        setupScript: "",
        runCommand: "",
      },
    });
  });

  it("hands selection to the readiness host before any validation or save", async () => {
    const onRepositorySelected = vi.fn();
    const rendered = renderPicker({ onRepositorySelected });

    await waitFor(() => expect(rendered.result.current.repositories).toHaveLength(1));
    act(() => {
      rendered.result.current.onAddRepository(rendered.result.current.repositories[0]!);
    });

    await waitFor(() => {
      expect(onRepositorySelected).toHaveBeenCalledWith({
        gitOwner: "acme",
        gitRepoName: "widgets",
      });
    });
    expect(access.validateAuthority.mutateAsync).not.toHaveBeenCalled();
    expect(access.validateBranches.mutateAsync).not.toHaveBeenCalled();
    expect(access.saveEnvironment.mutateAsync).not.toHaveBeenCalled();
  });

  it("short-circuits configured repositories and stops after an authority failure", async () => {
    access.catalog.data = {
      repositories: [repository({ configured: true, repoConfigState: "configured" })],
      nextCursor: null,
    };
    const configured = renderPicker();
    await waitFor(() => expect(configured.result.current.repositories).toHaveLength(1));
    act(() => {
      configured.result.current.onAddRepository(configured.result.current.repositories[0]!);
    });
    await waitFor(() => {
      expect(configured.onEnvironmentAdded).toHaveBeenCalledWith("acme/widgets");
    });
    expect(access.validateAuthority.mutateAsync).not.toHaveBeenCalled();

    access.catalog.data = { repositories: [repository()], nextCursor: null };
    access.validateAuthority.mutateAsync.mockResolvedValue({
      authorized: false,
      status: "missing_user_repo_access",
      message: "Repository access denied.",
    });
    const rejected = renderPicker();
    await waitFor(() => expect(rejected.result.current.repositories).toHaveLength(1));
    act(() => {
      rejected.result.current.onAddRepository(rejected.result.current.repositories[0]!);
    });
    await waitFor(() => {
      expect(rejected.result.current.error).toBe("Repository access denied.");
    });
    expect(access.validateBranches.mutateAsync).not.toHaveBeenCalled();
    expect(access.saveEnvironment.mutateAsync).not.toHaveBeenCalled();
    expect(rejected.onEnvironmentAdded).not.toHaveBeenCalled();
  });

  it("routes manual owner/repository input through the same ordered sequence", async () => {
    access.catalog.data = { repositories: [], nextCursor: null };
    access.validateAuthority.mutateAsync.mockResolvedValue({
      authorized: true,
      status: "authorized",
    });
    access.validateBranches.mutateAsync.mockResolvedValue({
      defaultBranch: "trunk",
      branches: ["trunk"],
      permission: "push",
      archived: false,
      disabled: false,
    });
    access.saveEnvironment.mutateAsync.mockResolvedValue({});
    const rendered = renderPicker();

    act(() => {
      rendered.result.current.onManualValueChange("acme/manual");
    });
    act(() => {
      rendered.result.current.onAddManual();
    });

    await waitFor(() => {
      expect(rendered.onEnvironmentAdded).toHaveBeenCalledWith("acme/manual");
    });
    expect(access.validateAuthority.mutateAsync).toHaveBeenCalledWith({
      gitOwner: "acme",
      gitRepoName: "manual",
    });
    expect(access.validateBranches.mutateAsync).toHaveBeenCalledTimes(1);
    expect(access.saveEnvironment.mutateAsync).toHaveBeenCalledTimes(1);
  });
});
