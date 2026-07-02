// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CloudEnvironmentConfigSection } from "../src/environments/CloudEnvironmentConfigSection";
import { CloudEnvironmentList } from "../src/environments/CloudEnvironmentList";
import {
  CloudRepoPickerDialog,
  type CloudRepoPickerRepositoryView,
} from "../src/repos/CloudRepoPicker";

const pickerHandlers = {
  onQueryChange: vi.fn(),
  onManualValueChange: vi.fn(),
  onAddRepository: vi.fn(),
  onAddManual: vi.fn(),
  onLoadMore: vi.fn(),
};

function buildRepositoryView(
  overrides: Partial<CloudRepoPickerRepositoryView> = {},
): CloudRepoPickerRepositoryView {
  return {
    id: "acme/repo",
    fullName: "acme/repo",
    defaultBranch: "main",
    private: false,
    fork: false,
    archived: false,
    disabled: false,
    permission: "admin",
    configured: false,
    repoConfigState: "missing",
    ...overrides,
  };
}

describe("cloud environment product UI", () => {
  afterEach(cleanup);

  it("labels the add dialog as a cloud environment flow", () => {
    render(
      <CloudRepoPickerDialog
        open
        query=""
        manualValue=""
        repositories={[]}
        onClose={vi.fn()}
        {...pickerHandlers}
      />,
    );

    expect(screen.getByText("Add cloud environment")).toBeTruthy();
    expect(screen.getByText(/cloud sandbox/u)).toBeTruthy();
    expect(screen.getByLabelText("Search GitHub repositories")).toBeTruthy();
    expect(screen.getByLabelText("GitHub repository")).toBeTruthy();
  });

  it("adds a picked repository and surfaces inline errors", () => {
    const onAddRepository = vi.fn();

    render(
      <CloudRepoPickerDialog
        open
        query=""
        manualValue=""
        repositories={[buildRepositoryView()]}
        error="github_app_authorization_required"
        onClose={vi.fn()}
        {...pickerHandlers}
        onAddRepository={onAddRepository}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("acme/repo")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      "github_app_authorization_required",
    );
    fireEvent.click(screen.getByRole("button", { name: "Add acme/repo" }));
    expect(onAddRepository).toHaveBeenCalledWith(
      expect.objectContaining({ id: "acme/repo" }),
    );
  });

  it("renders the prerequisite blocker compactly with one action", () => {
    const onAction = vi.fn();

    render(
      <CloudRepoPickerDialog
        open
        query=""
        manualValue=""
        repositories={[]}
        blocker={{
          title: "Authorize GitHub App",
          description: "Authorize the Proliferate GitHub App so Cloud can use your GitHub identity.",
          actionLabel: "Authorize GitHub App",
          onAction,
        }}
        onClose={vi.fn()}
        {...pickerHandlers}
      />,
    );

    expect(screen.getByRole("heading", { name: "Authorize GitHub App" })).toBeTruthy();
    expect(screen.queryByLabelText("Search GitHub repositories")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Authorize GitHub App" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("renders cloud repositories and reports the selected id", () => {
    const onSelectCloud = vi.fn();

    render(
      <CloudEnvironmentList
        cloudEnvironments={[{
          id: "acme/repo",
          fullName: "acme/repo",
          description: "Cloud-only environment",
          cloudStatus: "ready",
        }, {
          id: "acme/rocket",
          fullName: "acme/rocket",
          description: "Cloud-only environment",
          cloudStatus: null,
        }]}
        onSelectCloudEnvironment={onSelectCloud}
      />,
    );

    expect(screen.getByText("Repositories")).toBeTruthy();
    expect(screen.getByText("acme/repo")).toBeTruthy();
    expect(screen.getAllByText("Cloud")).toHaveLength(2);
    expect(screen.queryByText("Local")).toBeNull();
    expect(screen.queryByText("Cloud enabled")).toBeNull();
    expect(screen.queryByText("Cloud disabled")).toBeNull();
    fireEvent.click(screen.getAllByText("Configure")[1]!);
    expect(onSelectCloud).toHaveBeenCalledWith("acme/rocket");
  });

  it("surfaces materialization state and the dashed add row", () => {
    const onAddCloudEnvironment = vi.fn();

    render(
      <CloudEnvironmentList
        cloudEnvironments={[{
          id: "acme/broken",
          fullName: "acme/broken",
          description: "Cloud-only environment",
          cloudStatus: "error",
        }, {
          id: "acme/warming",
          fullName: "acme/warming",
          description: "Cloud-only environment",
          cloudStatus: "running",
        }]}
        onSelectCloudEnvironment={vi.fn()}
        onAddCloudEnvironment={onAddCloudEnvironment}
      />,
    );

    expect(screen.getByText("Setup failed")).toBeTruthy();
    expect(screen.getByText("Setting up")).toBeTruthy();
    fireEvent.click(screen.getByText("Add cloud environment"));
    expect(onAddCloudEnvironment).toHaveBeenCalledTimes(1);
  });

  it("renders the cloud config section without dead affordances", () => {
    render(
      <CloudEnvironmentConfigSection
        statusLabel="Saved"
        statusTone="success"
        defaultBranch={null}
        githubDefaultBranch="main"
        branches={["main"]}
        setupScript=""
        runCommand=""
        onDefaultBranchChange={vi.fn()}
        onSetupScriptChange={vi.fn()}
        onRunCommandChange={vi.fn()}
        onSave={vi.fn()}
        onRevert={vi.fn()}
      />,
    );

    expect(screen.getByText("Saved")).toBeTruthy();
    expect(screen.getByLabelText("Cloud run command")).toBeTruthy();
    expect(screen.getByLabelText("Cloud setup script")).toBeTruthy();
    expect(screen.getByText("setup.sh")).toBeTruthy();
    expect(screen.queryByText("Disable cloud environment")).toBeNull();
    expect(screen.queryByText("Add variable")).toBeNull();
  });

  it("emits config section save, revert, and run command changes", () => {
    const onSave = vi.fn();
    const onRevert = vi.fn();
    const onRunCommandChange = vi.fn();

    render(
      <CloudEnvironmentConfigSection
        statusLabel="Unsaved changes"
        statusTone="warning"
        defaultBranch="main"
        githubDefaultBranch="main"
        branches={["main"]}
        setupScript=""
        runCommand=""
        onDefaultBranchChange={vi.fn()}
        onSetupScriptChange={vi.fn()}
        onRunCommandChange={onRunCommandChange}
        onSave={onSave}
        onRevert={onRevert}
      />,
    );

    fireEvent.click(screen.getByText("Revert"));
    fireEvent.click(screen.getByText("Save"));
    fireEvent.change(screen.getByLabelText("Cloud run command"), { target: { value: "make dev" } });

    expect(onRevert).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onRunCommandChange).toHaveBeenCalledWith("make dev");
  });
});
