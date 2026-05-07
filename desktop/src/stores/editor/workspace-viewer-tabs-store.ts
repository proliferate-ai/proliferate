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
} from "@/lib/domain/workspaces/viewer/viewer-target";

export interface WorkspaceViewerRestoreMarker {
  workspaceUiKey: string;
  materializedWorkspaceId: string;
  initVersion: number;
  ready: boolean;
}

export interface WorkspaceViewerContext {
  workspaceUiKey: string | null;
  materializedWorkspaceId: string | null;
  anyharnessWorkspaceId: string | null;
  runtimeUrl: string | null;
  authToken: string | null;
  treeStateKey: string | null;
}

interface WorkspaceViewerTabsState extends WorkspaceViewerContext {
  initVersion: number;
  viewerRestoreMarker: WorkspaceViewerRestoreMarker | null;
  openTargets: ViewerTarget[];
  activeTargetKey: ViewerTargetKey | null;
  modeByTargetKey: Record<ViewerTargetKey, FileViewerMode>;
  layoutByTargetKey: Record<ViewerTargetKey, DiffViewerLayout>;

  prepareWorkspace: (args: {
    workspaceUiKey: string;
    materializedWorkspaceId: string;
    anyharnessWorkspaceId: string;
    runtimeUrl: string;
    treeStateKey: string;
    authToken?: string | null;
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
  setTargetMode: (targetKey: ViewerTargetKey, mode: FileViewerMode) => void;
  setTargetLayout: (targetKey: ViewerTargetKey, layout: DiffViewerLayout) => void;
}

function emptyViewerState() {
  return {
    openTargets: [] as ViewerTarget[],
    activeTargetKey: null as ViewerTargetKey | null,
    modeByTargetKey: {} as Record<ViewerTargetKey, FileViewerMode>,
    layoutByTargetKey: {} as Record<ViewerTargetKey, DiffViewerLayout>,
  };
}

function targetMode(target: ViewerTarget): FileViewerMode {
  if (target.kind === "fileDiff") {
    return "diff";
  }
  return isFileViewerTarget(target) ? defaultFileViewerMode(target.path) : "edit";
}

export const useWorkspaceViewerTabsStore = create<WorkspaceViewerTabsState>((set, get) => ({
  workspaceUiKey: null,
  materializedWorkspaceId: null,
  anyharnessWorkspaceId: null,
  runtimeUrl: null,
  authToken: null,
  treeStateKey: null,
  initVersion: 0,
  viewerRestoreMarker: null,
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
      anyharnessWorkspaceId: args.anyharnessWorkspaceId,
      runtimeUrl: args.runtimeUrl,
      authToken: args.authToken ?? null,
      treeStateKey: args.treeStateKey,
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
      anyharnessWorkspaceId: null,
      runtimeUrl: null,
      authToken: null,
      treeStateKey: null,
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
    set({ activeTargetKey: targetKey });
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
