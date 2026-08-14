// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

  it("sweeps back when the row is pressed again", () => {
    openMenu();

    fireEvent.click(screen.getByRole("button", { name: /New project/ }));
    fireEvent.click(screen.getByRole("button", { name: /New project/ }));

    expect(track().className).toContain("translate-x-0");
  });

  it("sweeps back from the flow's own back control", () => {
    openMenu();

    fireEvent.click(screen.getByRole("button", { name: /New project/ }));
    fireEvent.click(screen.getByRole("button", { name: "back-from-flow" }));

    expect(track().className).toContain("translate-x-0");
    expect(screen.queryByText("back-from-flow")).toBeNull();
  });

  it("uses the ruled panel motion, and none of it under reduced motion", () => {
    openMenu();

    expect(track().className).toContain("duration-panel");
    expect(track().className).toContain("ease-out-quint");
    expect(track().className).toContain("motion-reduce:transition-none");
  });
});
