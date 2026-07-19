// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { WorkspaceFileEntry } from "@anyharness/sdk";
import { FileTreeOverlay } from "#product/components/workspace/files/tree/FileTreeOverlay";
import {
  resetFileTreeStoreForTests,
  useFileTreeStore,
} from "#product/stores/editor/file-tree-store";

const queryMocks = vi.hoisted(() => ({
  root: {
    data: undefined as { entries: WorkspaceFileEntry[] } | undefined,
    isLoading: false,
    error: null as Error | null,
  },
  nested: new Map<string, {
    data?: { entries: WorkspaceFileEntry[] };
    isLoading: boolean;
    error: Error | null;
  }>(),
  stat: new Map<string, {
    data?: { kind: "file" | "directory" | "symlink"; sizeBytes?: number };
    isFetching: boolean;
    refetch: ReturnType<typeof vi.fn>;
  }>(),
  search: {
    data: undefined as { results: Array<{ name: string; path: string }> } | undefined,
    isLoading: false,
    error: null as Error | null,
  },
}));

vi.mock("@anyharness/sdk-react", () => ({
  useWorkspaceFilesQuery: ({ path }: { path: string }) =>
    path === "" ? queryMocks.root : queryMocks.nested.get(path) ?? {
      data: { entries: [] },
      isLoading: false,
      error: null,
    },
  useStatWorkspaceFileQuery: ({ path }: { path: string }) =>
    queryMocks.stat.get(path) ?? {
      data: undefined,
      isFetching: false,
      refetch: vi.fn(async () => ({ data: undefined })),
    },
  useSearchWorkspaceFilesQuery: () => queryMocks.search,
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
  resetFileTreeStoreForTests();
  queryMocks.root.data = undefined;
  queryMocks.root.isLoading = false;
  queryMocks.root.error = null;
  queryMocks.nested.clear();
  queryMocks.stat.clear();
  queryMocks.search.data = undefined;
  queryMocks.search.isLoading = false;
  queryMocks.search.error = null;
  vi.clearAllMocks();
});

describe("FileTreeOverlay", () => {
  it.each([
    ["loading", { isLoading: true, error: null, data: undefined }, "Loading files…"],
    ["error", { isLoading: false, error: new Error("boom"), data: undefined }, "Files could not be loaded."],
    ["empty", { isLoading: false, error: null, data: { entries: [] } }, "This folder is empty."],
  ])("shows an explicit %s root state", (_label, state, message) => {
    Object.assign(queryMocks.root, state);
    renderOverlay();

    expect(screen.getByRole("status").textContent).toBe(message);
  });

  it("reveals a deeply selected file, preserves hierarchy, and marks changed files", async () => {
    const rootEntries = Array.from({ length: 120 }, (_, index): WorkspaceFileEntry => ({
      name: `root-${String(index).padStart(3, "0")}.txt`,
      path: `root-${String(index).padStart(3, "0")}.txt`,
      kind: "file",
    }));
    rootEntries.splice(2, 0, {
      name: "apps-link",
      path: "apps-link",
      kind: "symlink",
    });
    queryMocks.root.data = { entries: rootEntries };
    queryMocks.stat.set("apps-link", {
      data: { kind: "symlink" },
      isFetching: false,
      refetch: vi.fn(),
    });
    queryMocks.nested.set("apps-link", {
      data: {
        entries: [{ name: "deep.ts", path: "apps-link/deep.ts", kind: "file" }],
      },
      isLoading: false,
      error: null,
    });

    renderOverlay({
      selectedPath: "apps-link/deep.ts",
      changedPaths: new Set(["apps-link/deep.ts"]),
    });

    const selected = await screen.findByRole("treeitem", { name: /deep\.ts/ });
    expect(selected.getAttribute("aria-selected")).toBe("true");
    expect(selected.getAttribute("aria-level")).toBe("2");
    expect(screen.getByLabelText("Modified").textContent).toBe("M");
    expect(screen.getByRole("treeitem", { name: /apps-link/ }).getAttribute("aria-expanded"))
      .toBe("true");
  });

  it("stats symlinks before expanding directory targets or opening file targets", async () => {
    queryMocks.root.data = {
      entries: [
        { name: "folder-link", path: "folder-link", kind: "symlink" },
        { name: "file-link.ts", path: "file-link.ts", kind: "symlink" },
      ],
    };
    queryMocks.nested.set("folder-link", {
      data: {
        entries: [{ name: "child.ts", path: "folder-link/child.ts", kind: "file" }],
      },
      isLoading: false,
      error: null,
    });
    queryMocks.stat.set("folder-link", {
      data: undefined,
      isFetching: false,
      refetch: vi.fn(async () => ({ data: { kind: "symlink" } })),
    });
    queryMocks.stat.set("file-link.ts", {
      data: undefined,
      isFetching: false,
      refetch: vi.fn(async () => ({ data: { kind: "symlink", sizeBytes: 0 } })),
    });
    const onOpenFile = vi.fn();
    renderOverlay({ selectedPath: "", onOpenFile });

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

  it("supports filter clearing, keyboard resize, and Escape dismissal", async () => {
    queryMocks.root.data = {
      entries: [{ name: "README.md", path: "README.md", kind: "file" }],
    };
    queryMocks.search.data = {
      results: [{ name: "README.md", path: "README.md" }],
    };
    const onClose = vi.fn();
    renderOverlay({ onClose });

    fireEvent.change(screen.getByPlaceholderText("Filter files…"), {
      target: { value: "read" },
    });
    expect(screen.getByRole("button", { name: "Clear file filter" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear file filter" }));
    expect((screen.getByPlaceholderText("Filter files…") as HTMLInputElement).value).toBe("");

    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize file browser" }), {
      key: "ArrowLeft",
    });
    await waitFor(() => expect(useFileTreeStore.getState().width).toBe(416));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

function renderOverlay(overrides: Partial<ComponentProps<typeof FileTreeOverlay>> = {}) {
  return render(
    <FileTreeOverlay
      open
      workspaceId="workspace-1"
      selectedPath="README.md"
      onOpenFile={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />,
  );
}
