// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CloudRepoPickerBlocker } from "#product/components/workspace/repo-setup/CloudRepoPickerBlocker";
import { buildGitHubSetupSteps } from "#product/lib/domain/workspaces/cloud/cloud-repo-picker-model";

afterEach(cleanup);

const STEPS = buildGitHubSetupSteps({
  userAuthorized: true,
  installationInstalled: false,
});

describe("CloudRepoPickerBlocker", () => {
  it("renders the checklist with one current step and one CTA", () => {
    const onAction = vi.fn();
    render(
      <CloudRepoPickerBlocker
        blocker={{
          title: "Install Proliferate GitHub App",
          description: "Install the app for your organization.",
          steps: STEPS,
          actionLabel: "Install Proliferate GitHub App",
          onAction,
        }}
      />,
    );

    const list = screen.getByRole("list", { name: "GitHub setup progress" });
    expect(list.querySelectorAll("li")).toHaveLength(3);
    expect(list.querySelectorAll("[aria-current=step]")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Install Proliferate GitHub App" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("replaces the checklist with the waiting panel once the user is on GitHub", () => {
    const onCheckAgain = vi.fn();
    const onCancel = vi.fn();
    render(
      <CloudRepoPickerBlocker
        blocker={{
          title: "Install Proliferate GitHub App",
          description: "Install the app for your organization.",
          steps: STEPS,
          actionLabel: "Install Proliferate GitHub App",
          onAction: vi.fn(),
          waiting: {
            title: "Finish installing on GitHub",
            description: "Choose which repositories Proliferate can access.",
            checkAgainLabel: "I've done this — Check again",
            onCheckAgain,
            onCancel,
          },
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Finish installing on GitHub" })).toBeTruthy();
    // The checklist and its CTA would only restate the GitHub tab.
    expect(screen.queryByRole("list", { name: "GitHub setup progress" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Install Proliferate GitHub App" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "I've done this — Check again" }));
    expect(onCheckAgain).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows the copied admin request inline on the non-admin path", () => {
    render(
      <CloudRepoPickerBlocker
        blocker={{
          title: "Ask an admin",
          description: "You cannot install the app yourself.",
          steps: STEPS,
          waiting: {
            title: "Waiting on an admin",
            description: "We copied a request to your clipboard.",
            requestText: "Please install the Proliferate GitHub App for our organization.",
            checkAgainLabel: "Check again",
            onCheckAgain: vi.fn(),
            onCancel: vi.fn(),
          },
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Waiting on an admin" })).toBeTruthy();
    expect(
      screen.getByText("Please install the Proliferate GitHub App for our organization."),
    ).toBeTruthy();
  });
});
