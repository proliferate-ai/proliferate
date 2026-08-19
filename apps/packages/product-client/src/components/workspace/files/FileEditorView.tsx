import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
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
import { FILE_VIEWER_CONTENT_MIN_WIDTH } from "#product/hooks/workspaces/ui/files/use-docked-file-tree-resize";
import { canPreviewAsRichFile } from "#product/lib/domain/files/document-preview";
import { FILE_TREE_DOCK_MIN_WIDTH } from "#product/lib/domain/files/file-tree-dock-state";
import type { FileDiffTarget } from "#product/lib/domain/workspaces/viewer/file-diff-options";
import {
  defaultFileViewerMode,
  normalizeFileViewerMode,
  type ViewerTargetKey,
} from "#product/lib/domain/workspaces/viewer/viewer-target";
import { useContentSearchStore } from "#product/stores/search/content-search-store";
import {
  selectFileTreeDesiredWidth,
  selectFileTreeExpandedPaths,
  selectFileTreeRequestedVisibility,
  useFileTreeStore,
} from "#product/stores/editor/file-tree-store";
import { useWorkspaceViewerTabsStore } from "#product/stores/editor/workspace-viewer-tabs-store";
import { useGitChangedPaths } from "#product/hooks/workspaces/derived/files/use-git-changed-paths";

/** A requested dock is effectively visible only at or above this body width. */
export const FILE_TREE_DOCK_MIN_BODY_WIDTH =
  FILE_VIEWER_CONTENT_MIN_WIDTH + FILE_TREE_DOCK_MIN_WIDTH;

type DockPendingFocus =
  | { kind: "filter" }
  | { kind: "reveal"; path: string; token: number }
  | null;

interface FileEditorViewProps {
  filePath: string;
  targetKey: ViewerTargetKey;
  diffTarget?: FileDiffTarget;
}

export function FileEditorView({ filePath, targetKey, diffTarget }: FileEditorViewProps) {
  const fileContext = useWorkspaceFileContext();
  const { writeText } = useProductHost().clipboard;
  const materializedWorkspaceId = fileContext.materializedWorkspaceId;
  const treeStateKey = fileContext.treeStateKey;
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

  // ---------------------------------------------------------------------
  // Dock controller. `FileEditorView` is the sole dock controller: it reads
  // only synchronous hydrated/default store state, performs no persistence
  // I/O, starts no hydration, and owns the controller-local UI (filter, focus
  // origin, async revision, geometry requests) once for every render branch.
  // ---------------------------------------------------------------------
  const rootRef = useRef<HTMLDivElement | null>(null);
  const filesAvailable = materializedWorkspaceId !== null && treeStateKey !== null;
  const visibilityKeys = useMemo(
    () => ({ primaryKey: fileContext.workspaceUiKey, fallbackKey: materializedWorkspaceId }),
    [fileContext.workspaceUiKey, materializedWorkspaceId],
  );
  const expansionScope = useMemo(
    () => (materializedWorkspaceId && treeStateKey ? { materializedWorkspaceId, treeStateKey } : null),
    [materializedWorkspaceId, treeStateKey],
  );

  const requestedOpen = useFileTreeStore(
    (state) => selectFileTreeRequestedVisibility(state, visibilityKeys),
  );
  const desiredWidth = useFileTreeStore(selectFileTreeDesiredWidth);
  const expandedPaths = useFileTreeStore(
    (state) => selectFileTreeExpandedPaths(state, expansionScope),
  );
  const setRequestedVisibility = useFileTreeStore((state) => state.setRequestedVisibility);
  const setDesiredWidth = useFileTreeStore((state) => state.setDesiredWidth);
  const storeSetPathExpanded = useFileTreeStore((state) => state.setPathExpanded);
  const storeTogglePathExpanded = useFileTreeStore((state) => state.togglePathExpanded);
  const claimFileTreeStateKey = useFileTreeStore((state) => state.claimFileTreeStateKey);

  // The first committed file-viewer render claims the derived candidate so the
  // chosen first key survives controller/hook unmount and later collection
  // enrichment. The derived hook itself stays pure and never writes.
  useLayoutEffect(() => {
    if (materializedWorkspaceId && treeStateKey) {
      claimFileTreeStateKey(materializedWorkspaceId, treeStateKey);
    }
  }, [claimFileTreeStateKey, materializedWorkspaceId, treeStateKey]);

  const [filter, setFilter] = useState("");
  const [pendingFocus, setPendingFocus] = useState<DockPendingFocus>(null);
  const [bodyWidth, setBodyWidth] = useState(0);
  const focusOriginRef = useRef<HTMLElement | null>(null);
  const requestTokenRef = useRef(0);
  const revealTokenRef = useRef(0);

  const captureRequest = useCallback(() => {
    requestTokenRef.current += 1;
    return requestTokenRef.current;
  }, []);
  const isCurrent = useCallback((token: number) => token === requestTokenRef.current, []);
  const clearPendingFocus = useCallback(() => setPendingFocus(null), []);
  const invalidateRequests = useCallback(() => {
    requestTokenRef.current += 1;
  }, []);

  // Any materialized-workspace, tree-scope, or active-target change resets the
  // controller-local UI and invalidates every in-flight async request.
  const revisionKey = `${materializedWorkspaceId ?? ""}|${treeStateKey ?? ""}|${targetKey}`;
  useEffect(() => {
    invalidateRequests();
    setFilter("");
    setPendingFocus(null);
    return invalidateRequests;
  }, [invalidateRequests, revisionKey]);

  useEffect(() => {
    const body = rootRef.current?.querySelector<HTMLElement>("[data-file-viewer-body]");
    if (!body) {
      return;
    }
    const update = () => setBodyWidth(body.clientWidth);
    update();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(update);
    observer.observe(body);
    return () => observer.disconnect();
  }, []);

  const geometryPermits = bodyWidth >= FILE_TREE_DOCK_MIN_BODY_WIDTH;
  const dockVisible = filesAvailable && requestedOpen && geometryPermits;
  const effectiveTreeWidth = Math.min(
    Math.max(FILE_TREE_DOCK_MIN_WIDTH, desiredWidth),
    Math.max(FILE_TREE_DOCK_MIN_WIDTH, bodyWidth - FILE_VIEWER_CONTENT_MIN_WIDTH),
  );

  const restoreOriginFocus = useCallback(() => {
    const origin = focusOriginRef.current;
    focusOriginRef.current = null;
    if (origin?.isConnected && !origin.hasAttribute("disabled")) {
      origin.focus();
      return;
    }
    rootRef.current?.focus();
  }, []);

  // Target a body width of 380 + desiredTreeWidth rather than the bare
  // visibility minimum, taking the maximum against the durable rail preference
  // so a temporarily clamped shell never inflates a wider preference.
  const requestDockGeometry = useCallback(() => {
    const root = rootRef.current;
    const body = root?.querySelector<HTMLElement>("[data-file-viewer-body]");
    const rail = root?.closest<HTMLElement>("[data-right-panel-rail]");
    if (!shellActions || !body || !rail) {
      return;
    }
    const deficit = FILE_VIEWER_CONTENT_MIN_WIDTH + desiredWidth - body.clientWidth;
    shellActions.ensureRightPanelWidth(rail.clientWidth + Math.max(0, deficit));
  }, [desiredWidth, shellActions]);

  const closeDock = useCallback(() => {
    invalidateRequests();
    setRequestedVisibility(visibilityKeys, false);
    setFilter("");
    setPendingFocus(null);
    restoreOriginFocus();
  }, [invalidateRequests, restoreOriginFocus, setRequestedVisibility, visibilityKeys]);

  const handleToggleFiles = useCallback(() => {
    if (!filesAvailable) {
      return;
    }
    if (requestedOpen) {
      // Explicit close, including while responsively auto-collapsed, so the
      // dock will not later reopen itself.
      closeDock();
      return;
    }
    focusOriginRef.current = document.activeElement as HTMLElement | null;
    setRequestedVisibility(visibilityKeys, true);
    requestDockGeometry();
    // Only DockedFileTree ever consumes a pending-focus token, and geometry
    // that cannot reach the visibility threshold never mounts it: setting a
    // token here would sit unresolved and get consumed by a much-later
    // responsive restore, stealing focus back from whatever the user is
    // doing by then. Keep focus on the invoking control instead.
    if (geometryPermits) {
      setPendingFocus({ kind: "filter" });
    }
  }, [closeDock, filesAvailable, geometryPermits, requestDockGeometry, requestedOpen, setRequestedVisibility, visibilityKeys]);

  const handleRevealFilesPath = useCallback((path: string) => {
    if (!filesAvailable) {
      return;
    }
    focusOriginRef.current = document.activeElement as HTMLElement | null;
    // requested=true and the width request happen unconditionally: a
    // breadcrumb reveal while geometry is hidden still asks the shell to
    // widen so the dock can become visible. Only the focus token is gated on
    // current geometry, per the same stale-token rule as the filter toggle.
    setRequestedVisibility(visibilityKeys, true);
    requestDockGeometry();
    if (geometryPermits) {
      revealTokenRef.current += 1;
      setPendingFocus({ kind: "reveal", path, token: revealTokenRef.current });
    }
  }, [filesAvailable, geometryPermits, requestDockGeometry, setRequestedVisibility, visibilityKeys]);

  // A responsive shrink that auto-collapses the dock must not leave focus on a
  // detached row: move it to the Files toggle, otherwise the frame root.
  const wasVisibleRef = useRef(false);
  useEffect(() => {
    const wasVisible = wasVisibleRef.current;
    wasVisibleRef.current = dockVisible;
    if (wasVisible && !dockVisible) {
      // The dock is no longer effectively visible (or never became visible
      // for this request): drop any pending-focus token so a later
      // responsive restore never consumes a stale one and steals focus.
      setPendingFocus(null);
    }
    if (wasVisible && !dockVisible && requestedOpen) {
      const active = typeof document === "undefined" ? null : document.activeElement;
      if (active !== null && active !== document.body) {
        return;
      }
      const toggle = rootRef.current?.querySelector<HTMLElement>(
        '[data-file-viewer-toolbar] [aria-pressed]',
      );
      (toggle ?? rootRef.current)?.focus();
    }
  }, [dockVisible, requestedOpen]);

  const setExpanded = useCallback((path: string, expanded: boolean) => {
    if (expansionScope) { storeSetPathExpanded(expansionScope, path, expanded); }
  }, [expansionScope, storeSetPathExpanded]);
  const toggleExpanded = useCallback((path: string) => {
    if (expansionScope) { storeTogglePathExpanded(expansionScope, path); }
  }, [expansionScope, storeTogglePathExpanded]);
  const openTreeFile = useCallback((path: string) => {
    // The existing canonical workspace viewer-target action; tree rows never
    // use `useFileReferenceActions`, fuzzy recovery, or a native target.
    void openFile(path);
  }, [openFile]);

  const read = readQuery.data;
  const copyContent = () => {
    void writeText(read?.content ?? "");
  };
  const copyPath = () => {
    void fileActions.copyCurrentPath();
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
    canOpenExternal,
    onToggleWordWrap: () => setWordWrap((value) => !value),
    onToggleRichPreview: toggleRichPreview,
    onCopyContent: copyContent,
    onCopyPath: copyPath,
    onOpenExternal: openExternal,
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
