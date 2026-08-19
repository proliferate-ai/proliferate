import { create } from "zustand";
import {
  FILE_TREE_DOCK_DEFAULT_WIDTH,
  hasOwnKey,
  normalizeFileTreeDockWidth,
  type PersistedFileTreeDockV1,
} from "#product/lib/domain/files/file-tree-dock-state";

/**
 * Synchronous UI state for the docked file tree.
 *
 * This store holds no storage object, diagnostic sink, read/write status, dirty
 * marker, retry counter, queue, or in-flight operation: ProductStorage
 * hydration, validation, migration, dirty tracking, serialized writes, retries,
 * authority switching, and cleanup belong to the file-tree dock persistence
 * lifecycle/coordinator. Durable fields (`desiredWidth`,
 * `requestedVisibilityByWorkspace`) are mutated by the user through
 * `setDesiredWidth`/`setRequestedVisibility`, each of which bumps
 * `durableRevision` so the attached lifecycle can relay the change. Expansion
 * scopes and the first-key registry are session-only and never persisted.
 */
export interface FileTreeExpansionScope {
  materializedWorkspaceId: string;
  treeStateKey: string;
}

export interface FileTreeVisibilityKeys {
  primaryKey: string | null; // workspaceUiKey
  fallbackKey: string | null; // materializedWorkspaceId
}

export interface FileTreeVisibilityPromotion {
  introducedRevision: number;
  primaryKey: string;
  fallbackKey: string;
  value: boolean;
}

export interface FileTreeState {
  desiredWidth: number;
  requestedVisibilityByWorkspace: Readonly<Record<string, boolean>>;
  firstTreeStateKeyByMaterializedWorkspace: ReadonlyMap<string, string>;
  expandedPathsByMaterializedWorkspace: ReadonlyMap<
    string,
    ReadonlyMap<string, ReadonlySet<string>>
  >;
  durableRevision: number;

  setDesiredWidth: (width: number) => void;
  setRequestedVisibility: (keys: FileTreeVisibilityKeys, requested: boolean) => void;
  prepareRequestedVisibilityPromotion: (
    keys: FileTreeVisibilityKeys,
  ) => FileTreeVisibilityPromotion | null;
  replaceFileTreeDockAuthorityState: (input: {
    durableRevision: number;
    desiredWidth: number;
    requestedVisibilityByWorkspace: Readonly<Record<string, boolean>>;
  }) => void;
  applyHydratedFileTreeDockState: (input: {
    expectedDurableRevision: number;
    desiredWidth: number;
    requestedVisibilityByWorkspace: Readonly<Record<string, boolean>>;
  }) => boolean;
  commitRequestedVisibilityPromotions: (input: {
    expectedDurableRevision: number;
    promotions: readonly FileTreeVisibilityPromotion[];
  }) => boolean;

  setPathExpanded: (
    scope: FileTreeExpansionScope,
    path: string,
    expanded: boolean,
  ) => void;
  togglePathExpanded: (scope: FileTreeExpansionScope, path: string) => void;
  collapseExpansionScope: (scope: FileTreeExpansionScope) => void;
  claimFileTreeStateKey: (
    materializedWorkspaceId: string,
    candidateTreeStateKey: string,
  ) => void;
  pruneFileTreeSessionState: (materializedWorkspaceId: string) => void;
}

const EMPTY_EXPANDED_PATHS: ReadonlySet<string> = new Set<string>();

function visibilityMapsEqual(
  left: Readonly<Record<string, boolean>>,
  right: Readonly<Record<string, boolean>>,
): boolean {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) {
    return false;
  }
  return leftKeys.every(
    (key) => hasOwnKey(right, key) && left[key] === right[key],
  );
}

function writeExpansionScope(
  state: FileTreeState,
  scope: FileTreeExpansionScope,
  update: (paths: ReadonlySet<string>) => ReadonlySet<string> | null,
): Partial<FileTreeState> | null {
  if (!scope.materializedWorkspaceId || !scope.treeStateKey) {
    return null;
  }
  const byWorkspace = state.expandedPathsByMaterializedWorkspace;
  const byTreeKey = byWorkspace.get(scope.materializedWorkspaceId);
  const current = byTreeKey?.get(scope.treeStateKey) ?? EMPTY_EXPANDED_PATHS;
  const next = update(current);
  if (next === null) {
    return null;
  }
  const nextByTreeKey = new Map(byTreeKey ?? []);
  if (next.size === 0) {
    nextByTreeKey.delete(scope.treeStateKey);
  } else {
    nextByTreeKey.set(scope.treeStateKey, next);
  }
  const nextByWorkspace = new Map(byWorkspace);
  if (nextByTreeKey.size === 0) {
    nextByWorkspace.delete(scope.materializedWorkspaceId);
  } else {
    nextByWorkspace.set(scope.materializedWorkspaceId, nextByTreeKey);
  }
  return { expandedPathsByMaterializedWorkspace: nextByWorkspace };
}

export const useFileTreeStore = create<FileTreeState>((set, get) => ({
  desiredWidth: FILE_TREE_DOCK_DEFAULT_WIDTH,
  requestedVisibilityByWorkspace: {},
  firstTreeStateKeyByMaterializedWorkspace: new Map<string, string>(),
  expandedPathsByMaterializedWorkspace: new Map(),
  durableRevision: 0,

  setDesiredWidth: (width) => {
    const normalized = normalizeFileTreeDockWidth(width);
    const state = get();
    if (normalized === state.desiredWidth) {
      return;
    }
    set({ desiredWidth: normalized, durableRevision: state.durableRevision + 1 });
  },

  setRequestedVisibility: (keys, requested) => {
    const targetKey = keys.primaryKey ?? keys.fallbackKey;
    if (!targetKey) {
      return;
    }
    const state = get();
    const next = { ...state.requestedVisibilityByWorkspace, [targetKey]: requested };
    if (keys.primaryKey && keys.fallbackKey && keys.fallbackKey !== keys.primaryKey) {
      // A primary write clears a stale fallback in the same mutation.
      delete next[keys.fallbackKey];
    }
    if (visibilityMapsEqual(next, state.requestedVisibilityByWorkspace)) {
      return;
    }
    set({
      requestedVisibilityByWorkspace: next,
      durableRevision: state.durableRevision + 1,
    });
  },

  prepareRequestedVisibilityPromotion: (keys) => {
    const { primaryKey, fallbackKey } = keys;
    if (!primaryKey || !fallbackKey || primaryKey === fallbackKey) {
      return null;
    }
    const state = get();
    const map = state.requestedVisibilityByWorkspace;
    if (hasOwnKey(map, primaryKey) || !hasOwnKey(map, fallbackKey)) {
      return null;
    }
    const introducedRevision = state.durableRevision + 1;
    // The effective fallback deliberately stays in memory until persistence
    // succeeds, so there is no visible flip on a failed promotion write.
    set({ durableRevision: introducedRevision });
    return { introducedRevision, primaryKey, fallbackKey, value: map[fallbackKey] };
  },

  replaceFileTreeDockAuthorityState: (input) => {
    set({
      durableRevision: input.durableRevision,
      desiredWidth: input.desiredWidth,
      requestedVisibilityByWorkspace: { ...input.requestedVisibilityByWorkspace },
    });
  },

  applyHydratedFileTreeDockState: (input) => {
    const state = get();
    if (input.expectedDurableRevision !== state.durableRevision) {
      return false;
    }
    set({
      desiredWidth: input.desiredWidth,
      requestedVisibilityByWorkspace: { ...input.requestedVisibilityByWorkspace },
    });
    return true;
  },

  commitRequestedVisibilityPromotions: (input) => {
    const state = get();
    if (input.expectedDurableRevision !== state.durableRevision) {
      return false;
    }
    const next = { ...state.requestedVisibilityByWorkspace };
    for (const promotion of input.promotions) {
      const fallbackPresent = hasOwnKey(next, promotion.fallbackKey);
      if (
        hasOwnKey(next, promotion.primaryKey)
        || !fallbackPresent
        || next[promotion.fallbackKey] !== promotion.value
      ) {
        return false;
      }
      next[promotion.primaryKey] = promotion.value;
      delete next[promotion.fallbackKey];
    }
    if (input.promotions.length === 0) {
      return true;
    }
    set({ requestedVisibilityByWorkspace: next });
    return true;
  },

  setPathExpanded: (scope, path, expanded) => {
    const patch = writeExpansionScope(get(), scope, (paths) => {
      if (paths.has(path) === expanded) {
        return null;
      }
      const next = new Set(paths);
      if (expanded) {
        next.add(path);
      } else {
        next.delete(path);
      }
      return next;
    });
    if (patch) {
      set(patch);
    }
  },

  togglePathExpanded: (scope, path) => {
    const patch = writeExpansionScope(get(), scope, (paths) => {
      const next = new Set(paths);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
    if (patch) {
      set(patch);
    }
  },

  collapseExpansionScope: (scope) => {
    const patch = writeExpansionScope(get(), scope, (paths) =>
      paths.size === 0 ? null : new Set<string>());
    if (patch) {
      set(patch);
    }
  },

  claimFileTreeStateKey: (materializedWorkspaceId, candidateTreeStateKey) => {
    if (!materializedWorkspaceId || !candidateTreeStateKey) {
      return;
    }
    const state = get();
    if (state.firstTreeStateKeyByMaterializedWorkspace.has(materializedWorkspaceId)) {
      return;
    }
    const next = new Map(state.firstTreeStateKeyByMaterializedWorkspace);
    next.set(materializedWorkspaceId, candidateTreeStateKey);
    set({ firstTreeStateKeyByMaterializedWorkspace: next });
  },

  pruneFileTreeSessionState: (materializedWorkspaceId) => {
    const state = get();
    const hasKey = state.firstTreeStateKeyByMaterializedWorkspace.has(
      materializedWorkspaceId,
    );
    const hasScopes = state.expandedPathsByMaterializedWorkspace.has(
      materializedWorkspaceId,
    );
    if (!hasKey && !hasScopes) {
      return;
    }
    const nextKeys = new Map(state.firstTreeStateKeyByMaterializedWorkspace);
    nextKeys.delete(materializedWorkspaceId);
    const nextScopes = new Map(state.expandedPathsByMaterializedWorkspace);
    nextScopes.delete(materializedWorkspaceId);
    set({
      firstTreeStateKeyByMaterializedWorkspace: nextKeys,
      expandedPathsByMaterializedWorkspace: nextScopes,
    });
  },
}));

export function selectFileTreeDesiredWidth(state: FileTreeState): number {
  return state.desiredWidth;
}

export function selectFileTreeRequestedVisibility(
  state: FileTreeState,
  keys: FileTreeVisibilityKeys,
): boolean {
  const map = state.requestedVisibilityByWorkspace;
  if (keys.primaryKey && hasOwnKey(map, keys.primaryKey)) {
    return map[keys.primaryKey];
  }
  if (keys.fallbackKey && hasOwnKey(map, keys.fallbackKey)) {
    return map[keys.fallbackKey];
  }
  return false;
}

export function selectFileTreeExpandedPaths(
  state: FileTreeState,
  scope: FileTreeExpansionScope | null,
): ReadonlySet<string> {
  if (!scope?.materializedWorkspaceId || !scope.treeStateKey) {
    return EMPTY_EXPANDED_PATHS;
  }
  return (
    state.expandedPathsByMaterializedWorkspace
      .get(scope.materializedWorkspaceId)
      ?.get(scope.treeStateKey) ?? EMPTY_EXPANDED_PATHS
  );
}

export function selectFileTreeStateKey(
  state: FileTreeState,
  input: {
    materializedWorkspaceId: string | null;
    candidateTreeStateKey: string | null;
  },
): string | null {
  if (!input.materializedWorkspaceId) {
    return null;
  }
  return (
    state.firstTreeStateKeyByMaterializedWorkspace.get(input.materializedWorkspaceId)
    ?? input.candidateTreeStateKey
  );
}

export function selectFileTreeDurableSnapshot(
  state: FileTreeState,
): PersistedFileTreeDockV1 {
  return {
    version: 1,
    width: state.desiredWidth,
    requestedVisibilityByWorkspace: { ...state.requestedVisibilityByWorkspace },
  };
}

export function resetFileTreeStoreForTests(): void {
  useFileTreeStore.setState({
    desiredWidth: FILE_TREE_DOCK_DEFAULT_WIDTH,
    requestedVisibilityByWorkspace: {},
    firstTreeStateKeyByMaterializedWorkspace: new Map<string, string>(),
    expandedPathsByMaterializedWorkspace: new Map(),
    durableRevision: 0,
  });
}
