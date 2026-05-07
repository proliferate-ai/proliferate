import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
} from "react";
import Editor, { type BeforeMount, type OnMount } from "@monaco-editor/react";
import type {
  GitBranchDiffFilesResponse,
  GitChangedFile,
} from "@anyharness/sdk";
import { Button } from "@/components/ui/Button";
import { LoadingState } from "@/components/feedback/LoadingIllustration";
import { PickerPopoverContent } from "@/components/ui/PickerPopoverContent";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { DiffViewer } from "@/components/ui/content/DiffViewer";
import { MarkdownRenderer } from "@/components/ui/content/MarkdownRenderer";
import { FileTreeEntryIcon } from "@/components/ui/file-icons";
import {
  Check,
  ChevronDown,
  Copy,
  FilePen,
  FileText,
  GitBranch,
  RefreshCw,
  SplitPanel,
} from "@/components/ui/icons";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  useGitBranchDiffFilesQuery,
  useGitDiffQuery,
  useGitStatusQuery,
  useReadWorkspaceFileQuery,
} from "@anyharness/sdk-react";
import { useWorkspaceFileActions } from "@/hooks/workspaces/files/use-workspace-file-actions";
import { useResolvedMode } from "@/hooks/theme/use-theme";
import { canPreviewAsMarkdown } from "@/lib/domain/files/document-preview";
import { resolveReadableCodeFontScale } from "@/lib/domain/preferences/appearance";
import {
  REDO_COMMAND_EVENT,
  SELECT_ALL_COMMAND_EVENT,
  UNDO_COMMAND_EVENT,
  selectElementContents,
} from "@/lib/infra/dom/dom-select-all";
import { runShortcutHandler } from "@/lib/domain/shortcuts/registry";
import {
  defaultFileViewerMode,
  fileDiffViewerTarget,
  type FileDiffViewerScope,
  type FileViewerMode,
  type ViewerTarget,
  type ViewerTargetKey,
} from "@/lib/domain/workspaces/viewer-target";
import {
  proliferateDarkTheme,
  proliferateLightTheme,
  THEME_NAME_DARK,
  THEME_NAME_LIGHT,
} from "@/lib/infra/editor/monaco-theme";
import { useWorkspaceFileBuffersStore } from "@/stores/editor/workspace-file-buffers-store";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

function inferLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescriptreact",
    js: "javascript", jsx: "javascriptreact",
    rs: "rust", py: "python", go: "go",
    json: "json", toml: "toml", yaml: "yaml", yml: "yaml",
    md: "markdown", mdx: "markdown",
    css: "css", scss: "scss", html: "html",
    sql: "sql", sh: "shell", bash: "shell",
    xml: "xml", svg: "xml",
  };
  return map[ext] ?? "plaintext";
}

interface FileEditorViewProps {
  filePath: string;
  targetKey: ViewerTargetKey;
  diffTarget?: FileDiffTarget;
}

type FileDiffTarget = Extract<ViewerTarget, { kind: "fileDiff" }>;
type MonacoStandaloneEditor = Parameters<OnMount>[0];
type MonacoApi = Parameters<OnMount>[1];
type EditorEditCommand = "selectAll" | "undo" | "redo";
type DiffScopeOption = {
  scope: FileDiffViewerScope;
  label: string;
  description: string;
  target: FileDiffTarget;
};

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

export function FileEditorView({ filePath, targetKey, diffTarget }: FileEditorViewProps) {
  const viewerRootRef = useRef<HTMLDivElement | null>(null);
  const viewerContentRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MonacoStandaloneEditor | null>(null);
  const buffer = useWorkspaceFileBuffersStore((s) => s.buffersByPath[filePath]);
  const ensureBufferFromRead = useWorkspaceFileBuffersStore((s) => s.ensureBufferFromRead);
  const updateBuffer = useWorkspaceFileBuffersStore((s) => s.updateBuffer);
  const materializedWorkspaceId = useWorkspaceViewerTabsStore((s) => s.materializedWorkspaceId);
  const mode = useWorkspaceViewerTabsStore(
    (s) => s.modeByTargetKey[targetKey] ?? defaultFileViewerMode(filePath),
  );
  const setTargetMode = useWorkspaceViewerTabsStore((s) => s.setTargetMode);
  const diffLayout = useWorkspaceViewerTabsStore((s) => s.layoutByTargetKey[targetKey] ?? "unified");
  const setTargetLayout = useWorkspaceViewerTabsStore((s) => s.setTargetLayout);
  const { saveFile, reloadFile } = useWorkspaceFileActions();
  const statusQuery = useGitStatusQuery({
    workspaceId: materializedWorkspaceId,
  });
  const branchBaseRef = diffTarget?.scope === "branch" && diffTarget.baseRef
    ? diffTarget.baseRef
    : statusQuery.data?.suggestedBaseBranch ?? null;
  const branchFilesQuery = useGitBranchDiffFilesQuery({
    workspaceId: materializedWorkspaceId,
    baseRef: branchBaseRef,
    enabled: Boolean(statusQuery.data?.currentBranch),
  });
  const [selectedDiffScope, setSelectedDiffScope] = useState<FileDiffViewerScope | null>(
    () => diffTarget?.scope ?? null,
  );

  const resolvedMode = useResolvedMode();
  const readableCodeFontSizeId = useUserPreferencesStore((s) => s.readableCodeFontSizeId);
  const readableCodeScale = resolveReadableCodeFontScale(readableCodeFontSizeId);
  const statusFile = statusQuery.data?.files.find((file) => file.path === filePath) ?? null;
  const autoDiffScope = statusFile ? diffScopeFromIncludedState(statusFile.includedState) : null;
  const diffScopeOptions = useMemo(() => buildDiffScopeOptions({
    filePath,
    statusFile,
    branchDiff: branchFilesQuery.data,
    explicitTarget: diffTarget,
  }), [branchFilesQuery.data, diffTarget, filePath, statusFile]);
  const activeDiffOption = resolveActiveDiffOption(
    diffScopeOptions,
    selectedDiffScope,
    diffTarget?.scope ?? autoDiffScope,
  );
  const activeDiffTarget = activeDiffOption?.target ?? null;
  const effectiveMode = mode === "diff" && !activeDiffTarget
    ? defaultFileViewerMode(filePath)
    : mode;
  const canShowMarkdownPreview = canPreviewAsMarkdown(filePath);
  const requiresFileRead = effectiveMode !== "diff";
  const readQuery = useReadWorkspaceFileQuery({
    workspaceId: materializedWorkspaceId,
    path: filePath,
    enabled: requiresFileRead,
  });

  useEffect(() => {
    setSelectedDiffScope(diffTarget?.scope ?? null);
  }, [diffTarget?.scope, targetKey]);

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
    if (requiresFileRead && readQuery.data) {
      ensureBufferFromRead(filePath, readQuery.data);
    }
  }, [ensureBufferFromRead, filePath, readQuery.data, requiresFileRead]);

  useEffect(() => {
    if (effectiveMode !== "edit") {
      viewerRootRef.current?.focus({ preventScroll: true });
    }
  }, [effectiveMode, targetKey]);

  const handleSaveShortcut = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (buffer?.isDirty && effectiveMode === "edit") {
          void saveFile(filePath);
        }
      }
    },
    [buffer?.isDirty, effectiveMode, filePath, saveFile],
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

  const read = readQuery.data;

  if (requiresFileRead && readQuery.error) {
    return (
      <FileViewerFrame
        rootRef={viewerRootRef}
        filePath={filePath}
        mode={effectiveMode}
        canRenderMarkdown={canShowMarkdownPreview}
        canRenderDiff={Boolean(activeDiffTarget)}
        diffScopeOptions={diffScopeOptions}
        activeDiffScope={activeDiffOption?.scope ?? null}
        diffLayout={diffLayout}
        dirty={false}
        saveState="error"
        onModeChange={(nextMode) => setTargetMode(targetKey, nextMode)}
        onDiffScopeChange={setSelectedDiffScope}
        onToggleDiffLayout={() =>
          setTargetLayout(targetKey, diffLayout === "split" ? "unified" : "split")}
        onCopyPath={() => void navigator.clipboard.writeText(filePath)}
        onReload={() => void reloadFile(filePath)}
        onSave={() => void saveFile(filePath)}
      >
        <CenterMessage message={`Error: ${readQuery.error instanceof Error ? readQuery.error.message : "Failed to load file"}`} />
      </FileViewerFrame>
    );
  }

  if (requiresFileRead && (readQuery.isLoading || !read)) {
    return (
      <FileViewerFrame
        rootRef={viewerRootRef}
        filePath={filePath}
        mode={effectiveMode}
        canRenderMarkdown={canShowMarkdownPreview}
        canRenderDiff={Boolean(activeDiffTarget)}
        diffScopeOptions={diffScopeOptions}
        activeDiffScope={activeDiffOption?.scope ?? null}
        diffLayout={diffLayout}
        dirty={false}
        saveState="idle"
        onModeChange={(nextMode) => setTargetMode(targetKey, nextMode)}
        onDiffScopeChange={setSelectedDiffScope}
        onToggleDiffLayout={() =>
          setTargetLayout(targetKey, diffLayout === "split" ? "unified" : "split")}
        onCopyPath={() => void navigator.clipboard.writeText(filePath)}
        onReload={() => void reloadFile(filePath)}
        onSave={() => void saveFile(filePath)}
      >
        <div className="flex items-center justify-center h-full">
          <LoadingState message="Loading file" subtext={filePath.split("/").pop()} />
        </div>
      </FileViewerFrame>
    );
  }

  return (
    <FileViewerFrame
      rootRef={viewerRootRef}
      filePath={filePath}
      mode={effectiveMode}
      canRenderMarkdown={canShowMarkdownPreview}
      canRenderDiff={Boolean(activeDiffTarget)}
      diffScopeOptions={diffScopeOptions}
      activeDiffScope={activeDiffOption?.scope ?? null}
      diffLayout={diffLayout}
      dirty={buffer?.isDirty ?? false}
      saveState={buffer?.saveState ?? "idle"}
      onModeChange={(nextMode) => setTargetMode(targetKey, nextMode)}
      onDiffScopeChange={setSelectedDiffScope}
      onToggleDiffLayout={() =>
        setTargetLayout(targetKey, diffLayout === "split" ? "unified" : "split")}
      onCopyPath={() => void navigator.clipboard.writeText(filePath)}
      onReload={() => void reloadFile(filePath)}
      onSave={() => void saveFile(filePath)}
    >
      <div
        ref={viewerContentRef}
        onPointerDownCapture={handleContentPointerDownCapture}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {effectiveMode === "diff" && activeDiffTarget ? (
          <FileDiffPane
            workspaceId={materializedWorkspaceId}
            target={activeDiffTarget}
            layout={diffLayout}
          />
        ) : !read ? (
          <div className="flex items-center justify-center h-full">
            <LoadingState message="Loading file" subtext={filePath.split("/").pop()} />
          </div>
        ) : read.tooLarge ? (
          <CenterMessage message={`${filePath} is too large to edit`} />
        ) : !read.isText ? (
          <CenterMessage message={`${filePath} is a binary file and cannot be edited`} />
        ) : effectiveMode === "rendered" && canShowMarkdownPreview ? (
          <div className="h-full overflow-auto px-8 py-6">
            <MarkdownRenderer content={buffer?.localContent ?? read.content ?? ""} />
          </div>
        ) : (
          <Editor
            height="100%"
            language={inferLanguage(filePath)}
            value={buffer?.localContent ?? read.content ?? ""}
            onChange={(value) => {
              if (value !== undefined) {
                updateBuffer(filePath, value);
              }
            }}
            beforeMount={handleBeforeMount}
            onMount={handleEditorMount}
            theme={resolvedMode === "dark" ? THEME_NAME_DARK : THEME_NAME_LIGHT}
            options={{
              minimap: { enabled: false },
              fontSize: readableCodeScale.monacoFontSize,
              lineHeight: readableCodeScale.monacoLineHeight,
              fontFamily: "'Geist Mono', monospace",
              fontLigatures: false,
              padding: { top: 0 },
              scrollBeyondLastLine: false,
              wordWrap: "on",
              automaticLayout: true,
              tabSize: 2,
              renderLineHighlight: "line",
              lineNumbersMinChars: 7,
              glyphMargin: false,
              folding: true,
              foldingHighlight: false,
              overviewRulerLanes: 0,
              hideCursorInOverviewRuler: true,
              scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6, useShadows: false },
              renderWhitespace: "none",
            }}
          />
        )}
      </div>

      {buffer?.saveState === "conflict" && (
        <div className="flex items-center justify-between px-3 py-2 bg-destructive/10 border-t border-destructive/20 shrink-0">
          <span className="text-xs text-destructive">
            File changed on disk. Your local changes are preserved.
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => reloadFile(filePath)}
            className="ml-2 h-auto shrink-0 bg-transparent p-0 text-xs text-destructive hover:bg-transparent hover:underline"
          >
            Reload from disk
          </Button>
        </div>
      )}
    </FileViewerFrame>
  );
}

function FileViewerFrame({
  rootRef,
  filePath,
  mode,
  canRenderMarkdown: markdown,
  canRenderDiff,
  diffScopeOptions,
  activeDiffScope,
  diffLayout,
  dirty,
  saveState,
  onModeChange,
  onDiffScopeChange,
  onToggleDiffLayout,
  onCopyPath,
  onReload,
  onSave,
  children,
}: {
  rootRef?: Ref<HTMLDivElement>;
  filePath: string;
  mode: FileViewerMode;
  canRenderMarkdown: boolean;
  canRenderDiff: boolean;
  diffScopeOptions: readonly DiffScopeOption[];
  activeDiffScope: FileDiffViewerScope | null;
  diffLayout: "unified" | "split";
  dirty: boolean;
  saveState: string;
  onModeChange: (mode: FileViewerMode) => void;
  onDiffScopeChange: (scope: FileDiffViewerScope) => void;
  onToggleDiffLayout: () => void;
  onCopyPath: () => void;
  onReload: () => void;
  onSave: () => void;
  children: ReactNode;
}) {
  const basename = filePath.split("/").pop() ?? filePath;
  const parentPath = filePath.split("/").slice(0, -1).join("/");
  return (
    <div ref={rootRef} tabIndex={-1} className="flex h-full min-w-0 flex-col overflow-hidden outline-none">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
        <FileTreeEntryIcon name={basename} path={filePath} kind="file" className="size-4 shrink-0" />
        <div className="min-w-0 flex-1" title={filePath}>
          <div className="truncate text-sm font-medium leading-4 text-foreground [direction:ltr] [unicode-bidi:plaintext]">
            {basename}
          </div>
          {parentPath && (
            <div className="truncate text-[10px] leading-3 text-muted-foreground [direction:ltr] [unicode-bidi:plaintext]">
              {parentPath}
            </div>
          )}
        </div>
        {dirty && <span className="size-1.5 shrink-0 rounded-full bg-foreground/50" />}
        {(markdown || canRenderDiff) && (
          <div className="flex shrink-0 items-center gap-1 border-l border-border pl-2">
            {canRenderDiff && (
              <FileViewerModeButton
                active={mode === "diff"}
                label="Diff"
                onClick={() => onModeChange("diff")}
              >
                <GitBranch className="size-3.5" />
              </FileViewerModeButton>
            )}
            {markdown && (
              <FileViewerModeButton
                active={mode === "rendered"}
                label="Preview"
                onClick={() => onModeChange("rendered")}
              >
                <FileText className="size-3.5" />
              </FileViewerModeButton>
            )}
            <FileViewerModeButton
              active={mode === "edit"}
              label="Edit"
              onClick={() => onModeChange("edit")}
            >
              <FilePen className="size-3.5" />
            </FileViewerModeButton>
          </div>
        )}
        {canRenderDiff && mode === "diff" && diffScopeOptions.length > 1 && activeDiffScope && (
          <DiffScopePicker
            options={diffScopeOptions}
            activeScope={activeDiffScope}
            onScopeChange={onDiffScopeChange}
          />
        )}
        {canRenderDiff && mode === "diff" && (
          <Tooltip content={diffLayout === "split" ? "Unified diff" : "Split diff"}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onToggleDiffLayout}
              aria-label="Toggle diff layout"
              className="size-7"
            >
              <SplitPanel className="size-3.5" />
            </Button>
          </Tooltip>
        )}
        <Tooltip content="Copy path">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onCopyPath}
            aria-label="Copy file path"
            className="size-7"
          >
            <Copy className="size-3.5" />
          </Button>
        </Tooltip>
        <Tooltip content="Reload">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onReload}
            aria-label="Reload file"
            className="size-7"
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </Tooltip>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onSave}
          disabled={mode !== "edit" || !dirty || saveState === "saving"}
          loading={saveState === "saving"}
          className="h-7 px-2 text-xs"
        >
          Save
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}

function FileViewerModeButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-pressed={active}
      onClick={onClick}
      className={`h-7 gap-1.5 rounded-md px-2 text-xs ${active
        ? "bg-accent text-foreground"
        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}
    >
      {children}
      <span>{label}</span>
    </Button>
  );
}

function DiffScopePicker({
  options,
  activeScope,
  onScopeChange,
}: {
  options: readonly DiffScopeOption[];
  activeScope: FileDiffViewerScope;
  onScopeChange: (scope: FileDiffViewerScope) => void;
}) {
  const activeOption = options.find((option) => option.scope === activeScope) ?? options[0];

  return (
    <PopoverButton
      trigger={(
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
          aria-label="Diff scope"
        >
          {activeOption.label}
          <ChevronDown className="size-3" />
        </Button>
      )}
      align="end"
      className="w-48 rounded-xl border border-border bg-popover p-1 shadow-floating"
    >
      {(close) => (
        <PickerPopoverContent className="max-h-72">
          {options.map((option) => (
            <PopoverMenuItem
              key={option.scope}
              label={option.label}
              icon={<GitBranch className="size-3.5 text-muted-foreground" />}
              trailing={option.scope === activeScope
                ? <Check className="size-3.5 text-foreground/70" />
                : null}
              onClick={() => {
                onScopeChange(option.scope);
                close();
              }}
            >
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {option.description}
              </span>
            </PopoverMenuItem>
          ))}
        </PickerPopoverContent>
      )}
    </PopoverButton>
  );
}

function FileDiffPane({
  workspaceId,
  target,
  layout,
}: {
  workspaceId: string | null;
  target: FileDiffTarget;
  layout: "unified" | "split";
}) {
  const diffQuery = useGitDiffQuery({
    workspaceId,
    path: target.path,
    scope: target.scope,
    baseRef: target.scope === "branch" ? target.baseRef : null,
    oldPath: target.scope === "branch" ? target.oldPath : null,
  });

  if (diffQuery.isLoading) {
    return (
      <p className="px-4 py-8 text-center text-sm text-muted-foreground">Loading diff</p>
    );
  }

  if (diffQuery.data?.patch) {
    return (
      <div className="min-h-0 flex-1 overflow-auto">
        <DiffViewer patch={diffQuery.data.patch} layout={layout} />
      </div>
    );
  }

  if (diffQuery.data?.binary) {
    return (
      <CenterMessage message="Binary file changed" />
    );
  }

  return (
    <CenterMessage message="No diff available" />
  );
}

function diffScopeFromIncludedState(
  includedState: "included" | "excluded" | "partial",
): FileDiffViewerScope {
  return includedState === "included" ? "staged" : "unstaged";
}

function buildDiffScopeOptions({
  filePath,
  statusFile,
  branchDiff,
  explicitTarget,
}: {
  filePath: string;
  statusFile: GitChangedFile | null;
  branchDiff: GitBranchDiffFilesResponse | undefined;
  explicitTarget?: FileDiffTarget;
}): DiffScopeOption[] {
  const byScope = new Map<FileDiffViewerScope, DiffScopeOption>();

  if (statusFile) {
    for (const scope of diffScopesForStatusFile(statusFile)) {
      byScope.set(scope, {
        scope,
        label: diffScopeLabel(scope),
        description: diffScopeDescription(scope, null),
        target: fileDiffViewerTarget({
          path: statusFile.path,
          oldPath: statusFile.oldPath ?? null,
          scope,
        }) as FileDiffTarget,
      });
    }
  }

  const branchFile = branchDiff?.files.find((file) =>
    file.path === filePath || file.oldPath === filePath
  );
  if (branchDiff && branchFile) {
    const scope = "branch" as const;
    byScope.set(scope, {
      scope,
      label: diffScopeLabel(scope),
      description: diffScopeDescription(scope, branchDiff.baseRef),
      target: fileDiffViewerTarget({
        path: branchFile.path,
        oldPath: branchFile.oldPath ?? null,
        scope,
        baseRef: branchDiff.baseRef,
        baseOid: branchDiff.mergeBaseOid,
        headOid: branchDiff.headOid,
      }) as FileDiffTarget,
    });
  }

  if (explicitTarget && !byScope.has(explicitTarget.scope)) {
    byScope.set(explicitTarget.scope, {
      scope: explicitTarget.scope,
      label: diffScopeLabel(explicitTarget.scope),
      description: diffScopeDescription(explicitTarget.scope, explicitTarget.baseRef),
      target: explicitTarget,
    });
  }

  return (["unstaged", "staged", "branch"] as const)
    .flatMap((scope) => byScope.get(scope) ? [byScope.get(scope)!] : []);
}

function resolveActiveDiffOption(
  options: readonly DiffScopeOption[],
  selectedScope: FileDiffViewerScope | null,
  preferredScope: FileDiffViewerScope | null,
): DiffScopeOption | null {
  return (
    options.find((option) => option.scope === selectedScope)
    ?? options.find((option) => option.scope === preferredScope)
    ?? options[0]
    ?? null
  );
}

function diffScopesForStatusFile(file: GitChangedFile): FileDiffViewerScope[] {
  if (file.includedState === "partial") {
    return ["unstaged", "staged"];
  }
  return file.includedState === "included" ? ["staged"] : ["unstaged"];
}

function diffScopeLabel(scope: FileDiffViewerScope): string {
  if (scope === "staged") {
    return "Staged";
  }
  if (scope === "branch") {
    return "Branch";
  }
  return "Unstaged";
}

function diffScopeDescription(scope: FileDiffViewerScope, baseRef: string | null): string {
  if (scope === "staged") {
    return "Index changes";
  }
  if (scope === "branch") {
    return baseRef ? `Compared with ${baseRef}` : "Branch changes";
  }
  return "Working tree changes";
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

function CenterMessage({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-full">
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}
