// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";

const mocks = vi.hoisted(() => {
  const getAnonymousInstallId = vi.fn();
  return {
    getAnonymousInstallId,
    identity: { getAnonymousInstallId },
    saveEnvironment: vi.fn(),
    setRepoConfig: vi.fn(),
  };
});

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    desktop: {
      identity: mocks.identity,
    },
  }),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useRepoRootGitBranchesQuery: () => ({ data: [] }),
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useRepositories: () => ({ data: { repositories: [] } }),
  useSaveRepoEnvironment: () => ({ mutateAsync: mocks.saveEnvironment }),
}));

vi.mock("@/stores/preferences/repo-preferences-store", () => ({
  useRepoPreferencesStore: (selector: (state: {
    repoConfigs: Record<string, unknown>;
    setRepoConfig: typeof mocks.setRepoConfig;
  }) => unknown) => selector({
    repoConfigs: {},
    setRepoConfig: mocks.setRepoConfig,
  }),
}));

import { useRepositorySettings } from "./use-repository-settings";

const repository: SettingsRepositoryEntry = {
  sourceRoot: "/repo",
  name: "proliferate",
  secondaryLabel: null,
  workspaceCount: 1,
  repoRootId: "repo-root-1",
  localWorkspaceId: "workspace-1",
  gitProvider: "github",
  gitOwner: "proliferate-ai",
  gitRepoName: "proliferate",
  cloudConfigured: true,
  availability: "local_cloud",
};

describe("useRepositorySettings local environment identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAnonymousInstallId.mockResolvedValue("anonymous-install-1");
    mocks.saveEnvironment.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("saves with the host-provided anonymous install id", async () => {
    const { result } = renderHook(() => useRepositorySettings(repository));
    await waitFor(() => {
      expect(mocks.getAnonymousInstallId).toHaveBeenCalledTimes(1);
    });

    act(() => result.current.setSetupDraft("pnpm install"));
    act(() => result.current.save());

    await waitFor(() => expect(mocks.saveEnvironment).toHaveBeenCalledTimes(1));
    expect(mocks.saveEnvironment).toHaveBeenCalledWith({
      gitOwner: "proliferate-ai",
      gitRepoName: "proliferate",
      body: {
        kind: "local",
        gitProvider: "github",
        desktopInstallId: "anonymous-install-1",
        localPath: "/repo",
        defaultBranch: null,
        setupScript: "pnpm install",
        runCommand: "",
      },
    });
  });
});
