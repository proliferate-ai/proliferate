import {
  DEFAULT_RIGHT_PANEL_MATERIALIZED_STATE,
  RIGHT_PANEL_BROWSER_TAB_LIMIT,
  availableRightPanelTools,
  browserIdsFromHeaderOrder,
  parseRightPanelHeaderEntryKey,
  rightPanelBrowserHeaderKey,
  rightPanelTerminalHeaderKey,
  rightPanelToolHeaderKey,
  terminalIdsFromHeaderOrder,
  type RightPanelActiveEntryKey,
  type RightPanelBrowserTabsById,
  type RightPanelHeaderEntryKey,
  type RightPanelMaterializedState,
  type RightPanelTerminalRecord,
  type RightPanelTool,
  type RightPanelWorkspaceState,
} from "@/lib/domain/workspaces/shell/right-panel-model";
import {
  pickBrowserTabsInHeader,
  sanitizeBrowserTabsById,
} from "@/lib/domain/workspaces/shell/right-panel-browser-tabs";
import {
  viewerTargetKey,
  type ViewerTargetKey,
  type ViewerTarget,
} from "@/lib/domain/workspaces/viewer/viewer-target";

export function normalizeRightPanelMaterializedState(
  input: Partial<RightPanelMaterializedState> | undefined,
  options: {
    isCloudWorkspaceSelected: boolean;
    liveTerminals?: readonly RightPanelTerminalRecord[];
    liveViewerTargets?: readonly ViewerTarget[];
  },
): RightPanelMaterializedState {
  const browserTabsById = sanitizeBrowserTabsById(input?.browserTabsById, input?.headerOrder);
  const headerOrder = normalizeRightPanelHeaderOrder(input?.headerOrder, {
    isCloudWorkspaceSelected: options.isCloudWorkspaceSelected,
    liveTerminals: options.liveTerminals,
    liveViewerTargets: options.liveViewerTargets,
    browserTabsById,
  });
  const activeEntryKey = resolveRightPanelActiveEntryKey(input?.activeEntryKey, headerOrder);

  return {
    activeEntryKey,
    headerOrder,
    browserTabsById: pickBrowserTabsInHeader(browserTabsById, headerOrder),
  };
}

export function reconcileRightPanelWorkspaceState(
  input: Partial<RightPanelWorkspaceState> | undefined,
  options: {
    isCloudWorkspaceSelected: boolean;
    liveTerminals?: readonly RightPanelTerminalRecord[];
    liveViewerTargets?: readonly ViewerTarget[];
  },
): RightPanelWorkspaceState {
  // Runtime callers rely on reconciliation converging after one pass; keep
  // normalizeRightPanelMaterializedState idempotent when adding new fields.
  return normalizeRightPanelMaterializedState(input, options);
}

export function removeTerminalFromRightPanelState(
  input: Partial<RightPanelWorkspaceState> | undefined,
  terminalId: string,
  isCloudWorkspaceSelected: boolean,
): RightPanelWorkspaceState {
  const state = reconcileRightPanelWorkspaceState(input, { isCloudWorkspaceSelected });
  return removeHeaderEntryFromState(state, rightPanelTerminalHeaderKey(terminalId), {
    isCloudWorkspaceSelected,
  });
}

export function removeBrowserTabFromRightPanelState(
  input: Partial<RightPanelWorkspaceState> | undefined,
  browserId: string,
  isCloudWorkspaceSelected: boolean,
): RightPanelWorkspaceState {
  const state = reconcileRightPanelWorkspaceState(input, { isCloudWorkspaceSelected });
  const { [browserId]: _removed, ...browserTabsById } = state.browserTabsById;
  return removeHeaderEntryFromState(
    { ...state, browserTabsById },
    rightPanelBrowserHeaderKey(browserId),
    { isCloudWorkspaceSelected },
  );
}

export function removeViewerTargetFromRightPanelState(
  input: Partial<RightPanelWorkspaceState> | undefined,
  targetKey: ViewerTargetKey,
  isCloudWorkspaceSelected: boolean,
): RightPanelWorkspaceState {
  const state = reconcileRightPanelWorkspaceState(input, { isCloudWorkspaceSelected });
  const removedIndex = state.headerOrder.indexOf(targetKey);
  const headerOrder = state.headerOrder.filter((key) => key !== targetKey);
  const fallbackEntryKey = removedIndex > 0
    ? headerOrder[removedIndex - 1]
    : headerOrder[removedIndex] ?? "tool:git";

  return reconcileRightPanelWorkspaceState(
    {
      ...state,
      headerOrder,
      activeEntryKey: state.activeEntryKey === targetKey
        ? fallbackEntryKey
        : state.activeEntryKey,
    },
    { isCloudWorkspaceSelected },
  );
}

export function resolveViewerTargetKeyAfterHeaderEntryRemoval(
  headerOrder: readonly RightPanelHeaderEntryKey[],
  targetKey: RightPanelHeaderEntryKey,
): ViewerTargetKey | null {
  const removedIndex = headerOrder.indexOf(targetKey);
  const nextHeaderOrder = headerOrder.filter((key) => key !== targetKey);
  const fallbackEntryKey = removedIndex > 0
    ? nextHeaderOrder[removedIndex - 1]
    : nextHeaderOrder[removedIndex] ?? null;
  const fallbackEntry = parseRightPanelHeaderEntryKey(fallbackEntryKey);
  return fallbackEntry?.kind === "viewer" ? fallbackEntry.targetKey : null;
}

export function createBrowserTabInRightPanelState(
  input: Partial<RightPanelWorkspaceState> | undefined,
  browserId: string,
  isCloudWorkspaceSelected: boolean,
): RightPanelWorkspaceState {
  const state = reconcileRightPanelWorkspaceState(input, { isCloudWorkspaceSelected });
  if (!canCreateRightPanelBrowserTab(state)) {
    return state;
  }
  const key = rightPanelBrowserHeaderKey(browserId);
  return reconcileRightPanelWorkspaceState(
    {
      ...state,
      activeEntryKey: key,
      headerOrder: state.headerOrder.includes(key) ? state.headerOrder : [...state.headerOrder, key],
      browserTabsById: {
        ...state.browserTabsById,
        [browserId]: { id: browserId, url: null },
      },
    },
    { isCloudWorkspaceSelected },
  );
}

export function createOrActivateBrowserTabInRightPanelState(
  input: Partial<RightPanelWorkspaceState> | undefined,
  browserId: string,
  isCloudWorkspaceSelected: boolean,
): RightPanelWorkspaceState {
  const state = reconcileRightPanelWorkspaceState(input, { isCloudWorkspaceSelected });
  if (canCreateRightPanelBrowserTab(state)) {
    return createBrowserTabInRightPanelState(state, browserId, isCloudWorkspaceSelected);
  }

  const browserIds = browserIdsFromHeaderOrder(state.headerOrder);
  const existingBrowserId = browserIds[browserIds.length - 1];
  if (!existingBrowserId || !state.browserTabsById[existingBrowserId]) {
    return state;
  }

  return {
    ...state,
    activeEntryKey: rightPanelBrowserHeaderKey(existingBrowserId),
  };
}

export function updateBrowserTabUrlInRightPanelState(
  input: Partial<RightPanelWorkspaceState> | undefined,
  browserId: string,
  url: string | null,
  isCloudWorkspaceSelected: boolean,
): RightPanelWorkspaceState {
  const state = reconcileRightPanelWorkspaceState(input, { isCloudWorkspaceSelected });
  const tab = state.browserTabsById[browserId];
  if (!tab) {
    return state;
  }
  return reconcileRightPanelWorkspaceState(
    {
      ...state,
      browserTabsById: {
        ...state.browserTabsById,
        [browserId]: { ...tab, url },
      },
    },
    { isCloudWorkspaceSelected },
  );
}

export function canCreateRightPanelBrowserTab(
  input: Partial<RightPanelWorkspaceState> | undefined,
): boolean {
  const count = browserIdsFromHeaderOrder(input?.headerOrder)
    .filter((browserId) => Boolean(input?.browserTabsById?.[browserId]))
    .length;
  return count < RIGHT_PANEL_BROWSER_TAB_LIMIT;
}

export function reorderHeaderEntryInRightPanelState(
  input: Partial<RightPanelWorkspaceState> | undefined,
  entryKey: RightPanelHeaderEntryKey,
  beforeEntryKey: RightPanelHeaderEntryKey | null,
  isCloudWorkspaceSelected: boolean,
): RightPanelWorkspaceState {
  const state = reconcileRightPanelWorkspaceState(input, { isCloudWorkspaceSelected });
  if (!state.headerOrder.includes(entryKey) || beforeEntryKey === entryKey) {
    return state;
  }

  const remaining = state.headerOrder.filter((key) => key !== entryKey);
  const insertIndex = beforeEntryKey ? remaining.indexOf(beforeEntryKey) : -1;
  const headerOrder = insertIndex >= 0
    ? [
        ...remaining.slice(0, insertIndex),
        entryKey,
        ...remaining.slice(insertIndex),
      ]
    : [...remaining, entryKey];

  return reconcileRightPanelWorkspaceState(
    {
      ...state,
      headerOrder,
    },
    { isCloudWorkspaceSelected },
  );
}

export function reorderTerminalInRightPanelState(
  input: Partial<RightPanelWorkspaceState> | undefined,
  terminalId: string,
  beforeTerminalId: string | null,
  isCloudWorkspaceSelected: boolean,
): RightPanelWorkspaceState {
  return reorderHeaderEntryInRightPanelState(
    input,
    rightPanelTerminalHeaderKey(terminalId),
    beforeTerminalId ? rightPanelTerminalHeaderKey(beforeTerminalId) : null,
    isCloudWorkspaceSelected,
  );
}

export function reorderToolInRightPanelState(
  input: Partial<RightPanelWorkspaceState> | undefined,
  tool: RightPanelTool,
  beforeTool: RightPanelTool | null,
  isCloudWorkspaceSelected: boolean,
): RightPanelWorkspaceState {
  return reorderHeaderEntryInRightPanelState(
    input,
    rightPanelToolHeaderKey(tool),
    beforeTool ? rightPanelToolHeaderKey(beforeTool) : null,
    isCloudWorkspaceSelected,
  );
}

function normalizeRightPanelHeaderOrder(
  headerOrder: readonly RightPanelHeaderEntryKey[] | undefined,
  options: {
    isCloudWorkspaceSelected: boolean;
    liveTerminals?: readonly RightPanelTerminalRecord[];
    liveViewerTargets?: readonly ViewerTarget[];
    browserTabsById: RightPanelBrowserTabsById;
  },
): RightPanelHeaderEntryKey[] {
  const availableTools = availableRightPanelTools(options.isCloudWorkspaceSelected);
  const validToolKeys = new Set(availableTools.map((tool) => rightPanelToolHeaderKey(tool)));
  const source = headerOrder && headerOrder.length > 0
    ? headerOrder
    : availableTools.map((tool) => rightPanelToolHeaderKey(tool));
  const terminalIdsInSource = new Set(terminalIdsFromHeaderOrder(source));
  const terminalIds = resolveValidTerminalIds(source, options.liveTerminals, terminalIdsInSource);
  const validTerminalKeys = new Set(
    terminalIds.map((terminalId) => rightPanelTerminalHeaderKey(terminalId)),
  );
  const validBrowserKeys = new Set(
    browserIdsFromHeaderOrder(source)
      .filter((browserId) => Boolean(options.browserTabsById[browserId]))
      .map((browserId) => rightPanelBrowserHeaderKey(browserId)),
  );
  const validViewerKeys = resolveValidViewerKeys(source, options.liveViewerTargets);
  const next: RightPanelHeaderEntryKey[] = [];

  for (const key of source) {
    const entry = parseRightPanelHeaderEntryKey(key);
    if (!entry || next.includes(key)) {
      continue;
    }
    if (entry.kind === "tool" && validToolKeys.has(key)) {
      next.push(key);
    }
    if (entry.kind === "terminal" && validTerminalKeys.has(key)) {
      next.push(key);
    }
    if (entry.kind === "browser" && validBrowserKeys.has(key)) {
      next.push(key);
    }
    if (entry.kind === "viewer" && validViewerKeys.has(entry.targetKey)) {
      next.push(entry.targetKey);
    }
  }

  for (const tool of availableTools) {
    const key = rightPanelToolHeaderKey(tool);
    if (!next.includes(key)) {
      next.push(key);
    }
  }
  for (const key of validViewerKeys) {
    if (!next.includes(key)) {
      next.push(key);
    }
  }
  for (const terminalId of terminalIds) {
    const key = rightPanelTerminalHeaderKey(terminalId);
    if (!next.includes(key)) {
      next.push(key);
    }
  }

  return next;
}

function resolveValidViewerKeys(
  source: readonly RightPanelHeaderEntryKey[],
  liveViewerTargets: readonly ViewerTarget[] | undefined,
): Set<RightPanelHeaderEntryKey> {
  const sourceViewerKeys = source
    .map((key) => parseRightPanelHeaderEntryKey(key))
    .filter((entry): entry is Extract<
      NonNullable<ReturnType<typeof parseRightPanelHeaderEntryKey>>,
      { kind: "viewer" }
    > => entry?.kind === "viewer")
    .filter((entry) => entry.target.kind !== "allChanges")
    .map((entry) => entry.targetKey);

  if (!liveViewerTargets) {
    return new Set(sourceViewerKeys);
  }

  const keys = new Set<RightPanelHeaderEntryKey>();
  const liveViewerKeys = liveViewerTargets
    .filter((target) => target.kind !== "allChanges")
    .map((target) => viewerTargetKey(target));
  const liveViewerKeySet = new Set(liveViewerKeys);

  for (const key of sourceViewerKeys) {
    if (liveViewerKeySet.has(key)) {
      keys.add(key);
    }
  }
  for (const key of liveViewerKeys) {
    keys.add(key);
  }

  return keys;
}

function resolveValidTerminalIds(
  source: readonly RightPanelHeaderEntryKey[],
  liveTerminals: readonly RightPanelTerminalRecord[] | undefined,
  terminalIdsInSource: ReadonlySet<string>,
): string[] {
  if (!liveTerminals) {
    return terminalIdsFromHeaderOrder(source);
  }

  const terminalIds: string[] = [];
  for (const terminal of liveTerminals) {
    const isSetup = terminal.purpose === "setup";
    if (isSetup && !terminalIdsInSource.has(terminal.id)) {
      continue;
    }
    if (!terminalIds.includes(terminal.id)) {
      terminalIds.push(terminal.id);
    }
  }
  return terminalIds;
}

function resolveRightPanelActiveEntryKey(
  input: RightPanelActiveEntryKey | "tool:allChanges" | undefined,
  headerOrder: readonly RightPanelHeaderEntryKey[],
): RightPanelActiveEntryKey {
  if (input === "tool:allChanges" && headerOrder.includes("tool:git")) {
    return "tool:git";
  }
  if (input && input !== "tool:allChanges") {
    const parsed = parseRightPanelHeaderEntryKey(input);
    if (parsed && headerOrder.includes(input)) {
      return input;
    }
  }
  return resolveFallbackRightPanelActiveEntryKey(headerOrder);
}

function resolveFallbackRightPanelActiveEntryKey(
  headerOrder: readonly RightPanelHeaderEntryKey[],
): RightPanelActiveEntryKey {
  if (headerOrder.includes("tool:scratch")) {
    return "tool:scratch";
  }
  return headerOrder[0] ?? DEFAULT_RIGHT_PANEL_MATERIALIZED_STATE.activeEntryKey;
}

function removeHeaderEntryFromState(
  state: RightPanelWorkspaceState,
  entryKey: RightPanelHeaderEntryKey,
  options: {
    isCloudWorkspaceSelected: boolean;
  },
): RightPanelWorkspaceState {
  const index = state.headerOrder.indexOf(entryKey);
  const headerOrder = state.headerOrder.filter((key) => key !== entryKey);
  const nextActiveEntryKey = state.activeEntryKey === entryKey
    ? resolveNearestFallbackEntryKey(headerOrder, index)
    : state.activeEntryKey;
  return reconcileRightPanelWorkspaceState(
    {
      ...state,
      activeEntryKey: nextActiveEntryKey,
      headerOrder,
    },
    { isCloudWorkspaceSelected: options.isCloudWorkspaceSelected },
  );
}

function resolveNearestFallbackEntryKey(
  headerOrder: readonly RightPanelHeaderEntryKey[],
  removedIndex: number,
): RightPanelActiveEntryKey {
  const previous = removedIndex > 0 ? headerOrder[removedIndex - 1] : undefined;
  if (previous) {
    return previous;
  }
  const next = removedIndex >= 0 ? headerOrder[removedIndex] : undefined;
  if (next) {
    return next;
  }
  return resolveFallbackRightPanelActiveEntryKey(headerOrder);
}
