// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Workspace } from "@anyharness/sdk";
import { ArchivedWorkspacesPane } from "#product/components/settings/panes/archived/ArchivedWorkspacesPane";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";

const mocks = vi.hoisted(() => ({
  actions: {
    isLoading: false,
    workspaces: [] as Workspace[],
    repoRoots: [],
    hasAnyArchived: false,
    hasSearchMatches: true,
    search: "",
    setSearch: vi.fn(),
    sort: "archived" as const,
    setSort: vi.fn(),
    sortOptions: [
      { id: "archived", label: "Recently archived" },
      { id: "created", label: "Recently created" },
      { id: "alpha", label: "Name" },
    ],
    exitingIds: new Set<string>(),
    requestUnarchive: vi.fn(),
    requestDelete: vi.fn(),
    requestDeleteAll: vi.fn(),
    cancelDelete: vi.fn(),
    confirmDelete: vi.fn(),
    deleteTarget: null,
    deleteTargetWorkspace: null,
    deleteAllCount: 0,
    isDeleting: false,
    scenario: null,
    dismissScenario: vi.fn(),
    onScenarioConfirm: vi.fn(),
  },
}));

vi.mock("#product/hooks/workspaces/workflows/use-archived-workspaces-page-actions", () => ({
  useArchivedWorkspacesPageActions: () => mocks.actions,
}));

function makeWorkspace(id: string, displayName: string): Workspace {
  return {
    id,
    displayName,
    repoRootId: "root-1",
    path: `/tmp/${id}`,
    archivedAt: "2026-08-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  } as unknown as Workspace;
}

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  mocks.actions.hasAnyArchived = false;
  mocks.actions.hasSearchMatches = true;
  mocks.actions.workspaces = [];
  mocks.actions.search = "";
  mocks.actions.deleteTarget = null;
  useUserPreferencesStore.setState({ deleteBranchOnArchive: false });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ArchivedWorkspacesPane", () => {
  it("hides the header and controls and renders SettingsEmptyState when there are no archived workspaces at all", () => {
    render(<ArchivedWorkspacesPane />);
    expect(screen.getByText("No archived workspaces")).not.toBeNull();
    expect(screen.queryByText("Archived workspaces")).toBeNull();
    expect(screen.queryByPlaceholderText("Search archived workspaces")).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete all" })).toBeNull();
  });

  it("renders the header, controls, and rows when workspaces exist", () => {
    mocks.actions.hasAnyArchived = true;
    mocks.actions.workspaces = [makeWorkspace("w1", "Feature A"), makeWorkspace("w2", "Feature B")];
    render(<ArchivedWorkspacesPane />);

    expect(screen.getByText("Archived workspaces")).not.toBeNull();
    expect(screen.getByPlaceholderText("Search archived workspaces")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Delete all" })).not.toBeNull();
    expect(screen.getByText("Feature A")).not.toBeNull();
    expect(screen.getByText("Feature B")).not.toBeNull();
  });

  it("renders the quieter in-card empty line for a query with no matches", () => {
    mocks.actions.hasAnyArchived = true;
    mocks.actions.hasSearchMatches = false;
    mocks.actions.search = "nonexistent";
    mocks.actions.workspaces = [];
    render(<ArchivedWorkspacesPane />);

    expect(screen.getByText('No archived workspaces match "nonexistent"')).not.toBeNull();
    // The overall empty state (icon + title) must not also render.
    expect(screen.queryByText("Workspaces you archive from the sidebar show up here.")).toBeNull();
  });

  it("calls setSearch as the search input changes", () => {
    mocks.actions.hasAnyArchived = true;
    mocks.actions.workspaces = [makeWorkspace("w1", "Feature A")];
    render(<ArchivedWorkspacesPane />);

    fireEvent.change(screen.getByPlaceholderText("Search archived workspaces"), {
      target: { value: "feat" },
    });
    expect(mocks.actions.setSearch).toHaveBeenCalledWith("feat");
  });

  it("wires per-row Unarchive to requestUnarchive", () => {
    mocks.actions.hasAnyArchived = true;
    mocks.actions.workspaces = [makeWorkspace("w1", "Feature A")];
    render(<ArchivedWorkspacesPane />);

    fireEvent.click(screen.getByRole("button", { name: "Unarchive" }));
    expect(mocks.actions.requestUnarchive).toHaveBeenCalledWith("w1");
  });

  it("wires Delete all to requestDeleteAll", () => {
    mocks.actions.hasAnyArchived = true;
    mocks.actions.workspaces = [makeWorkspace("w1", "Feature A")];
    render(<ArchivedWorkspacesPane />);

    fireEvent.click(screen.getByRole("button", { name: "Delete all" }));
    expect(mocks.actions.requestDeleteAll).toHaveBeenCalledTimes(1);
  });

  it("renders the delete-permanently dialog copy naming chat history and raw transcripts", () => {
    mocks.actions.hasAnyArchived = true;
    mocks.actions.workspaces = [makeWorkspace("w1", "Feature A")];
    mocks.actions.deleteTarget = "all" as never;
    mocks.actions.deleteAllCount = 1;
    render(<ArchivedWorkspacesPane />);

    expect(screen.getAllByText("Delete permanently?").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/permanently deletes chat history, including the raw agent transcripts/i)
        .length,
    ).toBeGreaterThan(0);
  });

  // The Archiving preference group lives on the General pane; this page lists
  // archived workspaces and holds no preferences of its own.
  it("renders no preference switches — the Archiving group moved to General", () => {
    mocks.actions.hasAnyArchived = true;
    mocks.actions.workspaces = [makeWorkspace("w1", "Feature A")];
    useUserPreferencesStore.setState({ deleteBranchOnArchive: true });
    render(<ArchivedWorkspacesPane />);

    expect(screen.queryByText("Archiving")).toBeNull();
    expect(screen.queryByText("Delete branch on archive")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });
});
