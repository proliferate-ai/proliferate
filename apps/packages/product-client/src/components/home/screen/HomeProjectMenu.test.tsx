// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeProjectMenu } from "#product/components/home/screen/HomeProjectMenu";
import type { SettingsRepositoryEntry } from "#product/lib/domain/settings/repositories";

// The flow's wiring has its own tests; this file is about the sweep.
vi.mock("#product/components/workspace/repo-setup/AddRepositoryFlowPanel", () => ({
  AddRepositoryFlowPanel: ({ onExitEntry }: { onExitEntry?: (() => void) | null }) => (
    <button type="button" onClick={() => onExitEntry?.()}>
      back-from-flow
    </button>
  ),
}));

const REPOSITORIES = [
  { name: "rocket", sourceRoot: "/src/rocket" },
  { name: "orbit", sourceRoot: "/src/orbit" },
] as unknown as SettingsRepositoryEntry[];

function openMenu() {
  render(
    <HomeProjectMenu
      trigger={<button type="button">Project</button>}
      coworkAvailable
      destination="repository"
      repositories={REPOSITORIES}
      selectedRepository={REPOSITORIES[0]}
      onSelectRepository={vi.fn()}
      onSelectCowork={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Project" }));
}

function track(): HTMLElement {
  const viewport = document.querySelector("[data-slot=project-menu-sweep]");
  return viewport?.firstElementChild as HTMLElement;
}

/** The project list's own layout box — the thing that pins the popover height. */
function projectListPanel(): HTMLElement {
  return track().firstElementChild?.firstElementChild as HTMLElement;
}

describe("HomeProjectMenu sweep", () => {
  afterEach(cleanup);

  it("stays on the project list until New project is pressed", () => {
    openMenu();

    expect(track().className).toContain("translate-x-0");
    expect(track().className).not.toContain("-translate-x-full");
    expect(screen.queryByText("back-from-flow")).toBeNull();
  });

  it("sweeps to the add-repository flow in place, holding the row open", () => {
    openMenu();

    fireEvent.click(screen.getByRole("button", { name: /New project/ }));

    expect(track().className).toContain("-translate-x-full");
    expect(screen.getByText("back-from-flow")).toBeTruthy();
    expect(screen.getByRole("button", { name: /New project/ }).className)
      .toContain("bg-hover");
    // The project list is still mounted — this is one surface moving, not two.
    expect(screen.getByText("rocket")).toBeTruthy();
  });

  it("stays in the flow when the row is pressed again", () => {
    // The row is swept off-screen and inert while the flow is showing, so a
    // "toggle" is a promise the surface cannot keep. (jsdom honours neither
    // `inert` nor the transform, so this asserts the handler, not the paint.)
    openMenu();

    fireEvent.click(screen.getByRole("button", { name: /New project/ }));
    fireEvent.click(screen.getByRole("button", { name: /New project/ }));

    expect(track().className).toContain("-translate-x-full");
    expect(screen.getByText("back-from-flow")).toBeTruthy();
  });

  it("keeps the flow panel visible while it sweeps out, then drops it", async () => {
    openMenu();

    fireEvent.click(screen.getByRole("button", { name: /New project/ }));
    fireEvent.click(screen.getByRole("button", { name: "back-from-flow" }));

    // Travelling back: the track has turned around, and the panel the user is
    // watching leave is still on screen.
    expect(track().className).toContain("translate-x-0");
    expect(screen.getByText("back-from-flow")).toBeTruthy();

    // Settled: nothing left to show, so it unmounts.
    await waitFor(() => {
      expect(screen.queryByText("back-from-flow")).toBeNull();
    });
  });

  it("stops the project list pinning the popover's height once settled in the flow", async () => {
    openMenu();

    fireEvent.click(screen.getByRole("button", { name: /New project/ }));
    // Mid-sweep both panels are real, so the list is still laid out.
    expect(projectListPanel().className).toContain("flex");

    await waitFor(() => {
      expect(projectListPanel().className).toContain("hidden");
    });
    expect(projectListPanel().className).not.toMatch(/(^|\s)flex(\s|$)/);

    // ...and whole again the moment a reverse sweep starts.
    fireEvent.click(screen.getByRole("button", { name: "back-from-flow" }));
    expect(projectListPanel().className).toContain("flex");
  });

  it("moves focus into the flow panel, which the inert flip would otherwise drop", () => {
    openMenu();

    fireEvent.click(screen.getByRole("button", { name: /New project/ }));

    const panel = screen.getByText("back-from-flow").closest("[tabindex='-1']");
    expect(document.activeElement).toBe(panel);
  });

  it("returns focus to the New project row on the way back", async () => {
    openMenu();

    fireEvent.click(screen.getByRole("button", { name: /New project/ }));
    fireEvent.click(screen.getByRole("button", { name: "back-from-flow" }));

    await waitFor(() => {
      expect(document.activeElement)
        .toBe(screen.getByRole("button", { name: /New project/ }));
    });
  });

  it("uses the ruled panel motion, and none of it under reduced motion", () => {
    openMenu();

    expect(track().className).toContain("duration-panel");
    expect(track().className).toContain("ease-out-quint");
    expect(track().className).toContain("motion-reduce:transition-none");
  });
});
