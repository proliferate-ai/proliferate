import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { OpenTarget } from "@proliferate/product-client/host/desktop-bridge";
import { FileViewerContent } from "#product/components/workspace/files/FileViewerContent";
import { LoadingState } from "#product/components/feedback/LoadingIllustration";
import { useReadWorkspaceFileQuery } from "@anyharness/sdk-react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { CenterMessage } from "#product/components/workspace/files/viewer/CenterMessage";
import { FileViewerFrame } from "#product/components/workspace/files/viewer/FileViewerFrame";
import { DockedFileTree } from "#product/components/workspace/files/tree/DockedFileTree";
import { useFileReferenceActions } from "#product/hooks/workspaces/workflows/files/use-file-reference-actions";
import { useWorkspaceFileContext } from "#product/hooks/workspaces/derived/files/use-workspace-file-context";
import { useWorkspaceFileTargetActions } from "#product/hooks/workspaces/workflows/files/use-workspace-file-target-actions";
import { useWorkspaceShellActions } from "#product/hooks/workspaces/workflows/use-workspace-shell-actions";
import { canPreviewAsRichFile } from "#product/lib/domain/files/document-preview";
import type { FileDiffTarget } from "#product/lib/domain/workspaces/viewer/file-diff-options";
import {
  defaultFileViewerMode,
  normalizeFileViewerMode,
  type ViewerTargetKey,
} from "#product/lib/domain/workspaces/viewer/viewer-target";
import { useContentSearchStore } from "#product/stores/search/content-search-store";
import { useWorkspaceViewerTabsStore } from "#product/stores/editor/workspace-viewer-tabs-store";
import { useGitChangedPaths } from "#product/hooks/workspaces/derived/files/use-git-changed-paths";
import { useFileEditorDockController } from "#product/hooks/workspaces/ui/files/use-file-editor-dock-controller";

export { FILE_TREE_DOCK_MIN_BODY_WIDTH } from "#product/hooks/workspaces/ui/files/use-file-editor-dock-controller";

interface FileEditorViewProps {
  filePath: string;
  targetKey: ViewerTargetKey;
  diffTarget?: FileDiffTarget;
}

export function FileEditorView({ filePath, targetKey, diffTarget }: FileEditorViewProps) {
  const fileContext = useWorkspaceFileContext();
  const { writeText } = useProductHost().clipboard;
  const materializedWorkspaceId = fileContext.materializedWorkspaceId;
  const rawMode = useWorkspaceViewerTabsStore(
    (s) => s.modeByTargetKey[targetKey] ?? defaultFileViewerMode(filePath),
  );
  const setTargetMode = useWorkspaceViewerTabsStore((s) => s.setTargetMode);
  const diffLayout = useWorkspaceViewerTabsStore((s) => s.layoutByTargetKey[targetKey] ?? "unified");
  const openContentSearch = useContentSearchStore((s) => s.openSearch);
  const { openFile } = useWorkspaceFileTargetActions(fileContext);
  const shellActions = useWorkspaceShellActions();
  const fileActions = useFileReferenceActions({
    rawPath: filePath,
    workspacePath: filePath,
  });
  const canOpenExternal = fileActions.canOpenExternal;
  const openInTargets = fileActions.openTargets;
  const defaultOpenTarget = fileActions.defaultOpenTarget;
  // Fail-closed: eligibility is expressed purely through 01D's resolved
  // outputs, never re-derived from path syntax/platform/localhost.
  const openInEligible = canOpenExternal
    && fileActions.nativePathKind === "file"
    && openInTargets.length > 0
    && defaultOpenTarget !== null;

  // Session-only monotonic revision: bumps whenever locator identity,
  // nativePathKind, companion/absolute identity, the default target, or the
  // eligible target set changes. Never rendered/logged — only the number is
  // exposed downstream, keying the SplitButton subtree so an uncontrolled
  // popover remounts closed on a capability change.
  const openInLocator = fileActions.reference.locator;
  const openInIdentityKey = JSON.stringify({
    authority: openInLocator.authority,
    workspacePath: openInLocator.authority === "workspace" ? openInLocator.workspacePath : null,
    companionPath: openInLocator.authority === "workspace" ? openInLocator.localCompanionPath : null,
    absolutePath: openInLocator.authority === "desktop" ? openInLocator.absolutePath : null,
    nativePathKind: fileActions.nativePathKind,
    defaultTargetId: defaultOpenTarget?.id ?? null,
    targetIds: openInTargets.map((target) => target.id),
  });
  const openInIdentityRef = useRef(openInIdentityKey);
  const [openInRevision, setOpenInRevision] = useState(0);
  const [openInFailed, setOpenInFailed] = useState(false);
  useEffect(() => {
    if (openInIdentityRef.current === openInIdentityKey) return;
    openInIdentityRef.current = openInIdentityKey;
    setOpenInRevision((revision) => revision + 1);
    setOpenInFailed(false);
  }, [openInIdentityKey]);

  const handleOpenDefault = useCallback(() => {
    void fileActions.openDefault().then((opened) => {
      setOpenInFailed(!opened);
    });
  }, [fileActions.openDefault]);

  const handleOpenWithTarget = useCallback((target: OpenTarget) => {
    void fileActions.openWithTarget(target.id).then(
      () => setOpenInFailed(false),
      () => setOpenInFailed(true),
    );
  }, [fileActions.openWithTarget]);

  const [wordWrap, setWordWrap] = useState(false);
  const changedPaths = useGitChangedPaths(materializedWorkspaceId);
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

  const {
    rootRef,
    filesAvailable,
    requestedOpen,
    setDesiredWidth,
    expandedPaths,
    setExpanded,
    toggleExpanded,
    openTreeFile,
    filter,
    setFilter,
    pendingFocus,
    clearPendingFocus,
    bodyWidth,
    dockVisible,
    effectiveTreeWidth,
    captureRequest,
    isCurrent,
    closeDock,
    handleToggleFiles,
    handleRevealFilesPath,
  } = useFileEditorDockController({ fileContext, targetKey, shellActions, openFile });

  const read = readQuery.data;
  const copyContent = () => {
    void writeText(read?.content ?? "");
  };
  const copyPath = () => {
    void fileActions.copyCurrentPath();
  };
  const openFindInDiffs = () => {
    if (activeDiffTarget || !read?.isText || read.tooLarge) {
      return;
    }

    if (normalizedEffectiveMode === "rendered") {
      setTargetMode(targetKey, "source");
    }

    openContentSearch("file");
  };
  const toggleRichPreview = () => {
    setTargetMode(
      targetKey,
      normalizedEffectiveMode === "rendered" ? "source" : "rendered",
    );
  };
  const canFindInFile = !activeDiffTarget && Boolean(read?.isText && !read.tooLarge);

  // Marks only paint in source view, so entering file search must leave the
  // rich preview — from every entry point (toolbar icon, Cmd+F shortcut).
  // Only on the open transition: toggling rich preview back on mid-search is
  // an explicit user choice we don't fight.
  const searchOpen = useContentSearchStore((s) => s.open);
  const searchSurface = useContentSearchStore((s) => s.surface);
  const fileSearchActive = searchOpen && searchSurface === "file";
  const prevFileSearchActiveRef = useRef(fileSearchActive);
  useEffect(() => {
    const activated = fileSearchActive && !prevFileSearchActiveRef.current;
    prevFileSearchActiveRef.current = fileSearchActive;
    if (!activated || !canFindInFile) {
      return;
    }
    if (normalizedEffectiveMode === "rendered") {
      setTargetMode(targetKey, "source");
    }
  }, [fileSearchActive, canFindInFile, normalizedEffectiveMode, setTargetMode, targetKey]);

  const fileTreeDock = dockVisible ? (
    <DockedFileTree
      workspaceId={materializedWorkspaceId}
      selectedPath={filePath}
      changedPaths={changedPaths}
      expandedPaths={expandedPaths}
      setExpanded={setExpanded}
      toggleExpanded={toggleExpanded}
      onOpenFile={openTreeFile}
      width={effectiveTreeWidth}
      bodyWidth={bodyWidth}
      onDesiredWidthChange={setDesiredWidth}
      filter={filter}
      onFilterChange={setFilter}
      onRequestClose={closeDock}
      captureRequest={captureRequest}
      isCurrent={isCurrent}
      pendingFilterFocus={pendingFocus?.kind === "filter"}
      revealRequest={pendingFocus?.kind === "reveal"
        ? { path: pendingFocus.path, token: pendingFocus.token }
        : null}
      onPendingFocusHandled={clearPendingFocus}
    />
  ) : null;

  const frameProps = {
    rootRef,
    filePath,
    canRenderRichPreview: canShowRichPreview,
    wordWrap,
    richPreviewEnabled: normalizedEffectiveMode === "rendered",
    openInEligible,
    openInDefaultTarget: defaultOpenTarget,
    openInTargets,
    onOpenDefault: handleOpenDefault,
    onOpenWithTarget: handleOpenWithTarget,
    openInRevision,
    openInFailed,
    onToggleWordWrap: () => setWordWrap((value) => !value),
    onToggleRichPreview: toggleRichPreview,
    onCopyContent: copyContent,
    onCopyPath: copyPath,
    onOpenContentSearch: openFindInDiffs,
    filesAvailable,
    filesRequestedOpen: requestedOpen,
    onToggleFiles: handleToggleFiles,
    onRevealFilesPath: handleRevealFilesPath,
    fileTreeDock,
  };

  const renderFrame = (
    overrides: { canCopyContent: boolean; canFindInFile: boolean },
    content: ReactNode,
  ) => (
    <FileViewerFrame {...frameProps} {...overrides}>
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {content}
        </div>
      </div>
    </FileViewerFrame>
  );

  if (requiresFileRead && readQuery.error) {
    return renderFrame(
      { canCopyContent: false, canFindInFile: false },
      <CenterMessage message={`Error: ${readQuery.error instanceof Error ? readQuery.error.message : "Failed to load file"}`} />,
    );
  }

  if (requiresFileRead && (readQuery.isLoading || !read)) {
    return renderFrame(
      { canCopyContent: false, canFindInFile: false },
      <div className="flex h-full items-center justify-center">
        <LoadingState message="Loading file" subtext={filePath.split("/").pop()} />
      </div>,
    );
  }

  return renderFrame(
    {
      canCopyContent: Boolean(read?.isText && !read.tooLarge),
      canFindInFile,
    },
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
  );
}
