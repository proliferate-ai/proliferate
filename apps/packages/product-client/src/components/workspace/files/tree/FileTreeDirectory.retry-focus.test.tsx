// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useCallback, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceFileEntry } from "@anyharness/sdk";
import { DockedFileTree } from "#product/components/workspace/files/tree/DockedFileTree";

/**
 * Split out of `DockedFileTree.test.tsx` to stay under the file-size cap.
 * Focused proof for the root retry row's focus-settlement rule (finding
 * 2091-R1-B01, spec "02A - Docked File Tree"): DOM focus may only move to
 * the resolved row if the retry row is still `document.activeElement` at
 * refetch settlement, not at dispatch time.
 */

const queryMocks = vi.hoisted(() => ({
  root: {
    data: undefined as { entries: WorkspaceFileEntry[] } | undefined,
    isLoading: false,
    isFetching: false,
    error: { status: 503 } as unknown,
    refetch: vi.fn(async () => ({ data: undefined as unknown })),
  },
}));

vi.mock("@anyharness/sdk-react", () => ({
  useWorkspaceFilesQuery: () => queryMocks.root,
  useStatWorkspaceFileQuery: () => ({
    data: undefined, isFetching: false, error: null, refetch: vi.fn(async () => ({ data: undefined })),
  }),
  useSearchWorkspaceFilesQuery: () => ({
    data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn(),
  }),
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 28,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 28 })),
    measureElement: vi.fn(),
    scrollToIndex: vi.fn(),
  }),
}));

afterEach(() => {
  queryMocks.root.data = undefined;
  queryMocks.root.error = { status: 503 };
  vi.clearAllMocks();
});

const ROOT_ENTRIES: WorkspaceFileEntry[] = [
  { name: "alpha", path: "alpha", kind: "directory" },
  { name: "README.md", path: "README.md", kind: "file" },
];

function DockHarness() {
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const write = useCallback((path: string, next: boolean) => {
    setExpanded((current) => {
      const updated = new Set(current);
      if (next) { updated.add(path); } else { updated.delete(path); }
      return updated;
    });
  }, []);
  const toggle = useCallback((path: string) => setExpanded((current) => {
    const updated = new Set(current);
    if (updated.has(path)) { updated.delete(path); } else { updated.add(path); }
    return updated;
  }), []);

  return (
    <DockedFileTree
      workspaceId="workspace-1"
      selectedPath="README.md"
      expandedPaths={expanded}
      setExpanded={write}
      toggleExpanded={toggle}
      onOpenFile={vi.fn()}
      width={400}
      bodyWidth={800}
      onDesiredWidthChange={vi.fn()}
      filter={filter}
      onFilterChange={setFilter}
      onRequestClose={vi.fn()}
      captureRequest={() => 1}
      isCurrent={() => true}
      pendingFilterFocus={false}
      revealRequest={null}
      onPendingFocusHandled={vi.fn()}
    />
  );
}

describe("FileTreeDirectory retry row focus settlement", () => {
  it("does not steal DOM focus back to a resolved retry row once focus moved elsewhere mid-refetch (2091-R1-B01)", async () => {
    let resolveRefetch!: (value: { data: { entries: WorkspaceFileEntry[] } }) => void;
    const refetch = vi.fn(() => new Promise<{ data: { entries: WorkspaceFileEntry[] } }>((resolve) => { resolveRefetch = resolve; }));
    queryMocks.root.refetch = refetch;
    render(<DockHarness />);

    const retry = screen.getByRole("treeitem", { name: "Retry loading files" });
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));

    // The user moves focus to the filter before the refetch settles.
    const filterInput = screen.getByPlaceholderText("Filter files…");
    filterInput.focus();

    queryMocks.root.data = { entries: ROOT_ENTRIES };
    queryMocks.root.error = null;
    resolveRefetch({ data: { entries: ROOT_ENTRIES } });

    // Roving ownership may move per the retry's own rule, but DOM focus
    // must stay exactly where the user put it.
    await waitFor(() => expect(screen.queryByRole("treeitem", { name: "Retry loading files" })).toBeNull());
    expect(document.activeElement).toBe(filterInput);
  });
});
