// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { AuthenticatedAppHost } from "@/pages/AuthenticatedAppHost";

vi.mock("@/hooks/organizations/lifecycle/use-organization-selection-lifecycle", () => ({
  useOrganizationSelectionLifecycle: vi.fn(),
}));

vi.mock("@/pages/WorkflowsPage", () => ({
  WorkflowsPage: () => <section data-testid="workflows" />,
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
  });

  it("keeps the workspace mounted behind Settings and restores it on return", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AuthenticatedAppHost MainComponent={TestMain} SettingsComponent={TestSettings} />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("workspace").dataset.visible).toBe("true");
    expect(mainMounts).toBe(1);

    fireEvent.click(screen.getByText("Open settings"));

    expect(screen.getByTestId("settings").dataset.returnTo).toBe("/");
    expect(screen.getByTestId("workspace").dataset.visible).toBe("false");

    fireEvent.click(screen.getByText("Back"));

    expect(screen.getByTestId("workspace").dataset.visible).toBe("true");
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
    expect(screen.getByTestId("workspace").dataset.visible).toBe("false");

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
});
