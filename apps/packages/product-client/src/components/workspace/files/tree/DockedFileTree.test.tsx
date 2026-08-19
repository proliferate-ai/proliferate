// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useCallback, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceFileEntry } from "@anyharness/sdk";
import { DockedFileTree } from "#product/components/workspace/files/tree/DockedFileTree";

/**
 * Focused proof for the docked tree itself (spec "02A - Docked File Tree",
 * "Tests and qualification" items 5-8). The safe symlink-stat assertions here
 * are the corrected ones migrated out of the deleted `FileTreeOverlay.test.tsx`
 * before that file was removed (`02A-PF-B02`).
 */

const queryMocks = vi.hoisted(() => ({
  root: {
    data: undefined as { entries: WorkspaceFileEntry[] } | undefined,
    isLoading: false,
    isFetching: false,
    error: null as unknown,
    refetch: vi.fn(async () => ({ data: undefined as unknown })),
  },
  nested: new Map<string, {
    data?: { entries: WorkspaceFileEntry[] };
    isLoading: boolean;
    isFetching: boolean;
    error: unknown;
    refetch: ReturnType<typeof vi.fn>;
  }>(),
  stat: new Map<string, {
    data?: { kind: "file" | "directory" | "symlink"; sizeBytes?: number };
    isFetching: boolean;
    error?: unknown;
    refetch: ReturnType<typeof vi.fn>;
  }>(),
  search: {
    data: undefined as { results: Array<{ name: string; path: string }> } | undefined,
    isLoading: false,
    isFetching: false,
    error: null as unknown,
    refetch: vi.fn(async () => ({ data: undefined as unknown })),
  },
  searchOptions: [] as Array<Record<string, unknown>>,
}));

vi.mock("@anyharness/sdk-react", () => ({
  useWorkspaceFilesQuery: ({ path }: { path: string }) =>
    path === "" ? queryMocks.root : queryMocks.nested.get(path) ?? {
      data: { entries: [] },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(async () => ({ data: { entries: [] } })),
    },
  useStatWorkspaceFileQuery: ({ path }: { path: string }) =>
    queryMocks.stat.get(path) ?? {
      data: undefined,
      isFetching: false,
      error: null,
      refetch: vi.fn(async () => ({ data: undefined })),
    },
  useSearchWorkspaceFilesQuery: (options: Record<string, unknown>) => {
    queryMocks.searchOptions.push(options);
    return queryMocks.search;
  },
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 28,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({
      index,
      key: index,
      start: index * 28,
    })),
    measureElement: vi.fn(),
    scrollToIndex: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
  queryMocks.root.data = undefined;
  queryMocks.root.isLoading = false;
  queryMocks.root.isFetching = false;
  queryMocks.root.error = null;
  queryMocks.root.refetch = vi.fn(async () => ({ data: undefined }));
  queryMocks.nested.clear();
  queryMocks.stat.clear();
  queryMocks.search.data = undefined;
  queryMocks.search.isLoading = false;
  queryMocks.search.isFetching = false;
  queryMocks.search.error = null;
  queryMocks.searchOptions.length = 0;
  vi.clearAllMocks();
});

interface HarnessOverrides {
  selectedPath?: string;
  bodyWidth?: number;
  width?: number;
  changedPaths?: Set<string>;
  onOpenFile?: (path: string) => void;
  onRequestClose?: () => void;
  onDesiredWidthChange?: (width: number) => void;
  initialFilter?: string;
  initialExpanded?: string[];
  pendingFilterFocus?: boolean;
  revealRequest?: { path: string; token: number } | null;
}

function DockHarness(overrides: HarnessOverrides) {
  const [filter, setFilter] = useState(overrides.initialFilter ?? "");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    new Set(overrides.initialExpanded ?? []),
  );

  // Mirrors the store's no-op-on-unchanged semantics so a selection-follow
  // effect cannot loop.
  const write = useCallback((path: string, next: boolean) => {
    setExpanded((current) => {
      if (current.has(path) === next) {
        return current;
      }
      const updated = new Set(current);
      if (next) {
        updated.add(path);
      } else {
        updated.delete(path);
      }
      return updated;
    });
  }, []);
  const toggle = useCallback(
    (path: string) => setExpanded((current) => {
      const updated = new Set(current);
      if (updated.has(path)) {
        updated.delete(path);
      } else {
        updated.add(path);
      }
      return updated;
    }),
    [],
  );

  return (
    <DockedFileTree
      workspaceId="workspace-1"
      selectedPath={overrides.selectedPath ?? "README.md"}
      changedPaths={overrides.changedPaths}
      expandedPaths={expanded}
      setExpanded={write}
      toggleExpanded={toggle}
      onOpenFile={overrides.onOpenFile ?? vi.fn()}
      width={overrides.width ?? 400}
      bodyWidth={overrides.bodyWidth ?? 800}
      onDesiredWidthChange={overrides.onDesiredWidthChange ?? vi.fn()}
      filter={filter}
      onFilterChange={setFilter}
      onRequestClose={overrides.onRequestClose ?? vi.fn()}
      captureRequest={() => 1}
      isCurrent={() => true}
      pendingFilterFocus={overrides.pendingFilterFocus ?? false}
      revealRequest={overrides.revealRequest ?? null}
      onPendingFocusHandled={vi.fn()}
    />
  );
}

function renderDock(overrides: HarnessOverrides = {}) {
  return render(<DockHarness {...overrides} />);
}

function tree(): HTMLElement {
  return screen.getByRole("tree");
}

function rows(): HTMLElement[] {
  return Array.from(tree().querySelectorAll<HTMLElement>('[role="treeitem"]'));
}

const ROOT_ENTRIES: WorkspaceFileEntry[] = [
  { name: "alpha", path: "alpha", kind: "directory" },
  { name: "beta.ts", path: "beta.ts", kind: "file" },
  { name: "README.md", path: "README.md", kind: "file" },
];

describe("DockedFileTree", () => {
  it("is non-modal: no dialog role, scrim, click-catcher, or global Escape listener", () => {
    queryMocks.root.data = { entries: ROOT_ENTRIES };
    const onRequestClose = vi.fn();
    const { container } = renderDock({ onRequestClose });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(container.querySelector("[aria-modal]")).toBeNull();
    expect(container.querySelector("[data-docked-file-tree]")).toBeTruthy();
    // Escape outside the dock does nothing to it.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onRequestClose).not.toHaveBeenCalled();
  });

  it("clears a non-empty filter on the first Escape and closes on the second", async () => {
    queryMocks.root.data = { entries: ROOT_ENTRIES };
    queryMocks.search.data = { results: [{ name: "beta.ts", path: "beta.ts" }] };
    const onRequestClose = vi.fn();
    const { container } = renderDock({ onRequestClose });

    const input = screen.getByPlaceholderText("Filter files…");
    fireEvent.change(input, { target: { value: "beta" } });
    const dock = container.querySelector("[data-docked-file-tree]")!;

    fireEvent.keyDown(dock, { key: "Escape" });
    await waitFor(() =>
      expect((screen.getByPlaceholderText("Filter files…") as HTMLInputElement).value).toBe(""));
    expect(onRequestClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByPlaceholderText("Filter files…"));

    fireEvent.keyDown(dock, { key: "Escape" });
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it("publishes the tree ARIA model and one roving tab stop on the selected row", async () => {
    queryMocks.root.data = { entries: ROOT_ENTRIES };
    renderDock({ selectedPath: "README.md" });

    await waitFor(() => {
      expect(screen.getByRole("treeitem", { name: /README\.md/ }).tabIndex).toBe(0);
    });
    const visible = rows();
    expect(visible.map((row) => row.tabIndex)).toEqual([-1, -1, 0]);
    expect(visible.map((row) => row.getAttribute("aria-posinset"))).toEqual(["1", "2", "3"]);
    expect(visible.map((row) => row.getAttribute("aria-setsize"))).toEqual(["3", "3", "3"]);
    expect(visible[0]!.getAttribute("aria-level")).toBe("1");
    expect(visible[0]!.getAttribute("aria-expanded")).toBe("false");
    // aria-expanded is directories only.
    expect(visible[1]!.getAttribute("aria-expanded")).toBeNull();
    expect(visible[2]!.getAttribute("aria-selected")).toBe("true");
  });

  it("moves roving focus with arrows, Home/End, and directory expansion keys", async () => {
    queryMocks.root.data = { entries: ROOT_ENTRIES };
    queryMocks.nested.set("alpha", {
      data: { entries: [{ name: "child.ts", path: "alpha/child.ts", kind: "file" }] },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderDock({ selectedPath: "README.md" });
    await waitFor(() => expect(rows()).toHaveLength(3));

    fireEvent.keyDown(tree(), { key: "Home" });
    await waitFor(() => expect(document.activeElement).toBe(rows()[0]));
    fireEvent.keyDown(tree(), { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows()[1]);
    fireEvent.keyDown(tree(), { key: "ArrowUp" });
    expect(document.activeElement).toBe(rows()[0]);
    // ArrowUp at the first row does not wrap.
    fireEvent.keyDown(tree(), { key: "ArrowUp" });
    expect(document.activeElement).toBe(rows()[0]);

    fireEvent.keyDown(tree(), { key: "ArrowRight" });
    await waitFor(() =>
      expect(screen.getByRole("treeitem", { name: /child\.ts/ })).toBeTruthy());
    fireEvent.keyDown(tree(), { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("treeitem", { name: /child\.ts/ }));
    // ArrowLeft on a child moves to the visible parent.
    fireEvent.keyDown(tree(), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(screen.getByRole("treeitem", { name: /alpha/ }));
    // ArrowLeft on an open directory collapses it and keeps roving there.
    fireEvent.keyDown(tree(), { key: "ArrowLeft" });
    await waitFor(() =>
      expect(screen.queryByRole("treeitem", { name: /child\.ts/ })).toBeNull());

    fireEvent.keyDown(tree(), { key: "End" });
    await waitFor(() => expect(document.activeElement).toBe(rows()[rows().length - 1]));
  });

  it("activates the roving row exactly once on Enter and Space", async () => {
    queryMocks.root.data = { entries: ROOT_ENTRIES };
    const onOpenFile = vi.fn();
    renderDock({ selectedPath: "README.md", onOpenFile });
    await waitFor(() => expect(rows()).toHaveLength(3));

    fireEvent.keyDown(tree(), { key: "Enter" });
    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onOpenFile).toHaveBeenCalledWith("README.md");

    fireEvent.keyDown(tree(), { key: " " });
    expect(onOpenFile).toHaveBeenCalledTimes(2);
  });

  it("moves roving focus by printable typeahead within the 700ms window", async () => {
    queryMocks.root.data = { entries: ROOT_ENTRIES };
    renderDock({ selectedPath: "alpha" });
    await waitFor(() => expect(rows()).toHaveLength(3));

    fireEvent.keyDown(tree(), { key: "Home" });
    await waitFor(() => expect(document.activeElement).toBe(rows()[0]));
    fireEvent.keyDown(tree(), { key: "b" });
    expect(document.activeElement).toBe(screen.getByRole("treeitem", { name: /beta\.ts/ }));

    // A second key inside the window extends the prefix rather than restarting.
    fireEvent.keyDown(tree(), { key: "e" });
    expect(document.activeElement).toBe(screen.getByRole("treeitem", { name: /beta\.ts/ }));
  });

  it("renders exactly one root retry treeitem for a retryable failure and refetches", async () => {
    const refetch = vi.fn(async () => ({ data: { entries: ROOT_ENTRIES } }));
    queryMocks.root.error = { status: 503 };
    queryMocks.root.refetch = refetch;
    renderDock();

    const retry = screen.getByRole("treeitem", { name: "Retry loading files" });
    // The retry control is itself the sole roving treeitem: no nested button.
    expect(retry.querySelector("button")).toBeNull();
    expect(rows()).toHaveLength(1);

    queryMocks.root.isFetching = true;
    fireEvent.click(retry);
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
  });

  it("renders one nested retry treeitem and no retry for a terminal nested failure", async () => {
    queryMocks.root.data = { entries: ROOT_ENTRIES };
    queryMocks.nested.set("alpha", {
      data: undefined,
      isLoading: false,
      isFetching: false,
      error: { status: 500 },
      refetch: vi.fn(async () => ({ data: { entries: [] } })),
    });
    const { rerender } = renderDock({ initialExpanded: ["alpha"] });

    expect(screen.getByRole("treeitem", { name: "Retry folder" })).toBeTruthy();
    expect(screen.queryByRole("treeitem", { name: "Retry loading files" })).toBeNull();

    queryMocks.nested.set("alpha", {
      data: undefined,
      isLoading: false,
      isFetching: false,
      error: { status: 403, code: "FILE_PERMISSION_DENIED" },
      refetch: vi.fn(),
    });
    rerender(<DockHarness initialExpanded={["alpha"]} />);
    await waitFor(() => {
      expect(screen.queryByRole("treeitem", { name: "Retry folder" })).toBeNull();
    });
    expect(screen.getByText("Folder unavailable")).toBeTruthy();
  });

  it.each([
    ["transport failure with no status", new Error("network down"), true],
    ["HTTP 500", { status: 500 }, true],
    ["HTTP 404", { status: 404 }, false],
    ["typed refusal", { status: 403, code: "FILE_PERMISSION_DENIED" }, false],
    ["typed path failure", { status: 400, code: "PATH_OUTSIDE_WORKSPACE" }, false],
  ])("classifies a %s root failure", (_label, error, retryable) => {
    queryMocks.root.error = error;
    renderDock();

    const retry = screen.queryByRole("treeitem", { name: "Retry loading files" });
    expect(retry !== null).toBe(retryable);
    if (!retryable) {
      expect(screen.getByRole("status").textContent).toBe("Files could not be loaded.");
    }
  });

  it("stats symlinks before expanding directory targets or opening file targets", async () => {
    // Migrated verbatim in behaviour from the deleted FileTreeOverlay test.
    queryMocks.root.data = {
      entries: [
        { name: "folder-link", path: "folder-link", kind: "symlink" },
        { name: "file-link.ts", path: "file-link.ts", kind: "symlink" },
      ],
    };
    queryMocks.nested.set("folder-link", {
      data: { entries: [{ name: "child.ts", path: "folder-link/child.ts", kind: "file" }] },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    queryMocks.stat.set("folder-link", {
      data: undefined,
      isFetching: false,
      refetch: vi.fn(async () => ({ data: { kind: "directory" } })),
    });
    queryMocks.stat.set("file-link.ts", {
      data: undefined,
      isFetching: false,
      refetch: vi.fn(async () => ({ data: { kind: "file", sizeBytes: 0 } })),
    });
    const onOpenFile = vi.fn();
    renderDock({ selectedPath: "", onOpenFile });

    fireEvent.click(screen.getByRole("treeitem", { name: /folder-link/ }));
    await waitFor(() => {
      expect(screen.getByRole("treeitem", { name: /folder-link/ }).getAttribute("aria-expanded"))
        .toBe("true");
    });
    expect(await screen.findByRole("treeitem", { name: /child\.ts/ })).not.toBeNull();
    expect(onOpenFile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("treeitem", { name: /file-link\.ts/ }));
    await waitFor(() => expect(onOpenFile).toHaveBeenCalledWith("file-link.ts"));
  });

  it("fails closed on an unexpected symlink stat kind and never infers from size", async () => {
    queryMocks.root.data = {
      entries: [{ name: "broken-link", path: "broken-link", kind: "symlink" }],
    };
    queryMocks.stat.set("broken-link", {
      // A resolved target must be file or directory; `symlink` plus a size is
      // still unavailable.
      data: { kind: "symlink", sizeBytes: 12 },
      isFetching: false,
      refetch: vi.fn(async () => ({ data: { kind: "symlink", sizeBytes: 12 } })),
    });
    const onOpenFile = vi.fn();
    renderDock({ selectedPath: "broken-link/inner.ts", onOpenFile });

    const row = screen.getByRole("treeitem", { name: /broken-link/ });
    expect(row.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(row);
    await waitFor(() => expect(onOpenFile).not.toHaveBeenCalled());
    expect(row.getAttribute("aria-expanded")).toBeNull();
  });

  it("owns the direct 60-result search query and its bounded empty state", async () => {
    queryMocks.root.data = { entries: ROOT_ENTRIES };
    renderDock();

    fireEvent.change(screen.getByPlaceholderText("Filter files…"), {
      target: { value: "beta" },
    });

    await waitFor(() => {
      expect(queryMocks.searchOptions.some((options) =>
        options.limit === 60 && options.query === "beta" && options.enabled === true)).toBe(true);
    });
    expect(screen.getByRole("status").textContent).toBe("No matching files");
    expect((screen.getByRole("status") as HTMLElement).tabIndex).toBe(0);
  });

  it("renders filtered results as a tree and re-picks the roving row", async () => {
    queryMocks.root.data = { entries: ROOT_ENTRIES };
    queryMocks.search.data = {
      results: [
        { name: "Button.tsx", path: "src/components/Button.tsx" },
        { name: "button.css", path: "src/styles/button.css" },
      ],
    };
    renderDock();
    await waitFor(() => expect(rows()).toHaveLength(3));

    fireEvent.change(screen.getByPlaceholderText("Filter files…"), {
      target: { value: "b" },
    });

    const group = await screen.findByRole("treeitem", { name: /src\/components/ });
    expect(group.getAttribute("aria-expanded")).toBe("true");
    // The removed roving row is replaced by the first visible result.
    await waitFor(() => expect(rows()[0]!.tabIndex).toBe(0));
    fireEvent.click(group);
    await waitFor(() => expect(screen.queryByText("Button.tsx")).toBeNull());
    expect(screen.getByText("button.css")).toBeTruthy();
  });

  it("marks changed files", async () => {
    queryMocks.root.data = { entries: ROOT_ENTRIES };
    renderDock({ changedPaths: new Set(["beta.ts"]) });
    await waitFor(() => expect(screen.getByLabelText("Modified").textContent).toBe("M"));
  });

  it("exposes separator ARIA values and every keyboard increment", () => {
    queryMocks.root.data = { entries: ROOT_ENTRIES };
    const onDesiredWidthChange = vi.fn();
    renderDock({ bodyWidth: 800, width: 400, onDesiredWidthChange });

    const separator = screen.getByRole("separator", { name: "Resize file tree" });
    expect(separator.getAttribute("aria-orientation")).toBe("vertical");
    expect(separator.getAttribute("aria-valuemin")).toBe("280");
    expect(separator.getAttribute("aria-valuemax")).toBe("420");
    expect(separator.getAttribute("aria-valuenow")).toBe("400");

    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(onDesiredWidthChange).toHaveBeenLastCalledWith(416);
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(onDesiredWidthChange).toHaveBeenLastCalledWith(384);
    fireEvent.keyDown(separator, { key: "ArrowRight", shiftKey: true });
    expect(onDesiredWidthChange).toHaveBeenLastCalledWith(420);
    fireEvent.keyDown(separator, { key: "ArrowLeft", shiftKey: true });
    expect(onDesiredWidthChange).toHaveBeenLastCalledWith(352);
    fireEvent.keyDown(separator, { key: "Home" });
    expect(onDesiredWidthChange).toHaveBeenLastCalledWith(280);
    fireEvent.keyDown(separator, { key: "End" });
    expect(onDesiredWidthChange).toHaveBeenLastCalledWith(420);
  });

  it("grows the tree when the separator is dragged toward the content", () => {
    queryMocks.root.data = { entries: ROOT_ENTRIES };
    const onDesiredWidthChange = vi.fn();
    renderDock({ bodyWidth: 900, width: 400, onDesiredWidthChange });

    const separator = screen.getByRole("separator", { name: "Resize file tree" });
    fireEvent.pointerDown(separator, { clientX: 500 });
    fireEvent(window, new MouseEvent("pointermove", { clientX: 560 }) as PointerEvent);
    expect(onDesiredWidthChange).toHaveBeenLastCalledWith(460);
    fireEvent(window, new MouseEvent("pointermove", { clientX: 420 }) as PointerEvent);
    expect(onDesiredWidthChange).toHaveBeenLastCalledWith(320);
    fireEvent(window, new MouseEvent("pointerup", {}) as PointerEvent);
  });

  it("focuses the filter field for a toolbar-origin open", async () => {
    queryMocks.root.data = { entries: ROOT_ENTRIES };
    renderDock({ pendingFilterFocus: true });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByPlaceholderText("Filter files…")));
  });

  it("clears the filter and focuses the revealed directory row for a breadcrumb origin", async () => {
    queryMocks.root.data = { entries: ROOT_ENTRIES };
    queryMocks.nested.set("alpha", {
      data: { entries: [{ name: "child.ts", path: "alpha/child.ts", kind: "file" }] },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    renderDock({
      initialFilter: "beta",
      revealRequest: { path: "alpha", token: 1 },
    });

    await waitFor(() =>
      expect((screen.getByPlaceholderText("Filter files…") as HTMLInputElement).value).toBe(""));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("treeitem", { name: /alpha/ })));
    expect(screen.getByRole("treeitem", { name: /alpha/ }).getAttribute("aria-expanded"))
      .toBe("true");
  });

  it("focuses the first root row for the leading Files crumb", async () => {
    queryMocks.root.data = { entries: ROOT_ENTRIES };
    renderDock({ revealRequest: { path: "", token: 1 } });

    await waitFor(() => expect(document.activeElement).toBe(rows()[0]));
  });

  it("ignores an async completion whose controller request was invalidated", async () => {
    queryMocks.root.data = {
      entries: [{ name: "folder-link", path: "folder-link", kind: "symlink" }],
    };
    queryMocks.stat.set("folder-link", {
      data: undefined,
      isFetching: false,
      refetch: vi.fn(async () => ({ data: { kind: "directory" } })),
    });
    const onOpenFile = vi.fn();
    render(
      <DockedFileTree
        workspaceId="workspace-1"
        selectedPath=""
        expandedPaths={new Set()}
        setExpanded={vi.fn()}
        toggleExpanded={vi.fn()}
        onOpenFile={onOpenFile}
        width={400}
        bodyWidth={800}
        onDesiredWidthChange={vi.fn()}
        filter=""
        onFilterChange={vi.fn()}
        onRequestClose={vi.fn()}
        captureRequest={() => 1}
        // The controller revision moved on before the stat resolved.
        isCurrent={() => false}
        pendingFilterFocus={false}
        revealRequest={null}
        onPendingFocusHandled={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("treeitem", { name: /folder-link/ }));
    await waitFor(() => expect(onOpenFile).not.toHaveBeenCalled());
    expect(screen.getByRole("treeitem", { name: /folder-link/ }).getAttribute("aria-expanded"))
      .toBeNull();
  });
});
