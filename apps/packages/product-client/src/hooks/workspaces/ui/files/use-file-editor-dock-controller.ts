import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FILE_VIEWER_CONTENT_MIN_WIDTH } from "#product/hooks/workspaces/ui/files/use-docked-file-tree-resize";
import { FILE_TREE_DOCK_MIN_WIDTH } from "#product/lib/domain/files/file-tree-dock-state";
import type { WorkspaceShellActions } from "#product/hooks/workspaces/workflows/use-workspace-shell-actions";
import {
  selectFileTreeDesiredWidth,
  selectFileTreeExpandedPaths,
  selectFileTreeRequestedVisibility,
  useFileTreeStore,
} from "#product/stores/editor/file-tree-store";

/** A requested dock is effectively visible only at or above this body width. */
export const FILE_TREE_DOCK_MIN_BODY_WIDTH =
  FILE_VIEWER_CONTENT_MIN_WIDTH + FILE_TREE_DOCK_MIN_WIDTH;

type DockPendingFocus =
  | { kind: "filter" }
  | { kind: "reveal"; path: string; token: number }
  | null;

interface FileContext {
  workspaceUiKey: string | null;
  materializedWorkspaceId: string | null;
  treeStateKey: string | null;
}

interface UseFileEditorDockControllerArgs {
  fileContext: FileContext;
  targetKey: string;
  shellActions: WorkspaceShellActions | null;
  openFile: (path: string) => void;
}

/**
 * `FileEditorView`'s sole dock controller (spec "02A - Docked File Tree"):
 * reads only synchronous hydrated/default store state, performs no
 * persistence I/O, starts no hydration, and owns the controller-local UI
 * (filter, focus origin, async revision, geometry requests, pending-focus
 * settlement) once for every render branch. Extracted out of
 * `FileEditorView.tsx` as pure code motion to keep both files under the
 * repo's line cap; no behavior change.
 */
export function useFileEditorDockController({
  fileContext,
  targetKey,
  shellActions,
  openFile,
}: UseFileEditorDockControllerArgs) {
  const { materializedWorkspaceId, treeStateKey } = fileContext;
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

  const pendingFocusAwaitingSettleRef = useRef(false);

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
    // Always mint the token: the open-focus steps run once the dock becomes
    // effectively visible, which is the common case even when the current
    // (pre-widen) geometry can't yet reach the threshold — the requested
    // widen is what makes it visible. The settle-effect below discards this
    // token if the geometry request settles without the dock ever becoming
    // visible, so a later unrelated restore can't consume it.
    setPendingFocus({ kind: "filter" });
    pendingFocusAwaitingSettleRef.current = true;
  }, [closeDock, filesAvailable, requestDockGeometry, requestedOpen, setRequestedVisibility, visibilityKeys]);

  const handleRevealFilesPath = useCallback((path: string) => {
    if (!filesAvailable) {
      return;
    }
    focusOriginRef.current = document.activeElement as HTMLElement | null;
    // requested=true and the width request happen unconditionally: a
    // breadcrumb reveal while geometry is hidden still asks the shell to
    // widen so the dock can become visible.
    setRequestedVisibility(visibilityKeys, true);
    requestDockGeometry();
    revealTokenRef.current += 1;
    setPendingFocus({ kind: "reveal", path, token: revealTokenRef.current });
    pendingFocusAwaitingSettleRef.current = true;
  }, [filesAvailable, requestDockGeometry, setRequestedVisibility, visibilityKeys]);

  // A pending-focus token minted while the dock was not yet effectively
  // visible (the common first-open/reveal-from-narrow-rail path) is only
  // resolved once the requested geometry settles: if that settlement lands
  // with the dock visible, DockedFileTree consumes the token normally; if it
  // settles with the dock still not visible (geometry couldn't reach the
  // threshold), the token is stale and must be discarded here so a much
  // later, unrelated responsive restore can never consume it and steal focus
  // back from the control the user is now using.
  useEffect(() => {
    if (!pendingFocusAwaitingSettleRef.current) {
      return;
    }
    pendingFocusAwaitingSettleRef.current = false;
    if (!dockVisible) {
      setPendingFocus(null);
    }
  }, [bodyWidth, dockVisible]);

  // A responsive shrink that auto-collapses the dock must not leave focus on a
  // detached row: move it to the Files toggle, otherwise the frame root.
  const wasVisibleRef = useRef(false);
  useEffect(() => {
    const wasVisible = wasVisibleRef.current;
    wasVisibleRef.current = dockVisible;
    if (wasVisible && !dockVisible) {
      // The dock is no longer effectively visible: drop any pending-focus
      // token so a later responsive restore never consumes a stale one and
      // steals focus.
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

  return {
    rootRef,
    filesAvailable,
    requestedOpen,
    desiredWidth,
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
  };
}
