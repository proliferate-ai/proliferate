// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceFileSearchModal } from "./WorkspaceFileSearchModal";

const useWorkspaceFileSearchMock = vi.fn();

vi.mock("@/hooks/workspaces/files/ui/use-workspace-file-search", () => ({
  useWorkspaceFileSearch: (options: unknown) => useWorkspaceFileSearchMock(options),
}));

describe("WorkspaceFileSearchModal", () => {
  beforeEach(() => {
    class TestResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    useWorkspaceFileSearchMock.mockReset();
    useWorkspaceFileSearchMock.mockReturnValue({
      query: "",
      debouncedQuery: "",
      searchEnabled: false,
      isLoading: false,
      isError: false,
      results: [],
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows unavailable state when no workspace is selected", () => {
    render(
      <WorkspaceFileSearchModal
        open
        workspaceId={null}
        runtimeBlockedReason={null}
        onClose={vi.fn()}
        onOpenFile={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Search workspace files" })).toBeTruthy();
    expect(screen.getByText("Workspace is still opening.")).toBeTruthy();
  });

  it("opens selected search results and closes without restoring focus", () => {
    const onClose = vi.fn();
    const onOpenFile = vi.fn();
    useWorkspaceFileSearchMock.mockReturnValue({
      query: "app",
      debouncedQuery: "app",
      searchEnabled: true,
      isLoading: false,
      isError: false,
      results: [
        { name: "App.tsx", path: "src/App.tsx" },
      ],
    });

    render(
      <WorkspaceFileSearchModal
        open
        workspaceId="workspace-1"
        runtimeBlockedReason={null}
        onClose={onClose}
        onOpenFile={onOpenFile}
      />,
    );

    fireEvent.click(screen.getByText("App.tsx"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpenFile).toHaveBeenCalledWith("src/App.tsx");
  });

  it("shows search error state", () => {
    useWorkspaceFileSearchMock.mockReturnValue({
      query: "app",
      debouncedQuery: "app",
      searchEnabled: true,
      isLoading: false,
      isError: true,
      results: [],
    });

    render(
      <WorkspaceFileSearchModal
        open
        workspaceId="workspace-1"
        runtimeBlockedReason={null}
        onClose={vi.fn()}
        onOpenFile={vi.fn()}
      />,
    );

    expect(screen.queryByText("No files found")).toBeNull();
    expect(screen.getByText("Failed to search files.")).toBeTruthy();
  });
});
