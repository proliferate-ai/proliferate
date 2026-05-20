// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { AuthenticatedAppHost } from "@/pages/AuthenticatedAppHost";

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
});
