import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { BeforeMount, OnMount } from "@monaco-editor/react";
import {
  REDO_COMMAND_EVENT,
  SELECT_ALL_COMMAND_EVENT,
  UNDO_COMMAND_EVENT,
  selectElementContents,
} from "@/lib/infra/dom/dom-select-all";
import {
  proliferateDarkTheme,
  proliferateLightTheme,
  THEME_NAME_DARK,
  THEME_NAME_LIGHT,
} from "@/lib/infra/editor/monaco-theme";
import { runShortcutHandler } from "@/lib/domain/shortcuts/registry";
import type {
  FileViewerMode,
  ViewerTargetKey,
} from "@/lib/domain/workspaces/viewer/viewer-target";

type MonacoStandaloneEditor = Parameters<OnMount>[0];
type MonacoApi = Parameters<OnMount>[1];
type EditorEditCommand = "selectAll" | "undo" | "redo";

interface UseFileEditorCommandsInput {
  effectiveMode: FileViewerMode;
  targetKey: ViewerTargetKey;
  filePath: string;
  isDirty: boolean;
  onSaveFile: (filePath: string) => void | Promise<void>;
}

export function useFileEditorCommands({
  effectiveMode,
  targetKey,
  filePath,
  isDirty,
  onSaveFile,
}: UseFileEditorCommandsInput) {
  const viewerRootRef = useRef<HTMLDivElement | null>(null);
  const viewerContentRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MonacoStandaloneEditor | null>(null);

  const handleBeforeMount: BeforeMount = useCallback((monaco) => {
    monaco.editor.defineTheme(THEME_NAME_DARK, proliferateDarkTheme);
    monaco.editor.defineTheme(THEME_NAME_LIGHT, proliferateLightTheme);
  }, []);

  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    registerEditorEditKeybindings(editor, monaco);
    editor.focus();
  }, []);

  const handleContentPointerDownCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (effectiveMode === "edit" || isInteractiveElement(event.target)) {
      return;
    }

    viewerRootRef.current?.focus({ preventScroll: true });
  }, [effectiveMode]);

  useEffect(() => {
    if (effectiveMode !== "edit") {
      viewerRootRef.current?.focus({ preventScroll: true });
    }
  }, [effectiveMode, targetKey]);

  const handleSaveShortcut = useCallback(
    (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (isDirty && effectiveMode === "edit") {
          void onSaveFile(filePath);
        }
      }
    },
    [effectiveMode, filePath, isDirty, onSaveFile],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleSaveShortcut);
    return () => window.removeEventListener("keydown", handleSaveShortcut);
  }, [handleSaveShortcut]);

  const handleEditorEditShortcut = useCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented) {
      return;
    }
    const command = editCommandFromKeyboardEvent(event);
    if (!command || effectiveMode !== "edit") {
      return;
    }

    const editor = editorRef.current;
    const shouldHandle = editor
      ? shouldHandleEditorCommand(viewerRootRef.current, editor)
      : false;
    if (!editor || !shouldHandle) {
      return;
    }

    if (runEditorEditCommand(editor, command)) {
      consumeEditorShortcutEvent(event);
    }
  }, [effectiveMode]);

  useEffect(() => {
    window.addEventListener("keydown", handleEditorEditShortcut, true);
    return () => window.removeEventListener("keydown", handleEditorEditShortcut, true);
  }, [handleEditorEditShortcut]);

  const handleSelectAllCommand = useCallback((event: Event) => {
    if (effectiveMode === "edit") {
      const editor = editorRef.current;
      const shouldHandle = editor
        ? shouldHandleEditorCommand(viewerRootRef.current, editor)
        : false;
      if (!editor || !shouldHandle) {
        return;
      }

      if (runEditorEditCommand(editor, "selectAll")) {
        event.preventDefault();
      }
      return;
    }

    if (!shouldHandleViewerCommand(viewerRootRef.current)) {
      return;
    }

    const content = viewerContentRef.current;
    if (content && selectElementContents(content)) {
      event.preventDefault();
    }
  }, [effectiveMode]);

  const handleUndoCommand = useCallback((event: Event) => {
    if (effectiveMode !== "edit") {
      return;
    }

    const editor = editorRef.current;
    const shouldHandle = editor
      ? shouldHandleEditorCommand(viewerRootRef.current, editor)
      : false;
    if (!editor || !shouldHandle) {
      return;
    }

    if (runEditorEditCommand(editor, "undo")) {
      event.preventDefault();
    }
  }, [effectiveMode]);

  const handleRedoCommand = useCallback((event: Event) => {
    if (effectiveMode !== "edit") {
      return;
    }

    const editor = editorRef.current;
    const shouldHandle = editor
      ? shouldHandleEditorCommand(viewerRootRef.current, editor)
      : false;
    if (!editor || !shouldHandle) {
      return;
    }

    if (runEditorEditCommand(editor, "redo")) {
      event.preventDefault();
    }
  }, [effectiveMode]);

  useEffect(() => {
    window.addEventListener(SELECT_ALL_COMMAND_EVENT, handleSelectAllCommand);
    return () => window.removeEventListener(SELECT_ALL_COMMAND_EVENT, handleSelectAllCommand);
  }, [handleSelectAllCommand]);

  useEffect(() => {
    window.addEventListener(UNDO_COMMAND_EVENT, handleUndoCommand);
    window.addEventListener(REDO_COMMAND_EVENT, handleRedoCommand);
    return () => {
      window.removeEventListener(UNDO_COMMAND_EVENT, handleUndoCommand);
      window.removeEventListener(REDO_COMMAND_EVENT, handleRedoCommand);
    };
  }, [handleRedoCommand, handleUndoCommand]);

  return {
    viewerRootRef,
    viewerContentRef,
    handleBeforeMount,
    handleEditorMount,
    handleContentPointerDownCapture,
  };
}

function selectEditorContents(editor: MonacoStandaloneEditor): boolean {
  const model = editor.getModel();
  if (!model) {
    return false;
  }

  editor.focus();
  editor.setSelection(model.getFullModelRange());
  return true;
}

function undoEditorChange(editor: MonacoStandaloneEditor): boolean {
  const model = editor.getModel();
  if (!model) {
    return false;
  }

  editor.focus();
  void model.undo();
  return true;
}

function redoEditorChange(editor: MonacoStandaloneEditor): boolean {
  const model = editor.getModel();
  if (!model) {
    return false;
  }

  editor.focus();
  void model.redo();
  return true;
}

function registerEditorEditKeybindings(
  editor: MonacoStandaloneEditor,
  monaco: MonacoApi,
): void {
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyA, () => {
    runEditorEditCommand(editor, "selectAll");
  });
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ, () => {
    runEditorEditCommand(editor, "undo");
  });
  editor.addCommand(
    monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ,
    () => {
      runEditorEditCommand(editor, "redo");
    },
  );
  editor.addCommand(
    monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.LeftArrow,
    () => {
      runShortcutHandler("workspace.previous-tab", { source: "keyboard" });
    },
  );
  editor.addCommand(
    monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.RightArrow,
    () => {
      runShortcutHandler("workspace.next-tab", { source: "keyboard" });
    },
  );
}

function runEditorEditCommand(
  editor: MonacoStandaloneEditor,
  command: EditorEditCommand,
): boolean {
  if (command === "selectAll") {
    return selectEditorContents(editor);
  }
  if (command === "undo") {
    return undoEditorChange(editor);
  }
  return redoEditorChange(editor);
}

function editCommandFromKeyboardEvent(event: KeyboardEvent): EditorEditCommand | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) {
    return null;
  }

  const key = event.key.toLowerCase();
  if (key === "a" && !event.shiftKey) {
    return "selectAll";
  }
  if (key === "z") {
    return event.shiftKey ? "redo" : "undo";
  }
  return null;
}

function consumeEditorShortcutEvent(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function isInteractiveElement(target: EventTarget): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(target.closest(
    "a,button,input,select,textarea,[contenteditable='true'],[role='button']",
  ));
}

function shouldHandleViewerCommand(root: HTMLElement | null): boolean {
  if (!root || !root.isConnected) {
    return false;
  }

  const activeElement = document.activeElement;
  if (!activeElement || activeElement === document.body) {
    return true;
  }

  return activeElement instanceof Node && root.contains(activeElement);
}

function shouldHandleEditorCommand(
  root: HTMLElement | null,
  editor: MonacoStandaloneEditor,
): boolean {
  if (!root || !root.isConnected) {
    return false;
  }

  if (safeEditorHasTextFocus(editor)) {
    return true;
  }

  const activeElement = document.activeElement;
  const editorNode = editor.getDomNode();
  if (activeElement instanceof Node && editorNode?.contains(activeElement)) {
    return true;
  }

  if (!activeElement || activeElement === document.body) {
    return true;
  }

  return activeElement instanceof Node && root.contains(activeElement);
}

function safeEditorHasTextFocus(editor: MonacoStandaloneEditor): boolean {
  try {
    return editor.hasTextFocus();
  } catch {
    return false;
  }
}
