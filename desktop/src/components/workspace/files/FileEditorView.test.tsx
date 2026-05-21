// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fileViewerTarget,
  fileDiffViewerTarget,
  viewerTargetKey,
  type ViewerTarget,
} from "@/lib/domain/workspaces/viewer/viewer-target";
import { useContentSearchStore } from "@/stores/search/content-search-store";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";
import { FileEditorView } from "./FileEditorView";

const readWorkspaceFileQuery = vi.fn();
const gitDiffQuery = vi.fn();
const workspaceFilesQuery = vi.fn();
const searchWorkspaceFilesQuery = vi.fn();
const openFileMock = vi.fn();
let workspaceFileContext = {
  workspaceUiKey: "workspace-1",
  materializedWorkspaceId: "workspace-1",
  treeStateKey: "workspace-1",
};

vi.mock("@/components/ui/content/DiffViewer", () => ({
  DiffViewer: () => createElement("div", null, "diff rendered"),
}));

vi.mock("@/hooks/ui/use-highlighted-lines", () => ({
  useHighlightedLines: (code: string) =>
    code.split("\n").map((line) => [{ content: line }]),
}));

vi.mock("@/hooks/workspaces/files/use-file-reference-actions", () => ({
  useFileReferenceActions: () => ({
    reference: {
      rawPath: "package.json",
      path: "package.json",
      line: null,
      column: null,
      absolutePath: "/repo/package.json",
      workspacePath: "package.json",
    },
    openTargets: [],
    canOpenInSidebar: true,
    canOpenExternal: true,
    copyPath: vi.fn(),
    openInSidebar: vi.fn(),
    openDefault: vi.fn(),
    openPrimary: vi.fn(),
    openWithTarget: vi.fn(),
    reveal: vi.fn(),
  }),
}));

vi.mock("@/hooks/workspaces/files/derived/use-workspace-file-context", () => ({
  useWorkspaceFileContext: () => workspaceFileContext,
}));

vi.mock("@/hooks/workspaces/files/workflows/use-workspace-file-target-actions", () => ({
  useWorkspaceFileTargetActions: () => ({
    openFile: openFileMock,
    openFileDiff: vi.fn(),
    openViewerTarget: vi.fn(),
  }),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useReadWorkspaceFileQuery: (options: unknown) => readWorkspaceFileQuery(options),
  useGitDiffQuery: (options: unknown) => gitDiffQuery(options),
  useWorkspaceFilesQuery: (options: unknown) => workspaceFilesQuery(options),
  useSearchWorkspaceFilesQuery: (options: unknown) => searchWorkspaceFilesQuery(options),
}));

describe("FileEditorView", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    class TestResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    readWorkspaceFileQuery.mockReset();
    gitDiffQuery.mockReset();
    workspaceFilesQuery.mockReset();
    searchWorkspaceFilesQuery.mockReset();
    openFileMock.mockReset();
    workspaceFileContext = {
      workspaceUiKey: "workspace-1",
      materializedWorkspaceId: "workspace-1",
      treeStateKey: "workspace-1",
    };
    readWorkspaceFileQuery.mockReturnValue({
      data: undefined,
      error: new Error("not found"),
      isLoading: false,
    });
    gitDiffQuery.mockReturnValue({
      isLoading: false,
      data: {
        patch: [
          "diff --git a/src/deleted.ts b/src/deleted.ts",
          "deleted file mode 100644",
          "--- a/src/deleted.ts",
          "+++ /dev/null",
          "@@ -1 +0,0 @@",
          "-deleted",
        ].join("\n"),
      },
    });
    workspaceFilesQuery.mockReturnValue({
      data: {
        entries: [
          { kind: "directory", name: "src", path: "src" },
          { kind: "file", name: "README.md", path: "README.md" },
        ],
      },
      isError: false,
      isLoading: false,
    });
    searchWorkspaceFilesQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
    });
    useWorkspaceViewerTabsStore.getState().reset();
    useContentSearchStore.setState({
      open: false,
      query: "",
      surface: "chat",
      scope: "diffs",
      activeMatchIndex: 0,
      activeMatchId: null,
      unitsById: {},
      nextUnitOrder: 0,
    });
  });

  it("renders focused diffs without requiring a current file read", () => {
    const target = fileDiffViewerTarget({
      path: "src/deleted.ts",
      scope: "unstaged",
    }) as Extract<ViewerTarget, { kind: "fileDiff" }>;
    const targetKey = viewerTargetKey(target);
    useWorkspaceViewerTabsStore.setState({
      materializedWorkspaceId: "workspace-1",
    });
    useWorkspaceViewerTabsStore.getState().openTarget(target);

    render(createElement(FileEditorView, {
      filePath: "src/deleted.ts",
      targetKey,
      diffTarget: target,
    }));

    expect(readWorkspaceFileQuery).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      path: "src/deleted.ts",
      enabled: false,
    });
    expect(gitDiffQuery).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      path: "src/deleted.ts",
      scope: "unstaged",
      baseRef: null,
      oldPath: null,
    });
    expect(screen.getByText("diff rendered")).toBeTruthy();
    expect(screen.queryByText("not found")).toBeNull();
  });

  it("renders source files with the read-only source viewer", () => {
    const target = fileViewerTarget("package.json");
    const targetKey = viewerTargetKey(target);
    useWorkspaceViewerTabsStore.setState({
      materializedWorkspaceId: "workspace-1",
    });
    useWorkspaceViewerTabsStore.getState().openTarget(target);
    readWorkspaceFileQuery.mockReturnValue({
      data: {
        content: "{\"ok\":true}",
        isText: true,
        path: "package.json",
        sizeBytes: 11,
        tooLarge: false,
        versionToken: "v1",
      },
      error: null,
      isLoading: false,
    });

    const { container } = render(createElement(FileEditorView, {
      filePath: "package.json",
      targetKey,
    }));

    expect(readWorkspaceFileQuery).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      path: "package.json",
      enabled: true,
    });
    expect(screen.getByText("{\"ok\":true}")).toBeTruthy();
    expect(screen.queryByText("editor")).toBeNull();
    expect(screen.queryByText("Save")).toBeNull();
    expect(container.querySelector("[data-file-source-view]")?.getAttribute("data-word-wrap"))
      .toBe("false");
    expect(container.querySelector("[data-file-source-virtualized]")).toBeTruthy();
    expect(container.querySelector(".file-source-line-number")?.textContent).toBe("1");
    expect(container.querySelector(".file-source-scroll")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("File viewer options"));
    expect(screen.getByText("Enable word wrap")).toBeTruthy();
  });

  it("virtualizes large source files instead of mounting every line", () => {
    const target = fileViewerTarget("package.json");
    const targetKey = viewerTargetKey(target);
    const lines = Array.from({ length: 200_000 }, (_, index) =>
      index === 0 ? "unique first line" : `line ${index % 10}`
    );
    useWorkspaceViewerTabsStore.setState({
      materializedWorkspaceId: "workspace-1",
    });
    useWorkspaceViewerTabsStore.getState().openTarget(target);
    readWorkspaceFileQuery.mockReturnValue({
      data: {
        content: lines.join("\n"),
        isText: true,
        path: "package.json",
        sizeBytes: 5000,
        tooLarge: false,
        versionToken: "v1",
      },
      error: null,
      isLoading: false,
    });

    const { container } = render(createElement(FileEditorView, {
      filePath: "package.json",
      targetKey,
    }));

    expect(screen.getByText("unique first line")).toBeTruthy();
    expect(container.querySelectorAll("[data-source-line]").length).toBeLessThan(lines.length);
  });

  it("overlays the file browser without replacing the source view", () => {
    const target = fileViewerTarget("package.json");
    const targetKey = viewerTargetKey(target);
    useWorkspaceViewerTabsStore.setState({
      materializedWorkspaceId: "workspace-1",
    });
    useWorkspaceViewerTabsStore.getState().openTarget(target);
    readWorkspaceFileQuery.mockReturnValue({
      data: {
        content: "{\"ok\":true}",
        isText: true,
        path: "package.json",
        sizeBytes: 11,
        tooLarge: false,
        versionToken: "v1",
      },
      error: null,
      isLoading: false,
    });

    const { container } = render(createElement(FileEditorView, {
      filePath: "package.json",
      targetKey,
    }));

    fireEvent.click(screen.getByLabelText("Show files"));

    expect(screen.getByRole("dialog", { name: "Browse files" })).toBeTruthy();
    expect(container.querySelector("[data-pane-side-overlay]")).toBeTruthy();
    expect(container.querySelector("[data-file-browser-overlay]")).toBeTruthy();
    expect(screen.getByText("{\"ok\":true}")).toBeTruthy();
    expect(screen.getByText("README.md")).toBeTruthy();
    expect(workspaceFilesQuery).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      path: "",
      enabled: true,
    });
    expect(searchWorkspaceFilesQuery).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      query: "",
      limit: 60,
      enabled: false,
    });
  });

  it("opens pane-local content search from the file viewer toolbar", () => {
    const target = fileViewerTarget("package.json");
    const targetKey = viewerTargetKey(target);
    useWorkspaceViewerTabsStore.setState({
      materializedWorkspaceId: "workspace-1",
    });
    useWorkspaceViewerTabsStore.getState().openTarget(target);
    readWorkspaceFileQuery.mockReturnValue({
      data: {
        content: "{\"ok\":true}",
        isText: true,
        path: "package.json",
        sizeBytes: 11,
        tooLarge: false,
        versionToken: "v1",
      },
      error: null,
      isLoading: false,
    });
    const { container } = render(createElement(FileEditorView, {
      filePath: "package.json",
      targetKey,
    }));

    expect(screen.queryByLabelText("Search files")).toBeNull();
    fireEvent.click(screen.getByLabelText("Find in file"));
    expect(useContentSearchStore.getState().open).toBe(true);
    expect(useContentSearchStore.getState().scope).toBe("diffs");
    expect(useContentSearchStore.getState().surface).toBe("file");
    expect(container.querySelector('[data-content-search-surface="file"]')).toBeTruthy();
    expect(screen.getByPlaceholderText("Search file…")).toBeTruthy();
    expect(screen.queryByLabelText("Search chat")).toBeNull();
    expect(screen.queryByLabelText("Search diffs")).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Search workspace files" })).toBeNull();
    expect(searchWorkspaceFilesQuery.mock.calls.some(([options]) => options?.enabled === true))
      .toBe(false);
  });
});
