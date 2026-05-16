// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceFileSearch } from "./use-workspace-file-search";

const searchWorkspaceFilesQuery = vi.fn();

vi.mock("@anyharness/sdk-react", () => ({
  useSearchWorkspaceFilesQuery: (options: unknown) => searchWorkspaceFilesQuery(options),
}));

describe("useWorkspaceFileSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    searchWorkspaceFilesQuery.mockReset();
    searchWorkspaceFilesQuery.mockReturnValue({
      data: {
        results: [
          { name: "README.md", path: "README.md" },
        ],
      },
      isLoading: false,
      isError: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("debounces search and gates on runtime readiness", () => {
    const rendered = renderHook(
      ({ runtimeReady }) => useWorkspaceFileSearch({
        open: true,
        workspaceId: "workspace-1",
        runtimeReady,
        query: "readme",
      }),
      { initialProps: { runtimeReady: false } },
    );

    expect(rendered.result.current.searchEnabled).toBe(false);
    expect(searchWorkspaceFilesQuery).toHaveBeenLastCalledWith({
      workspaceId: "workspace-1",
      query: "",
      limit: 50,
      enabled: false,
    });

    rendered.rerender({ runtimeReady: true });
    expect(rendered.result.current.searchEnabled).toBe(false);

    act(() => {
      vi.advanceTimersByTime(120);
    });

    expect(rendered.result.current.searchEnabled).toBe(true);
    expect(rendered.result.current.results).toEqual([
      { name: "README.md", path: "README.md" },
    ]);
    expect(searchWorkspaceFilesQuery).toHaveBeenLastCalledWith({
      workspaceId: "workspace-1",
      query: "readme",
      limit: 50,
      enabled: true,
    });
  });

  it("does not enable search without a workspace", () => {
    const rendered = renderHook(() => useWorkspaceFileSearch({
      open: true,
      workspaceId: null,
      runtimeReady: true,
      query: "readme",
    }));

    act(() => {
      vi.advanceTimersByTime(120);
    });

    expect(rendered.result.current.searchEnabled).toBe(false);
    expect(rendered.result.current.results).toEqual([]);
    expect(searchWorkspaceFilesQuery).toHaveBeenLastCalledWith({
      workspaceId: null,
      query: "readme",
      limit: 50,
      enabled: false,
    });
  });
});
