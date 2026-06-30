// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AddCloudEnvironmentDialog } from "../src/environments/AddCloudEnvironmentDialog";
import { CloudEnvironmentEditor } from "../src/environments/CloudEnvironmentEditor";
import { CloudEnvironmentList } from "../src/environments/CloudEnvironmentList";

describe("cloud environment product UI", () => {
  afterEach(cleanup);

  it("labels the add dialog as a cloud environment flow", () => {
    render(
      <AddCloudEnvironmentDialog
        open
        query=""
        manualValue=""
        repositories={[]}
        onQueryChange={vi.fn()}
        onManualValueChange={vi.fn()}
        onAddRepository={vi.fn()}
        onAddManual={vi.fn()}
        onLoadMore={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Add cloud environment")).toBeTruthy();
    expect(screen.getByText(/does not clone locally/u)).toBeTruthy();
    expect(screen.getByLabelText("GitHub repository")).toBeTruthy();
  });

  it("renders local and cloud repositories in one list", () => {
    const onSelectLocal = vi.fn();
    const onSelectCloud = vi.fn();

    render(
      <CloudEnvironmentList
        cloudEnvironments={[{
          id: "/repo",
          fullName: "acme/repo",
          description: "/repo",
          configured: true,
          locationState: "local_and_cloud",
          localSourceRoot: "/repo",
        }, {
          id: "acme/rocket",
          fullName: "acme/rocket",
          description: "Cloud-only environment",
          configured: true,
          locationState: "cloud_only",
        }]}
        onSelectLocalCheckout={onSelectLocal}
        onSelectCloudEnvironment={onSelectCloud}
      />,
    );

    expect(screen.getByText("Repositories")).toBeTruthy();
    expect(screen.getByText("acme/repo")).toBeTruthy();
    expect(screen.getByText("Local")).toBeTruthy();
    expect(screen.getAllByText("Cloud enabled").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByText("Configure")[0]!);
    expect(onSelectLocal).toHaveBeenCalledWith("/repo");
    fireEvent.click(screen.getAllByText("Configure")[1]!);
    expect(onSelectCloud).toHaveBeenCalledWith("acme/rocket");
  });

  it("hides local file sync and shows tracked files as read-only in cloud-only editor", () => {
    render(
      <CloudEnvironmentEditor
        title="acme/rocket"
        description="Cloud-only environment"
        statusLabel="Saved"
        statusTone="success"
        defaultBranch={null}
        githubDefaultBranch="main"
        branches={["main"]}
        setupScript=""
        runCommand=""
        envVarRows={[]}
        trackedFileCount={2}
        trackedFilesReadOnly
        onDefaultBranchChange={vi.fn()}
        onSetupScriptChange={vi.fn()}
        onRunCommandChange={vi.fn()}
        onAddEnvVar={vi.fn()}
        onUpdateEnvVar={vi.fn()}
        onRemoveEnvVar={vi.fn()}
        onSave={vi.fn()}
        onRevert={vi.fn()}
      />,
    );

    expect(screen.getByText("Tracked files")).toBeTruthy();
    expect(screen.getByText(/Cloud-only edits preserve them/u)).toBeTruthy();
    expect(screen.queryByText("Choose tracked files")).toBeNull();
  });

  it("emits editor save, revert, disable, and env var actions", () => {
    const onSave = vi.fn();
    const onRevert = vi.fn();
    const onDisable = vi.fn();
    const onAddEnvVar = vi.fn();

    render(
      <CloudEnvironmentEditor
        title="acme/rocket"
        description="Cloud-only environment"
        statusLabel="Unsaved changes"
        defaultBranch="main"
        githubDefaultBranch="main"
        branches={["main"]}
        setupScript=""
        runCommand=""
        envVarRows={[]}
        onDefaultBranchChange={vi.fn()}
        onSetupScriptChange={vi.fn()}
        onRunCommandChange={vi.fn()}
        onAddEnvVar={onAddEnvVar}
        onUpdateEnvVar={vi.fn()}
        onRemoveEnvVar={vi.fn()}
        onSave={onSave}
        onRevert={onRevert}
        onDisable={onDisable}
      />,
    );

    fireEvent.click(screen.getByText("Add variable"));
    fireEvent.click(screen.getByText("Revert"));
    fireEvent.click(screen.getByText("Disable cloud environment"));
    fireEvent.click(screen.getByText("Save"));

    expect(onAddEnvVar).toHaveBeenCalledTimes(1);
    expect(onRevert).toHaveBeenCalledTimes(1);
    expect(onDisable).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
