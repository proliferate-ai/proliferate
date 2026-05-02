// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fileViewerTarget,
  fileDiffViewerTarget,
  viewerTargetKey,
  type ViewerTarget,
} from "@/lib/domain/workspaces/viewer-target";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";
import { FileEditorView } from "./FileEditorView";

const readWorkspaceFileQuery = vi.fn();
const gitStatusQuery = vi.fn();
const gitBranchDiffFilesQuery = vi.fn();
const gitDiffQuery = vi.fn();
const monacoEditorMocks = vi.hoisted(() => ({
  addCommand: vi.fn(),
  focus: vi.fn(),
  setSelection: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
  fullRange: {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 1,
    endColumn: 8,
  },
  monaco: {
    KeyMod: {
      CtrlCmd: 2048,
      Shift: 1024,
    },
    KeyCode: {
      KeyA: 31,
      KeyZ: 56,
    },
  },
}));

vi.mock("@monaco-editor/react", () => ({
  default: (props: {
    onMount?: (editor: unknown, monaco: unknown) => void;
  }) => {
    props.onMount?.({
      addCommand: monacoEditorMocks.addCommand,
      focus: monacoEditorMocks.focus,
      getModel: () => ({
        getFullModelRange: () => monacoEditorMocks.fullRange,
        undo: monacoEditorMocks.undo,
        redo: monacoEditorMocks.redo,
      }),
      getDomNode: () => null,
      hasTextFocus: () => true,
      setSelection: monacoEditorMocks.setSelection,
    }, monacoEditorMocks.monaco);
    return createElement("div", null, "editor");
  },
}));

vi.mock("@/components/ui/content/DiffViewer", () => ({
  DiffViewer: () => createElement("div", null, "diff rendered"),
}));

vi.mock("@/hooks/workspaces/files/use-workspace-file-actions", () => ({
  useWorkspaceFileActions: () => ({
    saveFile: vi.fn(),
    reloadFile: vi.fn(),
  }),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useReadWorkspaceFileQuery: (options: unknown) => readWorkspaceFileQuery(options),
  useGitStatusQuery: (options: unknown) => gitStatusQuery(options),
  useGitBranchDiffFilesQuery: (options: unknown) => gitBranchDiffFilesQuery(options),
  useGitDiffQuery: (options: unknown) => gitDiffQuery(options),
}));

describe("FileEditorView", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    readWorkspaceFileQuery.mockReset();
    gitStatusQuery.mockReset();
    gitBranchDiffFilesQuery.mockReset();
    gitDiffQuery.mockReset();
    monacoEditorMocks.addCommand.mockReset();
    monacoEditorMocks.focus.mockReset();
    monacoEditorMocks.setSelection.mockReset();
    monacoEditorMocks.undo.mockReset();
    monacoEditorMocks.redo.mockReset();
    readWorkspaceFileQuery.mockReturnValue({
      data: undefined,
      error: new Error("not found"),
      isLoading: false,
    });
    gitStatusQuery.mockReturnValue({
      data: {
        currentBranch: "main",
        suggestedBaseBranch: "main",
        files: [{
          path: "src/deleted.ts",
          oldPath: null,
          includedState: "excluded",
        }],
      },
    });
    gitBranchDiffFilesQuery.mockReturnValue({
      data: undefined,
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
    useWorkspaceViewerTabsStore.getState().reset();
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
    expect(gitStatusQuery).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
    });
    expect(gitBranchDiffFilesQuery).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      baseRef: "main",
      enabled: true,
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

  it("registers Monaco edit commands for select all, undo, and redo", () => {
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

    render(createElement(FileEditorView, {
      filePath: "package.json",
      targetKey,
    }));

    const selectAllBinding = monacoEditorMocks.monaco.KeyMod.CtrlCmd
      | monacoEditorMocks.monaco.KeyCode.KeyA;
    const undoBinding = monacoEditorMocks.monaco.KeyMod.CtrlCmd
      | monacoEditorMocks.monaco.KeyCode.KeyZ;
    const redoBinding = monacoEditorMocks.monaco.KeyMod.CtrlCmd
      | monacoEditorMocks.monaco.KeyMod.Shift
      | monacoEditorMocks.monaco.KeyCode.KeyZ;
    const selectAllHandler = monacoEditorMocks.addCommand.mock.calls
      .find(([binding]) => binding === selectAllBinding)?.[1];
    const undoHandler = monacoEditorMocks.addCommand.mock.calls
      .find(([binding]) => binding === undoBinding)?.[1];
    const redoHandler = monacoEditorMocks.addCommand.mock.calls
      .find(([binding]) => binding === redoBinding)?.[1];

    expect(selectAllHandler).toBeTypeOf("function");
    expect(undoHandler).toBeTypeOf("function");
    expect(redoHandler).toBeTypeOf("function");

    selectAllHandler();
    undoHandler();
    redoHandler();

    expect(monacoEditorMocks.setSelection).toHaveBeenCalledWith(monacoEditorMocks.fullRange);
    expect(monacoEditorMocks.undo).toHaveBeenCalledTimes(1);
    expect(monacoEditorMocks.redo).toHaveBeenCalledTimes(1);
  });

  it("handles app-level edit shortcuts when Monaco has editor focus", () => {
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

    render(createElement(FileEditorView, {
      filePath: "package.json",
      targetKey,
    }));

    monacoEditorMocks.setSelection.mockClear();
    monacoEditorMocks.undo.mockClear();
    monacoEditorMocks.redo.mockClear();

    fireEvent.keyDown(window, { key: "a", metaKey: true });
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    fireEvent.keyDown(window, { key: "z", metaKey: true, shiftKey: true });

    expect(monacoEditorMocks.setSelection).toHaveBeenCalledWith(monacoEditorMocks.fullRange);
    expect(monacoEditorMocks.undo).toHaveBeenCalledTimes(1);
    expect(monacoEditorMocks.redo).toHaveBeenCalledTimes(1);
  });
});
