// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudOnlyEnvironmentDetail } from "./CloudOnlyEnvironmentDetail";
import type { CloudRepoConfig } from "@/lib/domain/cloud/repo-configs";

const hooks = vi.hoisted(() => ({
  useCloudRepoConfig: vi.fn(),
  useCloudRepoBranches: vi.fn(),
  useSavePersonalCloudRepoConfig: vi.fn(),
  saveMutateAsync: vi.fn(),
}));

vi.mock("@/hooks/access/cloud/use-cloud-repo-config", () => ({
  useCloudRepoConfig: hooks.useCloudRepoConfig,
}));

vi.mock("@/hooks/access/cloud/use-cloud-repo-branches", () => ({
  useCloudRepoBranches: hooks.useCloudRepoBranches,
}));

vi.mock("@/hooks/access/cloud/use-save-personal-cloud-repo-config", () => ({
  useSavePersonalCloudRepoConfig: hooks.useSavePersonalCloudRepoConfig,
}));

function disabledConfig(): CloudRepoConfig {
  return {
    configured: false,
    configuredAt: "2026-05-23T09:00:00.000Z",
    defaultBranch: "main",
    envVars: { FEATURE_FLAG: "1" },
    setupScript: "npm ci",
    runCommand: "",
    filesVersion: 1,
    trackedFiles: [{
      relativePath: ".env.desktop",
      contentSha256: "abc",
      byteSize: 20,
      updatedAt: "2026-05-23T09:00:00.000Z",
      lastSyncedAt: "2026-05-23T09:00:00.000Z",
    }],
  };
}

describe("CloudOnlyEnvironmentDetail", () => {
  beforeEach(() => {
    hooks.saveMutateAsync.mockResolvedValue({
      ...disabledConfig(),
      configured: true,
      configuredAt: "2026-05-24T09:00:00.000Z",
    });
    hooks.useCloudRepoConfig.mockReturnValue({
      data: disabledConfig(),
      isLoading: false,
    });
    hooks.useCloudRepoBranches.mockReturnValue({
      data: {
        defaultBranch: "main",
        branches: ["main", "develop"],
      },
      isLoading: false,
      error: null,
    });
    hooks.useSavePersonalCloudRepoConfig.mockReturnValue({
      mutateAsync: hooks.saveMutateAsync,
      isPending: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("opens disabled cloud-only configs ready to enable and saves without files", async () => {
    render(
      <CloudOnlyEnvironmentDetail
        gitOwner="octo"
        gitRepoName="desktop-disabled"
        cloudActive
        onBack={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.queryByText("Ready to enable")).not.toBeNull();
    expect(screen.queryByText(/1 tracked file is saved/u)).not.toBeNull();
    expect(screen.queryByText("Sync tracked files")).toBeNull();

    const save = screen.getByRole("button", { name: "Save" });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() => {
      expect(hooks.saveMutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(hooks.saveMutateAsync).toHaveBeenCalledWith({
      gitOwner: "octo",
      gitRepoName: "desktop-disabled",
      body: {
        configured: true,
        defaultBranch: "main",
        envVars: { FEATURE_FLAG: "1" },
        setupScript: "npm ci",
        runCommand: "",
      },
    });
    expect(hooks.saveMutateAsync.mock.calls[0][0].body).not.toHaveProperty("files");
  });
});
