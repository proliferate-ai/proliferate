// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AddRepoFlow, type AddRepoFlowProps } from "../src/repos/AddRepoFlow";
import type { CloudRepoPickerProps } from "../src/repos/CloudRepoPicker";

function buildCloudPicker(
  overrides: Partial<CloudRepoPickerProps> = {},
): CloudRepoPickerProps {
  return {
    query: "",
    manualValue: "",
    repositories: [],
    onQueryChange: vi.fn(),
    onManualValueChange: vi.fn(),
    onAddRepository: vi.fn(),
    onAddManual: vi.fn(),
    onLoadMore: vi.fn(),
    ...overrides,
  };
}

function renderFlow(overrides: Partial<AddRepoFlowProps> = {}) {
  const props: AddRepoFlowProps = {
    open: true,
    step: { kind: "entry" },
    onPickOption: vi.fn(),
    onConfirmLocal: vi.fn(),
    onBack: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<AddRepoFlow {...props} />);
  return props;
}

describe("AddRepoFlow", () => {
  afterEach(cleanup);

  it("offers the three entry options and reports the cloud pick", () => {
    const { onPickOption } = renderFlow();

    expect(screen.getByText("Add a repository")).toBeTruthy();
    expect(screen.getByText("Link a local repo")).toBeTruthy();
    expect(screen.getByText("Add a local repo")).toBeTruthy();
    fireEvent.click(screen.getByText("Add a cloud repo"));

    expect(onPickOption).toHaveBeenCalledWith("cloud");
  });

  it("runs the cloud step in the same dialog with the repo picker", () => {
    const onAddRepository = vi.fn();
    renderFlow({
      step: { kind: "cloud" },
      cloudPicker: buildCloudPicker({
        repositories: [{
          id: "acme/rocket",
          fullName: "acme/rocket",
          defaultBranch: "main",
          private: true,
          fork: false,
          archived: false,
          disabled: false,
          permission: "admin",
          configured: false,
          repoConfigState: "missing",
        }],
        onAddRepository,
      }),
    });

    expect(screen.getByText("Add a cloud repo")).toBeTruthy();
    expect(screen.getByLabelText("Search GitHub repositories")).toBeTruthy();
    expect(screen.getByText("acme/rocket")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add acme/rocket" }));
    expect(onAddRepository).toHaveBeenCalledWith(
      expect.objectContaining({ id: "acme/rocket" }),
    );
  });

  it("shows the compact GitHub App blocker inside the cloud step", () => {
    const onAction = vi.fn();
    renderFlow({
      step: { kind: "cloud" },
      cloudPicker: buildCloudPicker({
        blocker: {
          title: "Install GitHub App",
          description: "Install the Proliferate GitHub App for this organization.",
          actionLabel: "Install GitHub App",
          onAction,
        },
      }),
    });

    expect(screen.getByRole("heading", { name: "Install GitHub App" })).toBeTruthy();
    expect(screen.queryByLabelText("Search GitHub repositories")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Install GitHub App" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("navigates back from the cloud step to the entry step", () => {
    const { onBack } = renderFlow({
      step: { kind: "cloud" },
      cloudPicker: buildCloudPicker(),
    });

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("submits the manual owner/repo fallback from the cloud step", () => {
    const onAddManual = vi.fn();
    renderFlow({
      step: { kind: "cloud" },
      cloudPicker: buildCloudPicker({
        manualValue: "acme/manual",
        onAddManual,
      }),
    });

    fireEvent.submit(screen.getByLabelText("GitHub repository"));

    expect(onAddManual).toHaveBeenCalledTimes(1);
  });
});
