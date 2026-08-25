// @vitest-environment jsdom
//
// FileEditorView open-in wiring per the 02B open-in contract: fail-closed
// eligibility expressed purely through 01D's resolved outputs, zero native
// calls when ineligible, openInRevision bumping on capability-identity
// change, and bounded retryable failure copy through a re-validated retry.

import { createElement } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fileViewerTarget,
  viewerTargetKey,
} from "#product/lib/domain/workspaces/viewer/viewer-target";
import { useWorkspaceViewerTabsStore } from "#product/stores/editor/workspace-viewer-tabs-store";
import { resetFileTreeStoreForTests } from "#product/stores/editor/file-tree-store";
import { FileEditorView } from "#product/components/workspace/files/FileEditorView";

const readWorkspaceFileQuery = vi.fn();
const openFileMock = vi.fn();
const writeTextMock = vi.fn(async () => undefined);
const openDefaultMock = vi.fn(async () => true);
const openWithTargetMock = vi.fn(async () => undefined);

const vsCode = { id: "vscode", label: "VS Code", kind: "app" as const };

let fileActionsState: {
  locator: unknown;
  nativePathKind: "file" | "directory" | null;
  canOpenExternal: boolean;
  openTargets: typeof vsCode[];
  defaultOpenTarget: typeof vsCode | null;
};

function resetFileActionsState() {
  fileActionsState = {
    locator: { authority: "desktop", absolutePath: "/Users/dev/repo/package.json" },
    nativePathKind: "file",
    canOpenExternal: true,
    openTargets: [vsCode],
    defaultOpenTarget: vsCode,
  };
}

vi.mock("#product/components/content/ui/DiffViewer", () => ({
  DiffViewer: () => createElement("div", null, "diff rendered"),
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({ clipboard: { writeText: writeTextMock } }),
}));

vi.mock("#product/hooks/ui/highlighting/use-highlighted-lines", () => ({
  useHighlightedLines: (code: string) =>
    code.split("\n").map((line) => [{ content: line }]),
}));

vi.mock("#product/hooks/workspaces/workflows/files/use-file-reference-actions", () => ({
  useFileReferenceActions: () => ({
    reference: { rawPath: "package.json", locator: fileActionsState.locator },
    nativePathKind: fileActionsState.nativePathKind,
    openTargets: fileActionsState.openTargets,
    defaultOpenTarget: fileActionsState.defaultOpenTarget,
    canOpenInSidebar: true,
    canOpenExternal: fileActionsState.canOpenExternal,
    copyPath: "package.json",
    copyCurrentPath: vi.fn(),
    openInSidebar: vi.fn(),
    openDefault: openDefaultMock,
    openPrimary: vi.fn(),
    openWithTarget: openWithTargetMock,
    reveal: vi.fn(),
  }),
}));

vi.mock("#product/hooks/workspaces/derived/files/use-workspace-file-context", () => ({
  useWorkspaceFileContext: () => ({
    workspaceUiKey: "workspace-1",
    materializedWorkspaceId: "workspace-1",
    treeStateKey: "workspace-1",
  }),
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
  useWorkspaceFilesQuery: () => ({ data: { entries: [] }, isError: false, isLoading: false }),
  useSearchWorkspaceFilesQuery: () => ({ data: undefined, isLoading: false }),
  useStatWorkspaceFileQuery: () => ({
    data: undefined,
    isFetching: false,
    refetch: vi.fn(async () => ({ data: undefined })),
  }),
  useGitStatusQuery: () => ({ data: undefined, isLoading: false }),
}));

function renderEditor(filePath = "package.json") {
  const target = fileViewerTarget(filePath);
  const targetKey = viewerTargetKey(target);
  useWorkspaceViewerTabsStore.setState({ materializedWorkspaceId: "workspace-1" });
  useWorkspaceViewerTabsStore.getState().openTarget(target);
  return render(createElement(FileEditorView, { filePath, targetKey }));
}

describe("FileEditorView open-in wiring", () => {
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
    Element.prototype.scrollIntoView = vi.fn();
    readWorkspaceFileQuery.mockReturnValue({
      data: {
        content: "{}",
        isText: true,
        path: "package.json",
        sizeBytes: 2,
        tooLarge: false,
        versionToken: "v1",
      },
      error: null,
      isLoading: false,
    });
    resetFileActionsState();
    openDefaultMock.mockClear();
    openDefaultMock.mockImplementation(async () => true);
    openWithTargetMock.mockClear();
    openWithTargetMock.mockImplementation(async () => undefined);
    useWorkspaceViewerTabsStore.getState().reset();
    resetFileTreeStoreForTests();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders the compact open-in control for a resolved local-direct (desktop) capability", () => {
    fileActionsState.locator = { authority: "desktop", absolutePath: "/Users/dev/repo/package.json" };
    renderEditor();

    expect(screen.getByRole("button", { name: "Open in VS Code" })).toBeTruthy();
  });

  it("renders the compact open-in control for a resolved local-companion capability", () => {
    fileActionsState.locator = {
      authority: "workspace",
      workspacePath: "package.json",
      localCompanionPath: "/Users/dev/companion/package.json",
    };
    renderEditor();

    expect(screen.getByRole("button", { name: "Open in VS Code" })).toBeTruthy();
  });

  it("renders no control and makes zero open-in calls when 01D has no resolved native capability (remote/Web)", () => {
    fileActionsState.canOpenExternal = false;
    fileActionsState.nativePathKind = null;
    fileActionsState.openTargets = [];
    fileActionsState.defaultOpenTarget = null;
    renderEditor();

    expect(screen.queryByRole("button", { name: /^Open in /})).toBeNull();
    expect(openDefaultMock).not.toHaveBeenCalled();
    expect(openWithTargetMock).not.toHaveBeenCalled();
  });

  it("renders no control when settled but no default target has resolved yet (pending target discovery)", () => {
    fileActionsState.canOpenExternal = true;
    fileActionsState.openTargets = [];
    fileActionsState.defaultOpenTarget = null;
    renderEditor();

    expect(screen.queryByRole("button", { name: /^Open in /})).toBeNull();
  });

  it("renders no control for a directory-kind capability (this view only serves files)", () => {
    fileActionsState.nativePathKind = "directory";
    renderEditor();

    expect(screen.queryByRole("button", { name: /^Open in /})).toBeNull();
  });

  it("invokes the capability-bound openDefault with no path argument on primary click", () => {
    renderEditor();
    screen.getByRole("button", { name: "Open in VS Code" }).click();

    expect(openDefaultMock).toHaveBeenCalledTimes(1);
    expect(openDefaultMock).toHaveBeenCalledWith();
  });

  it("bumps openInRevision (remounting a closed menu) when locator identity changes", () => {
    const { rerender } = renderEditor();
    act(() => {
      screen.getByRole("button", { name: "Choose Open in VS Code" }).click();
    });
    expect(screen.getByRole("button", { name: "VS Code" })).toBeTruthy();

    // Simulate a capability re-resolution to a different absolute identity —
    // same target shape, new locator — and re-render.
    fileActionsState.locator = { authority: "desktop", absolutePath: "/Users/dev/repo/other.json" };
    rerender(createElement(FileEditorView, {
      filePath: "package.json",
      targetKey: viewerTargetKey(fileViewerTarget("package.json")),
    }));

    expect(screen.queryByRole("button", { name: "VS Code" })).toBeNull();
  });

  it("shows a retryable failure state on native open failure, then clears it on a successful retry", async () => {
    openDefaultMock.mockImplementationOnce(async () => false);
    renderEditor();

    await act(async () => {
      screen.getByRole("button", { name: "Open in VS Code" }).click();
    });
    expect(await screen.findByRole("status")).toBeTruthy();

    await act(async () => {
      screen.getByRole("button", { name: "Open in VS Code" }).click();
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(openDefaultMock).toHaveBeenCalledTimes(2);
  });

  it("treats an openWithTarget rejection as a retryable failure without throwing", async () => {
    openWithTargetMock.mockImplementationOnce(async () => {
      throw new Error("bridge unavailable at /Users/dev/repo/package.json");
    });
    renderEditor();

    act(() => {
      screen.getByRole("button", { name: "Choose Open in VS Code" }).click();
    });
    await act(async () => {
      screen.getByRole("button", { name: "VS Code" }).click();
    });

    const status = await screen.findByRole("status");
    expect(status.textContent).toBe("Could not open the file. Click to retry.");
    expect(status.textContent).not.toContain("/Users/dev/repo/package.json");
    expect(status.textContent).not.toContain("bridge unavailable");
  });
});
