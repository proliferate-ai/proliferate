// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { AuthenticatedAppHost } from "#product/pages/AuthenticatedAppHost";

vi.mock("#product/hooks/organizations/lifecycle/use-organization-selection-lifecycle", () => ({
  useOrganizationSelectionLifecycle: vi.fn(),
}));

const focusChatInputOnActivation = vi.hoisted(() => vi.fn(() => true));

vi.mock("#product/lib/domain/focus-zone", () => ({
  focusChatInputOnActivation,
}));

vi.mock("#product/pages/WorkflowsPage", () => ({
  WorkflowsPage: () => <section data-testid="workflows" />,
}));

vi.mock("#product/pages/DesktopWorkspaceDeepLinkPage", () => ({
  DesktopWorkspaceDeepLinkPage: () => <section data-testid="workspace-deep-link" />,
}));

vi.mock("#product/pages/MainPage", () => ({
  MainPage: () => null,
}));

vi.mock("#product/pages/SettingsPage", () => ({
  SettingsPage: () => null,
}));

vi.mock("#product/pages/WorkspacesPage", () => ({
  WorkspacesPage: () => <section data-testid="workspaces" />,
}));

let mainMounts = 0;

function TestMain({ workspaceVisible = true }: { workspaceVisible?: boolean }) {
  const navigate = useNavigate();

  useEffect(() => {
    mainMounts += 1;
  }, []);

  return (
    <main data-testid="workspace" data-visible={workspaceVisible ? "true" : "false"}>
      <button type="button" onClick={() => navigate("/settings?section=general")}>
        Open settings
      </button>
      <button type="button" onClick={() => navigate("/workflows")}>
        Open workflows
      </button>
      <button type="button" onClick={() => navigate("/")}>
        Go home
      </button>
    </main>
  );
}

function TestSettings({ returnTo = "/" }: { returnTo?: string }) {
  const navigate = useNavigate();

  return (
    <section data-testid="settings" data-return-to={returnTo}>
      <button type="button" onClick={() => navigate(returnTo)}>
        Back
      </button>
    </section>
  );
}

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {`${location.pathname}${location.search}${location.hash}`}
    </output>
  );
}

describe("AuthenticatedAppHost", () => {
  afterEach(() => {
    cleanup();
    mainMounts = 0;
    vi.clearAllMocks();
  });

  it("keeps the workspace mounted but inert behind Settings and restores focus on return", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AuthenticatedAppHost MainComponent={TestMain} SettingsComponent={TestSettings} />
      </MemoryRouter>,
    );

    const workspace = screen.getByTestId("workspace");
    const workspaceHost = workspace.parentElement!;
    expect(workspace.dataset.visible).toBe("true");
    expect(workspaceHost.hasAttribute("inert")).toBe(false);
    expect(mainMounts).toBe(1);
    expect(focusChatInputOnActivation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Open settings"));

    expect(screen.getByTestId("settings").dataset.returnTo).toBe("/");
    expect(workspace.dataset.visible).toBe("false");
    expect(workspaceHost.getAttribute("aria-hidden")).toBe("true");
    expect(workspaceHost.hasAttribute("inert")).toBe(true);
    expect(focusChatInputOnActivation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Back"));

    expect(workspace.dataset.visible).toBe("true");
    expect(workspaceHost.hasAttribute("aria-hidden")).toBe(false);
    expect(workspaceHost.hasAttribute("inert")).toBe(false);
    await waitFor(() => expect(focusChatInputOnActivation).toHaveBeenCalledOnce());
  });

  it("keeps the workspace mounted while on Workflows and restores it without remounting", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AuthenticatedAppHost MainComponent={TestMain} SettingsComponent={TestSettings} />
      </MemoryRouter>,
    );

    expect(mainMounts).toBe(1);

    fireEvent.click(screen.getByText("Open workflows"));

    expect(screen.getByTestId("workflows")).toBeTruthy();
    const workspace = screen.getByTestId("workspace");
    expect(workspace.dataset.visible).toBe("false");
    expect(workspace.parentElement?.hasAttribute("inert")).toBe(true);

    fireEvent.click(screen.getByText("Go home"));

    expect(screen.getByTestId("workspace").dataset.visible).toBe("true");
    expect(mainMounts).toBe(1);
  });

  it("preserves the workflow ID, query, and hash in a legacy automation deep link", async () => {
    render(
      <MemoryRouter initialEntries={["/automations/workflow-1?source=legacy#details"]}>
        <AuthenticatedAppHost MainComponent={TestMain} SettingsComponent={TestSettings} />
        <LocationProbe />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("location").textContent)
        .toBe("/workflows/workflow-1?source=legacy#details");
    });
    expect(screen.getByTestId("workflows")).toBeTruthy();
  });

  it("keeps a managed Workflow run deep link on the Workflow route", () => {
    render(
      <MemoryRouter initialEntries={["/workflows/workflow-1/runs/run-1"]}>
        <AuthenticatedAppHost MainComponent={TestMain} SettingsComponent={TestSettings} />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("workflows")).toBeTruthy();
    expect(screen.getByTestId("workspace").dataset.visible).toBe("false");
  });
});
