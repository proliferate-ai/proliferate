import {
  parseViewerTargetKey,
  viewerTargetKey,
  type ViewerTarget,
  type ViewerTargetKey,
} from "@/lib/domain/workspaces/viewer/viewer-target";

export type RightPanelTool = "scratch" | "files" | "git" | "settings";
export type RightPanelHeaderEntryKey =
  | `tool:${RightPanelTool}`
  | `terminal:${string}`
  | `browser:${string}`
  | ViewerTargetKey;
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
  "scratch",
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
  activeEntryKey: "tool:scratch",
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

export function rightPanelViewerHeaderKey(target: ViewerTarget): ViewerTargetKey {
  return viewerTargetKey(target);
}

export function parseRightPanelHeaderEntryKey(
  value: unknown,
):
  | { kind: "tool"; tool: RightPanelTool }
  | { kind: "terminal"; terminalId: string }
  | { kind: "browser"; browserId: string }
  | { kind: "viewer"; target: ViewerTarget; targetKey: ViewerTargetKey }
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
    if (isValidRightPanelBrowserTabId(browserId)) {
      return { kind: "browser", browserId };
    }
  }
  const viewerTarget = parseViewerTargetKey(value);
  if (viewerTarget) {
    return { kind: "viewer", target: viewerTarget, targetKey: viewerTargetKey(viewerTarget) };
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

export function viewerTargetKeysFromHeaderOrder(
  headerOrder: readonly RightPanelHeaderEntryKey[] | undefined,
): ViewerTargetKey[] {
  const targetKeys: ViewerTargetKey[] = [];
  for (const key of headerOrder ?? []) {
    const entry = parseRightPanelHeaderEntryKey(key);
    if (entry?.kind === "viewer" && !targetKeys.includes(entry.targetKey)) {
      targetKeys.push(entry.targetKey);
    }
  }
  return targetKeys;
}

export function isValidRightPanelBrowserTabId(value: unknown): value is string {
  return typeof value === "string" && BROWSER_TAB_ID_PATTERN.test(value);
}
