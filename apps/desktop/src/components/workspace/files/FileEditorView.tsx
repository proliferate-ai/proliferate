import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { FileViewerContent } from "./FileViewerContent";
import { LoadingState } from "@/components/feedback/LoadingIllustration";
import { useReadWorkspaceFileQuery } from "@anyharness/sdk-react";
import { CenterMessage } from "@/components/workspace/files/viewer/CenterMessage";
import { FileViewerFrame } from "@/components/workspace/files/viewer/FileViewerFrame";
import { WorkspaceFileBrowserOverlay } from "@/components/workspace/files/viewer/WorkspaceFileBrowserOverlay";
import { useFileReferenceActions } from "@/hooks/workspaces/files/use-file-reference-actions";
import { useWorkspaceFileContext } from "@/hooks/workspaces/files/derived/use-workspace-file-context";
import { useWorkspaceFileTargetActions } from "@/hooks/workspaces/files/workflows/use-workspace-file-target-actions";
import { canPreviewAsRichFile } from "@/lib/domain/files/document-preview";
import type { FileDiffTarget } from "@/lib/domain/workspaces/viewer/file-diff-options";
import {
  defaultFileViewerMode,
  normalizeFileViewerMode,
  type ViewerTargetKey,
} from "@/lib/domain/workspaces/viewer/viewer-target";
import { useContentSearchStore } from "@/stores/search/content-search-store";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";

interface FileEditorViewProps {
  filePath: string;
  targetKey: ViewerTargetKey;
  diffTarget?: FileDiffTarget;
}

export function FileEditorView({ filePath, targetKey, diffTarget }: FileEditorViewProps) {
  const fileContext = useWorkspaceFileContext();
  const materializedWorkspaceId = fileContext.materializedWorkspaceId;
  const rawMode = useWorkspaceViewerTabsStore(
    (s) => s.modeByTargetKey[targetKey] ?? defaultFileViewerMode(filePath),
  );
  const setTargetMode = useWorkspaceViewerTabsStore((s) => s.setTargetMode);
  const diffLayout = useWorkspaceViewerTabsStore((s) => s.layoutByTargetKey[targetKey] ?? "unified");
  const openContentSearch = useContentSearchStore((s) => s.openSearch);
  const { openFile } = useWorkspaceFileTargetActions(fileContext);
  const fileActions = useFileReferenceActions({
    rawPath: filePath,
    workspacePath: filePath,
  });
  const [wordWrap, setWordWrap] = useState(false);
  const parentPath = useMemo(() => parentDirectoryPath(filePath), [filePath]);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browserPath, setBrowserPath] = useState(parentPath);
  const activeDiffTarget = diffTarget ?? null;
  const effectiveMode = activeDiffTarget
    ? "diff"
    : rawMode === "diff"
      ? defaultFileViewerMode(filePath)
      : rawMode;
  const normalizedEffectiveMode = normalizeFileViewerMode(effectiveMode);
  const canShowRichPreview = canPreviewAsRichFile(filePath);
  const requiresFileRead = !activeDiffTarget;
  const readQuery = useReadWorkspaceFileQuery({
    workspaceId: materializedWorkspaceId,
    path: filePath,
    enabled: requiresFileRead,
  });

  useEffect(() => {
    if (!browserOpen) {
      setBrowserPath(parentPath);
    }
  }, [browserOpen, parentPath]);

  const read = readQuery.data;
  const copyContent = () => {
    void navigator.clipboard.writeText(read?.content ?? "");
  };
  const copyPath = () => {
    void fileActions.copyPath();
  };
  const openExternal = () => {
    void fileActions.openDefault();
  };
  const openFindInDiffs = () => {
    if (activeDiffTarget || !read?.isText || read.tooLarge) {
      return;
    }

    if (normalizedEffectiveMode === "rendered") {
      setTargetMode(targetKey, "source");
    }

    openContentSearch("diffs", "file");
  };
  const toggleRichPreview = () => {
    setTargetMode(
      targetKey,
      normalizedEffectiveMode === "rendered" ? "source" : "rendered",
    );
  };
  const browsePath = (path: string) => {
    setBrowserPath(path);
    setBrowserOpen(true);
  };
  const toggleBrowser = () => {
    setBrowserOpen((open) => {
      if (!open) {
        setBrowserPath(parentPath);
      }
      return !open;
    });
  };
  const closeBrowser = () => {
    setBrowserOpen(false);
  };
  const openBrowserFile = (path: string) => {
    setBrowserOpen(false);
    void openFile(path);
  };
  const canFindInFile = !activeDiffTarget && Boolean(read?.isText && !read.tooLarge);
  const renderPaneContent = (content: ReactNode) => (
    <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {content}
      </div>
      <WorkspaceFileBrowserOverlay
        open={browserOpen}
        workspaceId={materializedWorkspaceId}
        selectedPath={filePath}
        pathPrefix={browserPath}
        onPathPrefixChange={setBrowserPath}
        onOpenFile={openBrowserFile}
        onClose={closeBrowser}
      />
    </div>
  );

  if (requiresFileRead && readQuery.error) {
    return (
      <FileViewerFrame
        filePath={filePath}
        canRenderRichPreview={canShowRichPreview}
        wordWrap={wordWrap}
        richPreviewEnabled={normalizedEffectiveMode === "rendered"}
        canCopyContent={false}
        canFindInFile={false}
        onToggleWordWrap={() => setWordWrap((value) => !value)}
        onToggleRichPreview={toggleRichPreview}
        onCopyContent={copyContent}
        onCopyPath={copyPath}
        onOpenExternal={openExternal}
        onOpenContentSearch={openFindInDiffs}
        browserOpen={browserOpen}
        onToggleBrowser={toggleBrowser}
        onBrowsePath={browsePath}
      >
        {renderPaneContent(
          <CenterMessage message={`Error: ${readQuery.error instanceof Error ? readQuery.error.message : "Failed to load file"}`} />,
        )}
      </FileViewerFrame>
    );
  }

  if (requiresFileRead && (readQuery.isLoading || !read)) {
    return (
      <FileViewerFrame
        filePath={filePath}
        canRenderRichPreview={canShowRichPreview}
        wordWrap={wordWrap}
        richPreviewEnabled={normalizedEffectiveMode === "rendered"}
        canCopyContent={false}
        canFindInFile={false}
        onToggleWordWrap={() => setWordWrap((value) => !value)}
        onToggleRichPreview={toggleRichPreview}
        onCopyContent={copyContent}
        onCopyPath={copyPath}
        onOpenExternal={openExternal}
        onOpenContentSearch={openFindInDiffs}
        browserOpen={browserOpen}
        onToggleBrowser={toggleBrowser}
        onBrowsePath={browsePath}
      >
        {renderPaneContent(
          <div className="flex h-full items-center justify-center">
            <LoadingState message="Loading file" subtext={filePath.split("/").pop()} />
          </div>,
        )}
      </FileViewerFrame>
    );
  }

  return (
    <FileViewerFrame
      filePath={filePath}
      canRenderRichPreview={canShowRichPreview}
      wordWrap={wordWrap}
      richPreviewEnabled={normalizedEffectiveMode === "rendered"}
      canCopyContent={Boolean(read?.isText && !read.tooLarge)}
      canFindInFile={canFindInFile}
      onToggleWordWrap={() => setWordWrap((value) => !value)}
      onToggleRichPreview={toggleRichPreview}
      onCopyContent={copyContent}
      onCopyPath={copyPath}
      onOpenExternal={openExternal}
      onOpenContentSearch={openFindInDiffs}
      browserOpen={browserOpen}
      onToggleBrowser={toggleBrowser}
      onBrowsePath={browsePath}
    >
      {renderPaneContent(
        <FileViewerContent
          filePath={filePath}
          workspaceId={materializedWorkspaceId}
          effectiveMode={normalizedEffectiveMode}
          read={read}
          activeDiffTarget={activeDiffTarget}
          diffLayout={diffLayout}
          canShowRichPreview={canShowRichPreview}
          wordWrap={wordWrap}
        />,
      )}
    </FileViewerFrame>
  );
}

function parentDirectoryPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}
