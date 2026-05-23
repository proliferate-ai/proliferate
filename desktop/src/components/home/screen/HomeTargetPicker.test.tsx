/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeTargetPicker } from "./HomeTargetPicker";
import type { SettingsRepositoryEntry } from "@/lib/domain/settings/repositories";

const keystoneRepository: SettingsRepositoryEntry = {
  sourceRoot: "/Users/pablo/keystone",
  name: "Keystone",
  secondaryLabel: null,
  workspaceCount: 1,
  repoRootId: "repo-root-keystone",
  localWorkspaceId: "workspace-keystone-local",
  gitProvider: "github",
  gitOwner: "withkeystone",
  gitRepoName: "landing",
};

const productRepository: SettingsRepositoryEntry = {
  sourceRoot: "/Users/pablo/proliferate",
  name: "Proliferate",
  secondaryLabel: null,
  workspaceCount: 1,
  repoRootId: "repo-root-proliferate",
  localWorkspaceId: "workspace-proliferate-local",
  gitProvider: "github",
  gitOwner: "proliferate-ai",
  gitRepoName: "proliferate",
};

function renderPicker(overrides: Partial<Parameters<typeof HomeTargetPicker>[0]> = {}) {
  const onSelectCowork = vi.fn();
  const onSelectRepository = vi.fn();
  const onSelectRuntime = vi.fn();
  const onSelectBranch = vi.fn();
  const onAddRepository = vi.fn();
  const onConfigureCloud = vi.fn();

  render(
    <HomeTargetPicker
      destination="repository"
      repoLaunchKind="worktree"
      repositories={[keystoneRepository, productRepository]}
      selectedRepository={keystoneRepository}
      selectedBranchName="main"
      branchOptions={["main", "staging"]}
      branchLoading={false}
      cloudActionBySourceRoot={{
        [keystoneRepository.sourceRoot]: { kind: "create", label: "New cloud workspace" },
        [productRepository.sourceRoot]: { kind: "create", label: "New cloud workspace" },
      }}
      sshTargetOptions={[]}
      selectedSshTargetId={null}
      sshTargetsLoading={false}
      onSelectCowork={onSelectCowork}
      onSelectRepository={onSelectRepository}
      onSelectRuntime={onSelectRuntime}
      onSelectBranch={onSelectBranch}
      onAddRepository={onAddRepository}
      onConfigureCloud={onConfigureCloud}
      {...overrides}
    />,
  );

  return {
    onSelectCowork,
    onSelectRepository,
    onSelectRuntime,
    onSelectBranch,
    onAddRepository,
    onConfigureCloud,
  };
}

afterEach(() => {
  cleanup();
});

describe("HomeTargetPicker", () => {
  it("renders project and runtime as separate controls for repository launches", () => {
    renderPicker();

    expect(screen.getByRole("button", { name: /Keystone/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /New worktree/i })).toBeTruthy();
  });

  it("keeps the selected runtime when changing repositories", () => {
    const callbacks = renderPicker({
      repoLaunchKind: "cloud",
      selectedBranchName: "staging",
    });

    fireEvent.click(screen.getByRole("button", { name: /Keystone/i }));
    fireEvent.click(screen.getByRole("button", { name: /Proliferate/i }));

    expect(callbacks.onSelectRepository).toHaveBeenCalledWith(productRepository.sourceRoot);
  });

  it("changes only the runtime target from the runtime picker", () => {
    const callbacks = renderPicker();

    fireEvent.click(screen.getByRole("button", { name: /New worktree/i }));
    fireEvent.click(screen.getByRole("button", { name: /Work locally/i }));

    expect(callbacks.onSelectRuntime).toHaveBeenCalledWith("local");
  });

  it("routes unconfigured cloud choices to cloud setup", () => {
    const callbacks = renderPicker({
      cloudActionBySourceRoot: {
        [keystoneRepository.sourceRoot]: { kind: "configure", label: "Configure cloud" },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /New worktree/i }));
    fireEvent.click(screen.getByRole("button", { name: /Set up cloud/i }));

    expect(callbacks.onConfigureCloud).toHaveBeenCalledWith(keystoneRepository);
    expect(callbacks.onSelectRuntime).not.toHaveBeenCalledWith("cloud");
  });

  it("hides the runtime control for cowork starts", () => {
    renderPicker({
      destination: "cowork",
      selectedRepository: null,
    });

    expect(screen.getByRole("button", { name: /No project/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /No repository/i })).toBeNull();
  });

  it("selects a base branch from the branch picker without changing runtime", () => {
    const callbacks = renderPicker();

    fireEvent.click(screen.getByRole("button", { name: /Branch: main/i }));
    fireEvent.click(screen.getByRole("button", { name: "staging" }));

    expect(callbacks.onSelectBranch).toHaveBeenCalledWith("staging");
    expect(callbacks.onSelectRuntime).not.toHaveBeenCalled();
  });

  it("filters repositories and branches in their own selectors", () => {
    renderPicker();

    fireEvent.click(screen.getByRole("button", { name: /Project: Keystone repository/i }));
    fireEvent.change(screen.getByPlaceholderText("Search projects"), {
      target: { value: "prolif" },
    });

    expect(screen.getByRole("button", { name: /Proliferate/i })).toBeTruthy();
    expect(screen.queryByText(keystoneRepository.sourceRoot)).toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: /Branch: main/i }));
    fireEvent.change(screen.getByPlaceholderText("Search branches"), {
      target: { value: "stag" },
    });

    expect(screen.getByRole("button", { name: "staging" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "main" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Work locally/i })).toBeNull();
  });

  it("disables unavailable cloud runtime choices", () => {
    const callbacks = renderPicker({
      cloudActionBySourceRoot: {
        [keystoneRepository.sourceRoot]: { kind: "hidden", label: null },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /Runtime: New worktree/i }));
    const cloudButton = screen.getByRole("button", { name: /Cloud unavailable/i });

    expect((cloudButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(cloudButton);
    expect(callbacks.onSelectRuntime).not.toHaveBeenCalledWith("cloud");
  });
});
