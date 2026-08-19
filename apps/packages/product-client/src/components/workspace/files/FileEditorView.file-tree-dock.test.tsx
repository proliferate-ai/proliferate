// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceFileEntry } from "@anyharness/sdk";
import { FileEditorView } from "#product/components/workspace/files/FileEditorView";
import {
  WorkspaceShellActionsContext,
  type WorkspaceShellActions,
} from "#product/hooks/workspaces/workflows/use-workspace-shell-actions";
import {
  resetFileTreeStoreForTests,
  useFileTreeStore,
} from "#product/stores/editor/file-tree-store";
import {
  fileViewerTarget,
  viewerTargetKey,
} from "#product/lib/domain/workspaces/viewer/viewer-target";

/**
 * The focused dock-controller matrix (spec "02A - Docked File Tree", "Tests
 * and qualification" items 4, 8 and 9). `FileEditorView.test.tsx` keeps the
 * existing viewer behaviour pins; this file owns the frame/controller states,
 * geometry requests, focus origins, and session-key claim.
 */

const openFileMock = vi.fn();
const ensureRightPanelWidth = vi.fn();
const workspaceFilesQuery = vi.fn();
const searchWorkspaceFilesQuery = vi.fn();
const readWorkspaceFileQuery = vi.fn();
let workspaceFileContext = {
  workspaceUiKey: "logical-1",
  materializedWorkspaceId: "workspace-1",
  treeStateKey: "tree-1",
};

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({ clipboard: { writeText: vi.fn(async () => undefined) } }),
}));

vi.mock("#product/hooks/ui/highlighting/use-highlighted-lines", () => ({
  useHighlightedLines: (code: string) =>
    code.split("\n").map((line) => [{ content: line }]),
}));

vi.mock("#product/hooks/workspaces/workflows/files/use-file-reference-actions", () => ({
  useFileReferenceActions: () => ({
    reference: { locator: { authority: "unavailable", reason: "runtime_unavailable" } },
    nativePathKind: null,
    openTargets: [],
    defaultOpenTarget: null,
    canOpenExternal: false,
    copyCurrentPath: vi.fn(),
    openDefault: vi.fn(),
    openWithTarget: vi.fn(),
  }),
}));

vi.mock("#product/hooks/workspaces/derived/files/use-workspace-file-context", () => ({
  useWorkspaceFileContext: () => workspaceFileContext,
}));

vi.mock("#product/hooks/workspaces/workflows/files/use-workspace-file-target-actions", () => ({
  useWorkspaceFileTargetActions: () => ({
    openFile: openFileMock,
    openFileDiff: vi.fn(),
    openViewerTarget: vi.fn(),
  }),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useReadWorkspaceFileQuery: (options: unknown) => readWorkspaceFileQuery(options),
  useGitDiffQuery: () => ({ isLoading: false, data: undefined }),
  useWorkspaceFilesQuery: (options: unknown) => workspaceFilesQuery(options),
  useSearchWorkspaceFilesQuery: (options: unknown) => searchWorkspaceFilesQuery(options),
  useStatWorkspaceFileQuery: () => ({
    data: undefined,
    isFetching: false,
    error: null,
    refetch: vi.fn(async () => ({ data: undefined })),
  }),
  useGitStatusQuery: () => ({ data: undefined, isLoading: false }),
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

const ROOT_ENTRIES: WorkspaceFileEntry[] = [
  { name: "src", path: "src", kind: "directory" },
  { name: "README.md", path: "README.md", kind: "file" },
];

let measuredBodyWidth = 780;
let measuredRailWidth = 781;
const resizeCallbacks = new Set<() => void>();

/** Re-measure the viewer body, the way a real shell resize would. */
function resizeTo(bodyWidth: number, railWidth = bodyWidth + 1): void {
  measuredBodyWidth = bodyWidth;
  measuredRailWidth = railWidth;
  act(() => {
    for (const callback of resizeCallbacks) {
      callback();
    }
  });
}

/**
 * jsdom reports every `clientWidth` as 0, so the two measured seams the
 * geometry contract reads are stubbed by attribute. `781/780` is the
 * default-desired-width open target and `661/660` the shell-clamped minimum.
 */
function stubMeasuredWidths(): void {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.hasAttribute("data-file-viewer-body")) {
        return measuredBodyWidth;
      }
      if (this.hasAttribute("data-right-panel-rail")) {
        return measuredRailWidth;
      }
      return 0;
    },
  });
}

function shellActions(): WorkspaceShellActions {
  return {
    openTerminalPanel: () => true,
    openRightPanelTool: vi.fn(),
    openPublishDialog: vi.fn(),
    openPullRequest: vi.fn(),
    workspaceWebActions: {
      disabled: true,
      disabledReason: null,
      openCurrentWorkspaceInWeb: vi.fn(),
      title: "",
      url: null,
    },
    workspaceRemoteAccessActions: {
      disabled: true,
      handleClick: vi.fn(),
      isEnabled: false,
      isPending: false,
      label: "",
      syncToWeb: vi.fn(),
      syncToWebDisabledReason: null,
      title: "",
    },
    ensureRightPanelWidth,
  };
}

function Rail({ children }: { children: ReactNode }) {
  return (
    <WorkspaceShellActionsContext.Provider value={shellActions()}>
      <div data-right-panel-rail>{children}</div>
    </WorkspaceShellActionsContext.Provider>
  );
}

function renderViewer(filePath = "README.md") {
  const target = fileViewerTarget(filePath);
  return render(
    <Rail>
      <FileEditorView filePath={filePath} targetKey={viewerTargetKey(target)} />
    </Rail>,
  );
}

function dock(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>("[data-docked-file-tree]");
}

beforeEach(() => {
  resizeCallbacks.clear();
  class TestResizeObserver {
    constructor(private readonly callback: () => void) {}
    observe() {
      resizeCallbacks.add(this.callback);
    }
    unobserve() {
      resizeCallbacks.delete(this.callback);
    }
    disconnect() {
      resizeCallbacks.delete(this.callback);
    }
  }
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  stubMeasuredWidths();
  measuredBodyWidth = 780;
  measuredRailWidth = 781;
  resetFileTreeStoreForTests();
  openFileMock.mockReset();
  ensureRightPanelWidth.mockReset();
  workspaceFileContext = {
    workspaceUiKey: "logical-1",
    materializedWorkspaceId: "workspace-1",
    treeStateKey: "tree-1",
  };
  readWorkspaceFileQuery.mockReturnValue({
    data: {
      content: "# hello\n",
      isText: true,
      path: "README.md",
      sizeBytes: 8,
      tooLarge: false,
      versionToken: "v1",
    },
    error: null,
    isLoading: false,
  });
  // Path-aware: only the root query returns entries. A flat mock that
  // returns ROOT_ENTRIES (which contains a "src" directory) for every path,
  // including nested "src", makes "src" self-referential and any reveal/
  // auto-expand walk into it non-terminating.
  workspaceFilesQuery.mockImplementation((options: { path?: string }) => ({
    data: { entries: !options?.path ? ROOT_ENTRIES : [] },
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(async () => ({ data: { entries: !options?.path ? ROOT_ENTRIES : [] } })),
  }));
  searchWorkspaceFilesQuery.mockReturnValue({
    data: undefined,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FileEditorView dock controller", () => {
  it("claims the derived first tree-state key in its layout lifecycle", () => {
    renderViewer();
    expect(
      useFileTreeStore.getState().firstTreeStateKeyByMaterializedWorkspace.get("workspace-1"),
    ).toBe("tree-1");
  });

  it("treats an incomplete workspace file context as unavailable", () => {
    workspaceFileContext = {
      workspaceUiKey: "logical-1",
      materializedWorkspaceId: "workspace-1",
      treeStateKey: null,
    };
    // A stale requested value must not survive unavailability.
    useFileTreeStore.getState().setRequestedVisibility(
      { primaryKey: "logical-1", fallbackKey: "workspace-1" },
      true,
    );
    const { container } = renderViewer();

    const toggle = screen.getByRole("button", { name: "Show files" });
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.getAttribute("title")).toBe("Files are unavailable for this workspace");
    expect(dock(container)).toBeNull();
    // Inert crumbs: the literal Files crumb is text, not a control.
    expect(screen.queryByRole("button", { name: "Files" })).toBeNull();
    expect(screen.getByText("Files")).toBeTruthy();

    fireEvent.click(toggle);
    expect(ensureRightPanelWidth).not.toHaveBeenCalled();
  });

  it("renders the available-but-closed state with invocable crumbs and no dock", () => {
    const { container } = renderViewer("src/index.ts");
    const toggle = screen.getByRole("button", { name: "Show files" });
    expect((toggle as HTMLButtonElement).disabled).toBe(false);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.getAttribute("title")).toBeNull();
    expect(dock(container)).toBeNull();
    expect(screen.getByRole("button", { name: "Files" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "src" })).toBeTruthy();
  });

  it("opens at the 781px desired-width target and mounts the dock", async () => {
    // Pre-open geometry is the default 420px rail / 419px body.
    measuredRailWidth = 420;
    measuredBodyWidth = 419;
    const { container } = renderViewer();

    fireEvent.click(screen.getByRole("button", { name: "Show files" }));
    expect(ensureRightPanelWidth).toHaveBeenCalledWith(781);

    // The shell grants it; the dock becomes effectively visible.
    resizeTo(780, 781);
    await waitFor(() => expect(dock(container)).toBeTruthy());
    expect(screen.getByRole("button", { name: "Hide files" }).getAttribute("aria-pressed"))
      .toBe("true");
    expect(dock(container)!.style.width).toBe("400px");
  });

  it("keeps requested visibility but hides the dock below the 660px body threshold", () => {
    measuredBodyWidth = 659;
    measuredRailWidth = 660;
    useFileTreeStore.getState().setRequestedVisibility(
      { primaryKey: "logical-1", fallbackKey: "workspace-1" },
      true,
    );
    const { container } = renderViewer();

    const toggle = screen.getByRole("button", { name: "Hide files" });
    expect((toggle as HTMLButtonElement).disabled).toBe(false);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.getAttribute("title")).toBe("Widen the window to show files");
    expect(dock(container)).toBeNull();

    // A breadcrumb invocation retains requested visibility and asks for width.
    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(ensureRightPanelWidth).toHaveBeenCalledWith(660 + (380 + 400 - 659));
    expect(
      useFileTreeStore.getState().requestedVisibilityByWorkspace["logical-1"],
    ).toBe(true);

    // The toggle is the explicit close, even while auto-collapsed.
    fireEvent.click(screen.getByRole("button", { name: "Hide files" }));
    expect(
      useFileTreeStore.getState().requestedVisibilityByWorkspace["logical-1"],
    ).toBe(false);
  });

  it("auto-collapses and restores without changing requested visibility or desired width", async () => {
    useFileTreeStore.getState().setDesiredWidth(520);
    useFileTreeStore.getState().setRequestedVisibility(
      { primaryKey: "logical-1", fallbackKey: "workspace-1" },
      true,
    );
    measuredBodyWidth = 980;
    measuredRailWidth = 981;
    const { container } = renderViewer();
    await waitFor(() => expect(dock(container)).toBeTruthy());

    resizeTo(600);
    await waitFor(() => expect(dock(container)).toBeNull());
    expect(
      useFileTreeStore.getState().requestedVisibilityByWorkspace["logical-1"],
    ).toBe(true);
    expect(useFileTreeStore.getState().desiredWidth).toBe(520);
  });

  it("is the single dock controller across the loading and error branches", () => {
    readWorkspaceFileQuery.mockReturnValue({
      data: undefined,
      error: null,
      isLoading: true,
    });
    const loading = renderViewer();
    expect(screen.getAllByRole("button", { name: "Show files" })).toHaveLength(1);
    loading.unmount();

    readWorkspaceFileQuery.mockReturnValue({
      data: undefined,
      error: new Error("boom"),
      isLoading: false,
    });
    renderViewer();
    expect(screen.getAllByRole("button", { name: "Show files" })).toHaveLength(1);
  });

  it("activates a tree row through the canonical workspace file target action", async () => {
    useFileTreeStore.getState().setRequestedVisibility(
      { primaryKey: "logical-1", fallbackKey: "workspace-1" },
      true,
    );
    const { container } = renderViewer();
    await waitFor(() => expect(dock(container)).toBeTruthy());

    fireEvent.click(screen.getByRole("treeitem", { name: /README\.md/ }));
    expect(openFileMock).toHaveBeenCalledWith("README.md");
  });

  it("focuses the filter on a toolbar open and restores toolbar focus on Escape close", async () => {
    measuredRailWidth = 781;
    measuredBodyWidth = 780;
    const { container } = renderViewer();
    const toggle = screen.getByRole("button", { name: "Show files" });
    toggle.focus();
    fireEvent.click(toggle);

    await waitFor(() => expect(dock(container)).toBeTruthy());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByPlaceholderText("Filter files…")));

    fireEvent.keyDown(dock(container)!, { key: "Escape" });
    await waitFor(() => expect(dock(container)).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Show files" }));
  });

  it("resets the filter on explicit close and retains it across auto-collapse", async () => {
    searchWorkspaceFilesQuery.mockReturnValue({
      data: {
        results: [
          { name: "Button.tsx", path: "src/components/Button.tsx" },
          { name: "button.css", path: "src/styles/button.css" },
        ],
      },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    const { container } = renderViewer();
    fireEvent.click(screen.getByRole("button", { name: "Show files" }));
    await waitFor(() => expect(dock(container)).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText("Filter files…"), {
      target: { value: "b" },
    });
    expect(screen.getByRole("treeitem", { name: /src\/components/ })).toBeTruthy();

    // Responsive auto-collapse retains the filter while the controller lives.
    resizeTo(500);
    await waitFor(() => expect(dock(container)).toBeNull());
    resizeTo(780, 781);
    await waitFor(() => expect(dock(container)).toBeTruthy());
    expect((screen.getByPlaceholderText("Filter files…") as HTMLInputElement).value).toBe("b");

    // The explicit close resets it.
    fireEvent.click(screen.getByRole("button", { name: "Hide files" }));
    fireEvent.click(screen.getByRole("button", { name: "Show files" }));
    await waitFor(() => expect(dock(container)).toBeTruthy());
    expect((screen.getByPlaceholderText("Filter files…") as HTMLInputElement).value).toBe("");
  });

  it("does not steal focus when a responsive restore remounts the dock", async () => {
    useFileTreeStore.getState().setRequestedVisibility(
      { primaryKey: "logical-1", fallbackKey: "workspace-1" },
      true,
    );
    measuredBodyWidth = 500;
    const { container } = renderViewer();
    expect(dock(container)).toBeNull();

    const toggle = screen.getByRole("button", { name: "Hide files" });
    toggle.focus();
    resizeTo(780, 781);
    await waitFor(() => expect(dock(container)).toBeTruthy());
    expect(document.activeElement).toBe(toggle);
  });

  it("focuses the filter once a default-rail widen lands (2091-R2-1)", async () => {
    // Production default rail: 420px rail / 419px body, below the 660px
    // dock threshold. The pending-focus token must still be minted here —
    // it resolves once the requested widen actually lands.
    measuredRailWidth = 420;
    measuredBodyWidth = 419;
    ensureRightPanelWidth.mockImplementation((width: number) => resizeTo(width - 1, width));
    const { container } = renderViewer();

    const toggle = screen.getByRole("button", { name: "Show files" });
    toggle.focus();
    fireEvent.click(toggle);
    expect(ensureRightPanelWidth).toHaveBeenCalledWith(781);

    await waitFor(() => expect(dock(container)).toBeTruthy());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByPlaceholderText("Filter files…")));
  });

  it("reveals and focuses the crumb's row once a default-rail widen lands (2091-R2-1)", async () => {
    measuredRailWidth = 420;
    measuredBodyWidth = 419;
    ensureRightPanelWidth.mockImplementation((width: number) => resizeTo(width - 1, width));
    const { container } = renderViewer("src/index.ts");

    const crumb = screen.getByRole("button", { name: "src" });
    fireEvent.click(crumb);
    expect(ensureRightPanelWidth).toHaveBeenCalled();

    await waitFor(() => expect(dock(container)).toBeTruthy());
    // The reveal token is consumed by the mounted dock: the revealed "src"
    // row, not the filter, ends up focused.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("treeitem", { name: /^src/ })));
  });

  it("discards a reveal token that hard-caps below 660px and never lets a later unrelated widen steal focus (2091-R2-1)", async () => {
    measuredBodyWidth = 459;
    measuredRailWidth = 460;
    // The shell can only grant a clamped width that still can't reach the
    // 660px dock threshold (e.g. a narrow OS window). The widen still
    // "lands" — it just doesn't make the dock effectively visible.
    ensureRightPanelWidth.mockImplementation(() => resizeTo(499, 500));
    const { container } = renderViewer("src/index.ts");
    expect(dock(container)).toBeNull();

    const crumb = screen.getByRole("button", { name: "src" });
    crumb.focus();
    fireEvent.click(crumb);
    // The reveal still retains requested visibility and asks the shell to
    // widen, even though the settled geometry can't reach the dock
    // threshold.
    expect(ensureRightPanelWidth).toHaveBeenCalled();
    expect(
      useFileTreeStore.getState().requestedVisibilityByWorkspace["logical-1"],
    ).toBe(true);
    expect(dock(container)).toBeNull();
    expect(document.activeElement).toBe(crumb);

    // A much later, unrelated responsive widen (e.g. the user manually
    // resizes the OS window) mounts the dock; the reveal token from the
    // settled-but-still-hidden click must not have survived to steal focus.
    resizeTo(780, 781);
    await waitFor(() => expect(dock(container)).toBeTruthy());
    expect(document.activeElement).toBe(crumb);
  });

  it("wraps only the viewer content in the file-viewer context menu", () => {
    useFileTreeStore.getState().setRequestedVisibility(
      { primaryKey: "logical-1", fallbackKey: "workspace-1" },
      true,
    );
    const { container } = renderViewer();
    const content = container.querySelector("[data-file-viewer-content]")!;
    expect(content.contains(dock(container))).toBe(false);
    expect(container.querySelector("[data-file-tree-overlay]")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
