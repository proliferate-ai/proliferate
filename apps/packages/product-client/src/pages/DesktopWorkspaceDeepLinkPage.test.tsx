// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { DesktopWorkspaceDeepLinkPage } from "#product/pages/DesktopWorkspaceDeepLinkPage";

afterEach(() => {
  cleanup();
});

/**
 * Cloud culling (PRO-10, Rung 1) FM4: a `proliferate://` deep link carrying a
 * cloud workspace id must resolve to a neutral not-found terminal state, never
 * a crash and never a rendered cloud pane.
 */
describe("DesktopWorkspaceDeepLinkPage", () => {
  it("resolves a cloud workspace deep link to a neutral not-found state", () => {
    render(
      <MemoryRouter initialEntries={["/workspaces/cloud-ws-42"]}>
        <Routes>
          <Route
            path="/workspaces/:workspaceId"
            element={<DesktopWorkspaceDeepLinkPage />}
          />
          <Route path="/" element={<p>Home</p>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Workspace not found")).toBeTruthy();
    expect(screen.getByText("This workspace is no longer available.")).toBeTruthy();
    // No cloud copy leaks into the terminal state.
    expect(screen.queryByText(/cloud/i)).toBeNull();
  });

  it("returns home from the not-found state", () => {
    render(
      <MemoryRouter initialEntries={["/workspaces/cloud-ws-42"]}>
        <Routes>
          <Route
            path="/workspaces/:workspaceId"
            element={<DesktopWorkspaceDeepLinkPage />}
          />
          <Route path="/" element={<p>Home destination</p>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText("Go home"));
    expect(screen.getByText("Home destination")).toBeTruthy();
  });
});
