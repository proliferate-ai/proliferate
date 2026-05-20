// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { BootstrappedRoute } from "@/components/auth/AuthGate";
import { SessionCheckScreen } from "@/components/auth/SessionCheckScreen";
import { useAuthStore } from "@/stores/auth/auth-store";

describe("SessionCheckScreen", () => {
  it("uses the auth-style checking copy and branded mark surface", () => {
    const html = renderToStaticMarkup(<SessionCheckScreen />);

    expect(html).toContain("data-auth-session-check");
    expect(html).toContain("Checking your session");
    expect(html).toContain("Proliferate is restoring your account");
    expect(html).not.toContain("data-jank-canary=\"braille\"");
  });
});

describe("BootstrappedRoute", () => {
  beforeEach(() => {
    useAuthStore.setState({ status: "bootstrapping", session: null, user: null, error: null });
  });

  afterEach(() => {
    cleanup();
    useAuthStore.setState({ status: "bootstrapping", session: null, user: null, error: null });
  });

  it("mounts the destination behind the session check overlay before fading it away", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<BootstrappedRoute />}>
            <Route path="/" element={<main data-testid="workspace">Workspace</main>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Checking your session")).toBeTruthy();
    expect(screen.queryByTestId("workspace")).toBeNull();

    act(() => {
      useAuthStore.setState({ status: "authenticated" });
    });

    expect(screen.getByTestId("workspace")).toBeTruthy();
    expect(screen.getByText("Checking your session")).toBeTruthy();
  });
});
