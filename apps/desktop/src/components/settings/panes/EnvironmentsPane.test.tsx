// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnvironmentsPane } from "./EnvironmentsPane";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";

const cloudSurfacePropsMock = vi.hoisted(() => vi.fn());

vi.mock("@proliferate/product-surfaces/settings/CloudEnvironmentsSettingsSurface", () => ({
  CloudEnvironmentsSettingsSurface: (props: {
    mode: "cloud-only" | "hybrid";
    enabled: boolean;
    localCheckouts: Array<{ id: string; name: string; description: string }>;
    onSelectCloudEnvironment: (repo: { gitOwner: string; gitRepoName: string }) => void;
  }) => {
    cloudSurfacePropsMock(props);
    return (
      <div data-testid="cloud-environments-surface">
        <div>{props.mode}</div>
        <div>{props.enabled ? "enabled" : "disabled"}</div>
        {props.localCheckouts.map((checkout) => (
          <div key={checkout.id}>{checkout.name}</div>
        ))}
        <button
          type="button"
          onClick={() => props.onSelectCloudEnvironment({
            gitOwner: "octo",
            gitRepoName: "desktop-only",
          })}
        >
          Select cloud
        </button>
      </div>
    );
  },
}));

vi.mock("./environments/AutomaticSyncSection", () => ({
  AutomaticSyncSection: () => <div data-testid="automatic-sync" />,
}));

vi.mock("./environments/WorktreeStorageSection", () => ({
  WorktreeStorageSection: () => <div data-testid="worktree-storage" />,
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
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("passes local checkouts into the shared hybrid cloud environments surface", () => {
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

    expect(screen.queryByTestId("cloud-environments-surface")).not.toBeNull();
    expect(screen.queryByText("hybrid")).not.toBeNull();
    expect(screen.queryByText("enabled")).not.toBeNull();
    expect(screen.queryByText("project")).not.toBeNull();
    expect(cloudSurfacePropsMock).toHaveBeenCalledWith(expect.objectContaining({
      mode: "hybrid",
      enabled: true,
      localCheckouts: [expect.objectContaining({
        id: "/Users/dev/project",
        name: "project",
        gitOwner: "octo",
        gitRepoName: "desktop-cloud",
      })],
    }));
  });

  it("forwards cloud environment selection by owner and repo", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Select cloud" }));

    expect(onSelectCloudEnvironment).toHaveBeenCalledWith("octo", "desktop-only");
  });
});
