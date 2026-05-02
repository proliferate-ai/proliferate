import { normalizeBrowserUrl } from "@/lib/domain/workspaces/browser-url";

export type RightPanelTool = "files" | "git" | "settings";
export type RightPanelHeaderEntryKey =
  | `tool:${RightPanelTool}`
  | `terminal:${string}`
  | `browser:${string}`;
export type RightPanelActiveEntryKey = RightPanelHeaderEntryKey;

export interface RightPanelBrowserTab {
  id: string;
  url: string | null;
}

export type RightPanelBrowserTabsById = Record<string, RightPanelBrowserTab>;

export interface RightPanelDurableState {
  open: boolean;
  width: number;
}

export interface RightPanelMaterializedState {
  activeEntryKey: RightPanelActiveEntryKey;
  headerOrder: RightPanelHeaderEntryKey[];
  browserTabsById: RightPanelBrowserTabsById;
}

export type RightPanelWorkspaceState = RightPanelMaterializedState;

export interface RightPanelTerminalRecord {
  id: string;
  purpose?: string | null;
}

export const RIGHT_PANEL_DEFAULT_WIDTH = 420;
export const RIGHT_PANEL_MIN_WIDTH = 260;
export const RIGHT_PANEL_MAX_WIDTH = 700;
export const RIGHT_PANEL_BROWSER_TAB_LIMIT = 5;

export const DEFAULT_RIGHT_PANEL_TOOL_ORDER: RightPanelTool[] = [
  "files",
  "git",
  "settings",
];
export const DEFAULT_RIGHT_PANEL_HEADER_ORDER: RightPanelHeaderEntryKey[] =
  DEFAULT_RIGHT_PANEL_TOOL_ORDER.map((tool) => rightPanelToolHeaderKey(tool));
export const DEFAULT_RIGHT_PANEL_DURABLE_STATE: RightPanelDurableState = {
  open: false,
  width: RIGHT_PANEL_DEFAULT_WIDTH,
};
export const DEFAULT_RIGHT_PANEL_MATERIALIZED_STATE: RightPanelMaterializedState = {
  activeEntryKey: "tool:files",
  headerOrder: DEFAULT_RIGHT_PANEL_HEADER_ORDER,
  browserTabsById: {},
};
export const DEFAULT_RIGHT_PANEL_WORKSPACE_STATE: RightPanelWorkspaceState =
  DEFAULT_RIGHT_PANEL_MATERIALIZED_STATE;

const RIGHT_PANEL_TOOLS = new Set<RightPanelTool>(DEFAULT_RIGHT_PANEL_TOOL_ORDER);
const BROWSER_TAB_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

export function rightPanelToolHeaderKey(tool: RightPanelTool): RightPanelHeaderEntryKey {
  return `tool:${tool}`;
}

export function rightPanelTerminalHeaderKey(terminalId: string): RightPanelHeaderEntryKey {
  return `terminal:${terminalId}`;
}

export function rightPanelBrowserHeaderKey(browserId: string): RightPanelHeaderEntryKey {
  return `browser:${browserId}`;
}

export function createRightPanelBrowserTabId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `browser-${Date.now().toString(36)}-${random}`;
}

export function parseRightPanelHeaderEntryKey(
  value: unknown,
):
  | { kind: "tool"; tool: RightPanelTool }
  | { kind: "terminal"; terminalId: string }
  | { kind: "browser"; browserId: string }
  | null {
  if (typeof value !== "string") {
    return null;
  }
  if (value.startsWith("tool:")) {
    const tool = value.slice("tool:".length);
    if (isRightPanelTool(tool)) {
      return { kind: "tool", tool };
    }
    return null;
  }
  if (value.startsWith("terminal:")) {
    const terminalId = value.slice("terminal:".length);
    if (terminalId) {
      return { kind: "terminal", terminalId };
    }
    return null;
  }
  if (value.startsWith("browser:")) {
    const browserId = value.slice("browser:".length);
    if (isValidBrowserTabId(browserId)) {
      return { kind: "browser", browserId };
    }
  }
  return null;
}

export function availableRightPanelTools(isCloudWorkspaceSelected: boolean): RightPanelTool[] {
  return DEFAULT_RIGHT_PANEL_TOOL_ORDER.filter(
    (tool) => tool !== "settings" || isCloudWorkspaceSelected,
  );
}

export function clampRightPanelWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return RIGHT_PANEL_DEFAULT_WIDTH;
  }
  return Math.min(RIGHT_PANEL_MAX_WIDTH, Math.max(RIGHT_PANEL_MIN_WIDTH, width));
}

export function normalizeRightPanelDurableState(
  input: Partial<RightPanelDurableState> | undefined,
): RightPanelDurableState {
  return {
    open: typeof input?.open === "boolean" ? input.open : DEFAULT_RIGHT_PANEL_DURABLE_STATE.open,
    width: clampRightPanelWidth(input?.width ?? DEFAULT_RIGHT_PANEL_DURABLE_STATE.width),
  };
}

export function normalizeRightPanelMaterializedState(
  input: Partial<RightPanelMaterializedState> | undefined,
  options: {
    isCloudWorkspaceSelected: boolean;
    liveTerminals?: readonly RightPanelTerminalRecord[];
  },
): RightPanelMaterializedState {
  const browserTabsById = sanitizeBrowserTabsById(input?.browserTabsById, input?.headerOrder);
  const headerOrder = normalizeRightPanelHeaderOrder(input?.headerOrder, {
    isCloudWorkspaceSelected: options.isCloudWorkspaceSelected,
    liveTerminals: options.liveTerminals,
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

export function isRightPanelTool(value: unknown): value is RightPanelTool {
  return typeof value === "string" && RIGHT_PANEL_TOOLS.has(value as RightPanelTool);
}

export function isBrowserEntryKey(entryKey: RightPanelHeaderEntryKey): boolean {
  return parseRightPanelHeaderEntryKey(entryKey)?.kind === "browser";
}

export function isTerminalEntryKey(entryKey: RightPanelHeaderEntryKey): boolean {
  return parseRightPanelHeaderEntryKey(entryKey)?.kind === "terminal";
}

export function terminalIdsFromHeaderOrder(
  headerOrder: readonly RightPanelHeaderEntryKey[] | undefined,
): string[] {
  const terminalIds: string[] = [];
  for (const key of headerOrder ?? []) {
    const entry = parseRightPanelHeaderEntryKey(key);
    if (entry?.kind === "terminal" && !terminalIds.includes(entry.terminalId)) {
      terminalIds.push(entry.terminalId);
    }
  }
  return terminalIds;
}

export function browserIdsFromHeaderOrder(
  headerOrder: readonly RightPanelHeaderEntryKey[] | undefined,
): string[] {
  const browserIds: string[] = [];
  for (const key of headerOrder ?? []) {
    const entry = parseRightPanelHeaderEntryKey(key);
    if (entry?.kind === "browser" && !browserIds.includes(entry.browserId)) {
      browserIds.push(entry.browserId);
    }
  }
  return browserIds;
}

export function browserTabTitle(tab: RightPanelBrowserTab, index: number): string {
  if (!tab.url) {
    return `Browser ${index + 1}`;
  }
  try {
    return new URL(tab.url).hostname || `Browser ${index + 1}`;
  } catch {
    return `Browser ${index + 1}`;
  }
}

function normalizeRightPanelHeaderOrder(
  headerOrder: readonly RightPanelHeaderEntryKey[] | undefined,
  options: {
    isCloudWorkspaceSelected: boolean;
    liveTerminals?: readonly RightPanelTerminalRecord[];
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
  }

  for (const tool of availableTools) {
    const key = rightPanelToolHeaderKey(tool);
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
  input: RightPanelActiveEntryKey | undefined,
  headerOrder: readonly RightPanelHeaderEntryKey[],
): RightPanelActiveEntryKey {
  const parsed = parseRightPanelHeaderEntryKey(input);
  if (parsed && headerOrder.includes(input!)) {
    return input!;
  }
  return resolveFallbackRightPanelActiveEntryKey(headerOrder);
}

function resolveFallbackRightPanelActiveEntryKey(
  headerOrder: readonly RightPanelHeaderEntryKey[],
): RightPanelActiveEntryKey {
  if (headerOrder.includes("tool:files")) {
    return "tool:files";
  }
  return headerOrder[0] ?? "tool:files";
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

function sanitizeBrowserTabsById(
  value: unknown,
  headerOrder: readonly RightPanelHeaderEntryKey[] | undefined,
): RightPanelBrowserTabsById {
  if (!isRecord(value)) {
    return {};
  }

  const headerBrowserIds = new Set(browserIdsFromHeaderOrder(headerOrder));
  const next: RightPanelBrowserTabsById = {};
  for (const [browserId, rawTab] of Object.entries(value)) {
    if (!isValidBrowserTabId(browserId) || !isRecord(rawTab)) {
      continue;
    }
    const tabId = rawTab.id;
    const rawUrl = rawTab.url;
    if (tabId !== browserId || !headerBrowserIds.has(browserId)) {
      continue;
    }
    if (rawUrl === null) {
      next[browserId] = { id: browserId, url: null };
      continue;
    }
    if (typeof rawUrl !== "string") {
      continue;
    }
    const normalizedUrl = normalizeBrowserUrl(rawUrl);
    if (!normalizedUrl) {
      continue;
    }
    next[browserId] = { id: browserId, url: normalizedUrl };
  }
  return next;
}

function pickBrowserTabsInHeader(
  browserTabsById: RightPanelBrowserTabsById,
  headerOrder: readonly RightPanelHeaderEntryKey[],
): RightPanelBrowserTabsById {
  const next: RightPanelBrowserTabsById = {};
  for (const browserId of browserIdsFromHeaderOrder(headerOrder)) {
    const tab = browserTabsById[browserId];
    if (tab) {
      next[browserId] = tab;
    }
  }
  return next;
}

function isValidBrowserTabId(value: unknown): value is string {
  return typeof value === "string" && BROWSER_TAB_ID_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
