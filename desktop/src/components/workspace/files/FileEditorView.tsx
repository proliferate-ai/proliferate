import {
  useEffect,
  useMemo,
  useState,
} from "react";
import { FileEditorContent } from "./FileEditorContent";
import { LoadingState } from "@/components/feedback/LoadingIllustration";
import {
  useGitBranchDiffFilesQuery,
  useGitStatusQuery,
  useReadWorkspaceFileQuery,
} from "@anyharness/sdk-react";
import { CenterMessage } from "@/components/workspace/files/viewer/CenterMessage";
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
import {
  defaultFileViewerMode,
  type FileDiffViewerScope,
  type ViewerTargetKey,
} from "@/lib/domain/workspaces/viewer/viewer-target";
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
      <FileEditorContent
        filePath={filePath}
        workspaceId={materializedWorkspaceId}
        effectiveMode={effectiveMode}
        read={read}
        buffer={buffer}
        activeDiffTarget={activeDiffTarget}
        diffLayout={diffLayout}
        canShowMarkdownPreview={canShowMarkdownPreview}
        resolvedMode={resolvedMode}
        monacoFontSize={readableCodeScale.monacoFontSize}
        monacoLineHeight={readableCodeScale.monacoLineHeight}
        viewerContentRef={viewerContentRef}
        onContentPointerDownCapture={handleContentPointerDownCapture}
        onUpdateBuffer={updateBuffer}
        onReloadFile={reloadFile}
        onBeforeMount={handleBeforeMount}
        onEditorMount={handleEditorMount}
      />
    </FileViewerFrame>
  );
}
