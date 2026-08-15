// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GeneralPane } from "#product/components/settings/panes/GeneralPane";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";

// The editor probe is a desktop-only host call; the pane only needs a list.
vi.mock("#product/hooks/access/tauri/shell/use-available-editors", () => ({
  useAvailableEditors: () => ({ data: [] }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("GeneralPane session policy", () => {
  it("does not present the compatibility-only subagents flag as current Workspace authority", () => {
    render(<GeneralPane />);

    expect(screen.queryByText("Allow coding agents to spin up subagents")).toBeNull();
    expect(screen.queryByText(/saved delegation policy/i)).toBeNull();
    expect(screen.getByText("Allow cowork agents to create coding workspaces")).not.toBeNull();
  });
});

/**
 * The archive knobs are standing preferences, so they live where preferences
 * live. "Delete branch on archive" used to render on the Archived workspaces
 * page — a list of what was already archived is the one place a setting that
 * governs future archives is unfindable.
 */
describe("GeneralPane archiving preferences", () => {
  it("renders the Archiving group with the Delete branch on archive switch", () => {
    useUserPreferencesStore.setState({ deleteBranchOnArchive: true });

    render(<GeneralPane />);

    expect(screen.getByText("Archiving")).not.toBeNull();
    // Scoped to the Archiving section: the pane has other switches, and a
    // match on any of them would let this pass with the group deleted.
    const section = screen.getByText("Delete branch on archive").closest("section");
    expect(section).not.toBeNull();
    expect(section!.textContent).toContain("Archiving");
    expect(section!.querySelector("[role='switch']")?.getAttribute("aria-checked"))
      .toBe("true");
  });

  it("writes the preference through on toggle", () => {
    useUserPreferencesStore.setState({ deleteBranchOnArchive: false });

    render(<GeneralPane />);
    const label = screen.getByText("Delete branch on archive");
    const section = label.closest("section");
    expect(section).not.toBeNull();
    const toggle = section!.querySelector("[role='switch']");
    expect(toggle).not.toBeNull();

    fireEvent.click(toggle!);

    expect(useUserPreferencesStore.getState().deleteBranchOnArchive).toBe(true);
  });
});
