import {
  RIGHT_PANEL_BROWSER_TAB_LIMIT,
  browserIdsFromHeaderOrder,
  parseRightPanelHeaderEntryKey,
  rightPanelBrowserHeaderKey,
  rightPanelTerminalHeaderKey,
  rightPanelToolHeaderKey,
  type RightPanelHeaderEntryKey,
  type RightPanelTool,
  type RightPanelWorkspaceState,
} from "@/lib/domain/workspaces/shell/right-panel-model";
import {
  type ViewerTargetKey,
} from "@/lib/domain/workspaces/viewer/viewer-target";
import {
  reconcileRightPanelWorkspaceState,
  resolveNearestRightPanelFallbackEntryKey,
} from "@/lib/domain/workspaces/shell/right-panel-state-normalization";

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
    ? resolveNearestRightPanelFallbackEntryKey(headerOrder, index)
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
