import { create } from "zustand";
import {
  defaultFileViewerMode,
  isFileViewerTarget,
  parseViewerTargetKey,
  pathIsWithinWorkspaceEntry,
  remapViewerTargetPathWithinWorkspaceEntry,
  viewerTargetEditablePath,
  viewerTargetKey,
  type DiffViewerLayout,
  type FileViewerMode,
  type ViewerTarget,
  type ViewerTargetKey,
} from "#product/lib/domain/workspaces/viewer/viewer-target";

/**
 * A session-only request that the mounted viewer frame take keyboard focus.
 *
 * It carries the canonical target key plus a monotonic number and nothing
 * else: the key is path-bearing session memory, so it is never persisted,
 * rendered, logged, or emitted. Any active-target change before the frame
 * consumes the request invalidates it.
 */
export interface ViewerFocusRequest {
  targetKey: ViewerTargetKey;
  token: number;
}

function focusRequestForActiveTarget(
  request: ViewerFocusRequest | null,
  activeTargetKey: ViewerTargetKey | null,
): ViewerFocusRequest | null {
  return request && request.targetKey === activeTargetKey ? request : null;
}

export interface WorkspaceViewerRestoreMarker {
  workspaceUiKey: string;
  materializedWorkspaceId: string;
  initVersion: number;
  ready: boolean;
}

interface WorkspaceViewerTabsState {
  workspaceUiKey: string | null;
  materializedWorkspaceId: string | null;
  initVersion: number;
  viewerRestoreMarker: WorkspaceViewerRestoreMarker | null;
  openTargets: ViewerTarget[];
  activeTargetKey: ViewerTargetKey | null;
  modeByTargetKey: Record<ViewerTargetKey, FileViewerMode>;
  layoutByTargetKey: Record<ViewerTargetKey, DiffViewerLayout>;
  viewerFocusRequest: ViewerFocusRequest | null;
  viewerFocusRequestSeq: number;

  prepareWorkspace: (args: {
    workspaceUiKey: string;
    materializedWorkspaceId: string;
    initialOpenTargets?: ViewerTarget[];
    initialActiveTargetKey?: string | null;
  }) => number;
  reset: () => void;
  openTarget: (target: ViewerTarget) => ViewerTargetKey;
  closeTarget: (targetKey: ViewerTargetKey) => void;
  renamePathReferences: (fromPath: string, toPath: string) => void;
  closePathReferences: (path: string) => void;
  reorderOpenTargets: (orderedTargetKeys: readonly ViewerTargetKey[]) => void;
  setActiveTarget: (targetKey: ViewerTargetKey | null) => void;
  requestViewerFocus: (targetKey: ViewerTargetKey) => void;
  consumeViewerFocusRequest: (token: number) => void;
  setTargetMode: (targetKey: ViewerTargetKey, mode: FileViewerMode) => void;
  setTargetLayout: (targetKey: ViewerTargetKey, layout: DiffViewerLayout) => void;
}

function emptyViewerState() {
  return {
    openTargets: [] as ViewerTarget[],
    activeTargetKey: null as ViewerTargetKey | null,
    modeByTargetKey: {} as Record<ViewerTargetKey, FileViewerMode>,
    layoutByTargetKey: {} as Record<ViewerTargetKey, DiffViewerLayout>,
    viewerFocusRequest: null as ViewerFocusRequest | null,
  };
}

function targetMode(target: ViewerTarget): FileViewerMode {
  if (target.kind === "fileDiff") {
    return "diff";
  }
  return isFileViewerTarget(target) ? defaultFileViewerMode(target.path) : "source";
}

export const useWorkspaceViewerTabsStore = create<WorkspaceViewerTabsState>((set, get) => ({
  workspaceUiKey: null,
  materializedWorkspaceId: null,
  initVersion: 0,
  viewerRestoreMarker: null,
  viewerFocusRequestSeq: 0,
  ...emptyViewerState(),

  prepareWorkspace: (args) => {
    const initVersion = get().initVersion + 1;
    const initialOpenTargets = args.initialOpenTargets ?? [];
    const openTargetKeys = new Set(initialOpenTargets.map(viewerTargetKey));
    const activeTarget = args.initialActiveTargetKey
      && openTargetKeys.has(args.initialActiveTargetKey as ViewerTargetKey)
      ? args.initialActiveTargetKey as ViewerTargetKey
      : null;
    const modeByTargetKey: Record<ViewerTargetKey, FileViewerMode> = {};
    for (const target of initialOpenTargets) {
      modeByTargetKey[viewerTargetKey(target)] = targetMode(target);
    }

    set({
      workspaceUiKey: args.workspaceUiKey,
      materializedWorkspaceId: args.materializedWorkspaceId,
      initVersion,
      ...emptyViewerState(),
      openTargets: initialOpenTargets,
      activeTargetKey: activeTarget,
      modeByTargetKey,
      viewerRestoreMarker: {
        workspaceUiKey: args.workspaceUiKey,
        materializedWorkspaceId: args.materializedWorkspaceId,
        initVersion,
        ready: true,
      },
    });
    return initVersion;
  },

  reset: () => {
    const initVersion = get().initVersion + 1;
    set({
      workspaceUiKey: null,
      materializedWorkspaceId: null,
      initVersion,
      viewerRestoreMarker: null,
      ...emptyViewerState(),
    });
  },

  openTarget: (target) => {
    const targetKey = viewerTargetKey(target);
    const exists = get().openTargets.some((candidate) => viewerTargetKey(candidate) === targetKey);
    set((current) => ({
      openTargets: exists ? current.openTargets : [...current.openTargets, target],
      activeTargetKey: targetKey,
      viewerFocusRequest: focusRequestForActiveTarget(current.viewerFocusRequest, targetKey),
      modeByTargetKey: current.modeByTargetKey[targetKey]
        ? current.modeByTargetKey
        : {
          ...current.modeByTargetKey,
          [targetKey]: targetMode(target),
        },
    }));
    return targetKey;
  },

  closeTarget: (targetKey) => {
    const nextTargets = get().openTargets.filter((target) => viewerTargetKey(target) !== targetKey);
    const nextActive = get().activeTargetKey === targetKey
      ? nextTargets.length > 0
        ? viewerTargetKey(nextTargets[nextTargets.length - 1]!)
        : null
      : get().activeTargetKey;
    const nextModes = { ...get().modeByTargetKey };
    const nextLayouts = { ...get().layoutByTargetKey };
    delete nextModes[targetKey];
    delete nextLayouts[targetKey];
    set({
      openTargets: nextTargets,
      activeTargetKey: nextActive,
      modeByTargetKey: nextModes,
      layoutByTargetKey: nextLayouts,
      viewerFocusRequest: focusRequestForActiveTarget(get().viewerFocusRequest, nextActive),
    });
  },

  renamePathReferences: (fromPath, toPath) => {
    const current = get();
    const nextTargets: ViewerTarget[] = [];
    const seen = new Set<ViewerTargetKey>();
    const nextModes: Record<ViewerTargetKey, FileViewerMode> = {};
    const nextLayouts: Record<ViewerTargetKey, DiffViewerLayout> = {};
    let nextActiveTargetKey = current.activeTargetKey;

    for (const target of current.openTargets) {
      const currentKey = viewerTargetKey(target);
      const nextTarget = remapViewerTargetPathWithinWorkspaceEntry(target, fromPath, toPath);
      const nextKey = viewerTargetKey(nextTarget);
      if (!seen.has(nextKey)) {
        nextTargets.push(nextTarget);
        seen.add(nextKey);
      }
      nextModes[nextKey] = current.modeByTargetKey[currentKey] ?? targetMode(nextTarget);
      if (current.layoutByTargetKey[currentKey]) {
        nextLayouts[nextKey] = current.layoutByTargetKey[currentKey]!;
      }
      if (current.activeTargetKey === currentKey) {
        nextActiveTargetKey = nextKey;
      }
    }

    set({
      openTargets: nextTargets,
      activeTargetKey: nextActiveTargetKey,
      modeByTargetKey: nextModes,
      layoutByTargetKey: nextLayouts,
      viewerFocusRequest: focusRequestForActiveTarget(
        current.viewerFocusRequest,
        nextActiveTargetKey,
      ),
    });
  },

  closePathReferences: (path) => {
    const current = get();
    const nextTargets = current.openTargets.filter((target) => {
      const editablePath = viewerTargetEditablePath(target);
      return !editablePath || !pathIsWithinWorkspaceEntry(editablePath, path);
    });
    const nextTargetKeys = new Set(nextTargets.map(viewerTargetKey));
    const nextModes: Record<ViewerTargetKey, FileViewerMode> = {};
    const nextLayouts: Record<ViewerTargetKey, DiffViewerLayout> = {};
    for (const target of nextTargets) {
      const key = viewerTargetKey(target);
      if (current.modeByTargetKey[key]) {
        nextModes[key] = current.modeByTargetKey[key]!;
      }
      if (current.layoutByTargetKey[key]) {
        nextLayouts[key] = current.layoutByTargetKey[key]!;
      }
    }
    const nextActive = current.activeTargetKey && nextTargetKeys.has(current.activeTargetKey)
      ? current.activeTargetKey
      : nextTargets.length > 0
        ? viewerTargetKey(nextTargets[nextTargets.length - 1]!)
        : null;

    set({
      openTargets: nextTargets,
      activeTargetKey: nextActive,
      modeByTargetKey: nextModes,
      layoutByTargetKey: nextLayouts,
      viewerFocusRequest: focusRequestForActiveTarget(current.viewerFocusRequest, nextActive),
    });
  },

  reorderOpenTargets: (orderedTargetKeys) => {
    const targetByKey = new Map(get().openTargets.map((target) => [viewerTargetKey(target), target]));
    const next: ViewerTarget[] = [];
    const seen = new Set<ViewerTargetKey>();
    for (const key of orderedTargetKeys) {
      const target = targetByKey.get(key);
      if (target && !seen.has(key)) {
        next.push(target);
        seen.add(key);
      }
    }
    for (const target of get().openTargets) {
      const key = viewerTargetKey(target);
      if (!seen.has(key)) {
        next.push(target);
      }
    }
    set({ openTargets: next });
  },

  setActiveTarget: (targetKey) => {
    if (targetKey && !parseViewerTargetKey(targetKey)) {
      return;
    }
    set((current) => ({
      activeTargetKey: targetKey,
      viewerFocusRequest: focusRequestForActiveTarget(current.viewerFocusRequest, targetKey),
    }));
  },

  // Sole caller is the canonical shell activation path; a fresh number is
  // minted on every request so re-activating the already-selected target
  // cannot be swallowed.
  requestViewerFocus: (targetKey) => {
    set((current) => ({
      viewerFocusRequestSeq: current.viewerFocusRequestSeq + 1,
      viewerFocusRequest: { targetKey, token: current.viewerFocusRequestSeq + 1 },
    }));
  },

  consumeViewerFocusRequest: (token) => {
    set((current) => (
      current.viewerFocusRequest?.token === token
        ? { viewerFocusRequest: null }
        : current
    ));
  },

  setTargetMode: (targetKey, mode) => {
    set((current) => ({
      modeByTargetKey: {
        ...current.modeByTargetKey,
        [targetKey]: mode,
      },
    }));
  },

  setTargetLayout: (targetKey, layout) => {
    set((current) => ({
      layoutByTargetKey: {
        ...current.layoutByTargetKey,
        [targetKey]: layout,
      },
    }));
  },
}));
