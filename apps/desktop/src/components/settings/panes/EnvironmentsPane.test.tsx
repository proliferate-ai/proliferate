// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnvironmentsPane } from "./EnvironmentsPane";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";

const cloudRepoConfigsMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/access/cloud/use-cloud-repo-configs", () => ({
  useCloudRepoConfigs: cloudRepoConfigsMock,
}));

vi.mock("./environments/AutomaticSyncSection", () => ({
  AutomaticSyncSection: () => <div data-testid="automatic-sync" />,
}));

vi.mock("./environments/WorktreeStorageSection", () => ({
  WorktreeStorageSection: () => <div data-testid="worktree-storage" />,
}));

vi.mock("./environments/AddCloudEnvironmentDialogController", () => ({
  AddCloudEnvironmentDialogController: ({ open }: { open: boolean }) =>
    open ? <div data-testid="add-cloud-environment-dialog" /> : null,
}));

function repository(overrides: Partial<SettingsRepositoryEntry> = {}): SettingsRepositoryEntry {
  return {
    sourceRoot: "/Users/dev/project",
    name: "project",
    secondaryLabel: null,
    workspaceCount: 1,
    repoRootId: "repo-root",
    localWorkspaceId: "workspace",
    gitProvider: "github",
    gitOwner: "octo",
    gitRepoName: "desktop-cloud",
    ...overrides,
  };
}

describe("EnvironmentsPane", () => {
  beforeEach(() => {
    cloudRepoConfigsMock.mockReturnValue({
      data: {
        configs: [
          {
            gitOwner: "octo",
            gitRepoName: "desktop-cloud",
            configured: true,
            configuredAt: "2026-05-24T09:00:00.000Z",
            filesVersion: 0,
          },
          {
            gitOwner: "octo",
            gitRepoName: "desktop-only",
            configured: false,
            configuredAt: "2026-05-23T09:00:00.000Z",
            filesVersion: 1,
          },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders local checkouts separately from cloud environments", () => {
    render(
      <EnvironmentsPane
        repositories={[repository()]}
        selectedRepository={null}
        cloudEnabled
        cloudActive
        cloudSignInChecking={false}
        cloudSignInAvailable
        focus={{}}
        onSelectRepository={vi.fn()}
        onSelectCloudEnvironment={vi.fn()}
        onBackToList={vi.fn()}
      />,
    );

    expect(screen.queryByText("Local checkouts")).not.toBeNull();
    expect(screen.queryByText("Cloud environments")).not.toBeNull();
    expect(screen.queryByText("project")).not.toBeNull();
    expect(screen.queryByText("Cloud enabled")).not.toBeNull();
    expect(screen.queryByText("octo/desktop-cloud")).not.toBeNull();
    expect(screen.queryByText("octo/desktop-only")).not.toBeNull();
    expect(screen.queryByText("Local + cloud")).not.toBeNull();
    expect(screen.queryByText("Cloud only")).not.toBeNull();
    expect(screen.queryByText("Disabled")).not.toBeNull();
  });

  it("selects cloud-only environments by owner and repo", () => {
    const onSelectCloudEnvironment = vi.fn();
    render(
      <EnvironmentsPane
        repositories={[repository()]}
        selectedRepository={null}
        cloudEnabled
        cloudActive
        cloudSignInChecking={false}
        cloudSignInAvailable
        focus={{}}
        onSelectRepository={vi.fn()}
        onSelectCloudEnvironment={onSelectCloudEnvironment}
        onBackToList={vi.fn()}
      />,
    );

    expect(screen.queryByText("octo/desktop-only")).not.toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Configure" })[2]);

    expect(onSelectCloudEnvironment).toHaveBeenCalledWith("octo", "desktop-only");
  });
});
