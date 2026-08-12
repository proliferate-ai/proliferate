// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CloudEnvironmentConfigSection } from "#product/components/settings/panes/repo/CloudEnvironmentConfigSection";
import { CloudEnvironmentList } from "#product/components/settings/panes/repo/CloudEnvironmentList";
import { CloudRepoPickerDialog } from "#product/components/workspace/repo-setup/CloudRepoPicker";
import type { CloudRepoPickerRepositoryView } from "#product/lib/domain/workspaces/cloud/cloud-repo-picker-view";

/**
 * SettingsGroup dividers are `<div aria-hidden class="mx-3.5 h-px bg-border-light">`
 * elements it interleaves between children. Counting them is what would have
 * caught the fragment regression: `Children.toArray` treats a single
 * fragment as one child, so wrapping a list of rows in `<>...</>` silently
 * drops every divider between them.
 */
function countGroupDividers(container: HTMLElement): number {
  return container.querySelectorAll(".bg-border-light").length;
}

/** Badge renders a pill: `rounded-full` + `border`. A plain status span must not. */
function isBadgeElement(element: Element): boolean {
  return element.className.includes("rounded-full");
}

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

    const { container } = render(
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
    const cloudChips = screen.getAllByText("Cloud");
    expect(cloudChips).toHaveLength(2);
    // Trailing row status is a plain muted span, never a Badge pill.
    cloudChips.forEach((chip) => expect(isBadgeElement(chip)).toBe(false));
    expect(screen.queryByText("Local")).toBeNull();
    expect(screen.queryByText("Cloud enabled")).toBeNull();
    expect(screen.queryByText("Cloud disabled")).toBeNull();
    // Two rows means SettingsGroup must render exactly one divider between
    // them. A fragment wrapping the rows would collapse this to zero.
    expect(countGroupDividers(container)).toBe(1);
    fireEvent.click(screen.getAllByText("Configure")[1]!);
    expect(onSelectCloud).toHaveBeenCalledWith("acme/rocket");
  });

  it("renders a divider between every environment row, never a collapsed fragment", () => {
    const { container } = render(
      <CloudEnvironmentList
        cloudEnvironments={[
          { id: "acme/one", fullName: "acme/one", description: "Cloud-only environment", cloudStatus: "ready" },
          { id: "acme/two", fullName: "acme/two", description: "Cloud-only environment", cloudStatus: "ready" },
          { id: "acme/three", fullName: "acme/three", description: "Cloud-only environment", cloudStatus: "ready" },
        ]}
        onSelectCloudEnvironment={vi.fn()}
      />,
    );

    // N environment rows -> N-1 dividers. This is the regression test for the
    // `<>...</>` fragment bug: Children.toArray sees the fragment as a single
    // child and SettingsGroup renders zero dividers regardless of row count.
    expect(countGroupDividers(container)).toBe(2);
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

    const setupFailed = screen.getByText("Setup failed");
    const settingUp = screen.getByText("Setting up");
    expect(setupFailed).toBeTruthy();
    expect(settingUp).toBeTruthy();
    // Distinguishing failure state must stay muted text, never a color chip.
    expect(isBadgeElement(setupFailed)).toBe(false);
    expect(isBadgeElement(settingUp)).toBe(false);
    fireEvent.click(screen.getByText("Add cloud environment"));
    expect(onAddCloudEnvironment).toHaveBeenCalledTimes(1);
  });

  it("renders the cloud config section without dead affordances", () => {
    const { container } = render(
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

    const statusLabel = screen.getByText("Saved");
    expect(statusLabel).toBeTruthy();
    expect(screen.getByLabelText("Cloud run command")).toBeTruthy();
    expect(screen.getByLabelText("Cloud setup script")).toBeTruthy();
    expect(screen.getByText("setup.sh")).toBeTruthy();
    expect(screen.queryByText("Disable cloud environment")).toBeNull();
    expect(screen.queryByText("Add variable")).toBeNull();
    // Status is a plain muted span, never a Badge pill.
    expect(isBadgeElement(statusLabel)).toBe(false);
    // Save/Revert footer lives below the wash card, not inside it.
    const washCard = container.querySelector(".bg-surface-elevated-secondary");
    expect(washCard).toBeTruthy();
    const saveButton = screen.getByText("Save");
    expect(washCard?.contains(saveButton)).toBe(false);
    expect(washCard?.contains(statusLabel)).toBe(false);
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
