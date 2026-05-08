import {
  useEffect,
  useMemo,
  useState,
} from "react";
import Editor from "@monaco-editor/react";
import { Button } from "@/components/ui/Button";
import { LoadingState } from "@/components/feedback/LoadingIllustration";
import { MarkdownRenderer } from "@/components/ui/content/MarkdownRenderer";
import {
  useGitBranchDiffFilesQuery,
  useGitStatusQuery,
  useReadWorkspaceFileQuery,
} from "@anyharness/sdk-react";
import { CenterMessage } from "@/components/workspace/files/viewer/CenterMessage";
import { FileDiffPane } from "@/components/workspace/files/viewer/FileDiffPane";
import { FileViewerFrame } from "@/components/workspace/files/viewer/FileViewerFrame";
import { useWorkspaceFileActions } from "@/hooks/workspaces/files/use-workspace-file-actions";
import { useFileEditorCommands } from "@/hooks/workspaces/files/ui/use-file-editor-commands";
import { useResolvedMode } from "@/hooks/theme/derived/use-resolved-mode";
import { canPreviewAsMarkdown } from "@/lib/domain/files/document-preview";
import { resolveReadableCodeFontScale } from "@/lib/domain/preferences/appearance";
import {
  buildDiffScopeOptions,
  diffScopeFromIncludedState,
  resolveActiveDiffOption,
  type FileDiffTarget,
} from "@/lib/domain/workspaces/viewer/file-diff-options";
import { inferWorkspaceFileLanguage } from "@/lib/domain/workspaces/viewer/file-language";
import {
  defaultFileViewerMode,
  type FileDiffViewerScope,
  type ViewerTargetKey,
} from "@/lib/domain/workspaces/viewer/viewer-target";
import {
  THEME_NAME_LIGHT,
  THEME_NAME_DARK,
} from "@/lib/infra/editor/monaco-theme";
import { useWorkspaceFileBuffersStore } from "@/stores/editor/workspace-file-buffers-store";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

interface FileEditorViewProps {
  filePath: string;
  targetKey: ViewerTargetKey;
  diffTarget?: FileDiffTarget;
}

export function FileEditorView({ filePath, targetKey, diffTarget }: FileEditorViewProps) {
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
  const {
    viewerRootRef,
    viewerContentRef,
    handleBeforeMount,
    handleEditorMount,
    handleContentPointerDownCapture,
  } = useFileEditorCommands({
    effectiveMode,
    targetKey,
    filePath,
    isDirty: buffer?.isDirty ?? false,
    onSaveFile: saveFile,
  });

  useEffect(() => {
    setSelectedDiffScope(diffTarget?.scope ?? null);
  }, [diffTarget?.scope, targetKey]);

  useEffect(() => {
    if (requiresFileRead && readQuery.data) {
      ensureBufferFromRead(filePath, readQuery.data);
    }
  }, [ensureBufferFromRead, filePath, readQuery.data, requiresFileRead]);

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
            language={inferWorkspaceFileLanguage(filePath)}
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
