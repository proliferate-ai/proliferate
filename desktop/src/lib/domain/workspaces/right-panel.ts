export type RightPanelTool = "files" | "git" | "settings" | "terminal";
export type RightPanelHeaderTool = Exclude<RightPanelTool, "terminal">;
export type RightPanelHeaderEntryKey =
  | `tool:${RightPanelHeaderTool}`
  | `terminal:${string}`;

export interface RightPanelWorkspaceState {
  activeTool: RightPanelTool;
  toolOrder: RightPanelTool[];
  terminalOrder: string[];
  headerOrder: RightPanelHeaderEntryKey[];
  activeTerminalId: string | null;
}

export const RIGHT_PANEL_DEFAULT_WIDTH = 420;
export const RIGHT_PANEL_MIN_WIDTH = 260;
export const RIGHT_PANEL_MAX_WIDTH = 700;

export const DEFAULT_RIGHT_PANEL_TOOL_ORDER: RightPanelTool[] = [
  "files",
  "git",
  "settings",
];
export const DEFAULT_RIGHT_PANEL_HEADER_ORDER: RightPanelHeaderEntryKey[] =
  DEFAULT_RIGHT_PANEL_TOOL_ORDER.map((tool) => rightPanelToolHeaderKey(tool));

export const DEFAULT_RIGHT_PANEL_WORKSPACE_STATE: RightPanelWorkspaceState = {
  activeTool: "git",
  toolOrder: DEFAULT_RIGHT_PANEL_TOOL_ORDER,
  terminalOrder: [],
  headerOrder: DEFAULT_RIGHT_PANEL_HEADER_ORDER,
  activeTerminalId: null,
};

const RIGHT_PANEL_TOOLS = new Set<RightPanelTool>([
  ...DEFAULT_RIGHT_PANEL_TOOL_ORDER,
  "terminal",
]);

export function rightPanelToolHeaderKey(tool: RightPanelTool): RightPanelHeaderEntryKey {
  if (tool === "terminal") {
    throw new Error("terminal is not a singleton right-panel header tool");
  }
  return `tool:${tool}`;
}

export function rightPanelTerminalHeaderKey(terminalId: string): RightPanelHeaderEntryKey {
  return `terminal:${terminalId}`;
}

export function parseRightPanelHeaderEntryKey(
  value: unknown,
):
  | { kind: "tool"; tool: RightPanelHeaderTool }
  | { kind: "terminal"; terminalId: string }
  | null {
  if (typeof value !== "string") {
    return null;
  }
  if (value.startsWith("tool:")) {
    const tool = value.slice("tool:".length);
    if (isRightPanelTool(tool) && tool !== "terminal") {
      return { kind: "tool", tool };
    }
    return null;
  }
  if (value.startsWith("terminal:")) {
    const terminalId = value.slice("terminal:".length);
    if (terminalId) {
      return { kind: "terminal", terminalId };
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

export function normalizeRightPanelToolOrder(
  toolOrder: readonly RightPanelTool[] | undefined,
  isCloudWorkspaceSelected: boolean,
): RightPanelTool[] {
  const availableTools = availableRightPanelTools(isCloudWorkspaceSelected);
  const availableSet = new Set(availableTools);
  const next: RightPanelTool[] = [];

  for (const tool of toolOrder ?? []) {
    if (availableSet.has(tool) && !next.includes(tool)) {
      next.push(tool);
    }
  }

  for (const tool of availableTools) {
    if (!next.includes(tool)) {
      next.push(tool);
    }
  }

  return next;
}

export function resolveRightPanelActiveTool(
  activeTool: RightPanelTool | undefined,
  toolOrder: readonly RightPanelTool[],
  activeTerminalId?: string | null,
): RightPanelTool {
  if (activeTool === "terminal" && activeTerminalId) {
    return "terminal";
  }
  if (activeTool && toolOrder.includes(activeTool)) {
    return activeTool;
  }
  if (toolOrder.includes("git")) {
    return "git";
  }
  return toolOrder[0] ?? "files";
}

export function mergeTerminalOrder(
  terminalOrder: readonly string[] | undefined,
  liveTerminalIds: readonly string[],
): string[] {
  const liveSet = new Set(liveTerminalIds);
  const next: string[] = [];

  for (const terminalId of terminalOrder ?? []) {
    if (liveSet.has(terminalId) && !next.includes(terminalId)) {
      next.push(terminalId);
    }
  }

  for (const terminalId of liveTerminalIds) {
    if (!next.includes(terminalId)) {
      next.push(terminalId);
    }
  }

  return next;
}

export function resolveActiveTerminalId(
  activeTerminalId: string | null | undefined,
  terminalOrder: readonly string[],
): string | null {
  if (activeTerminalId && terminalOrder.includes(activeTerminalId)) {
    return activeTerminalId;
  }
  return terminalOrder[0] ?? null;
}

export function reconcileRightPanelWorkspaceState(
  input: Partial<RightPanelWorkspaceState> | undefined,
  options: {
    isCloudWorkspaceSelected: boolean;
    liveTerminalIds?: readonly string[];
  },
): RightPanelWorkspaceState {
  const toolOrderHints = [
    ...toolsFromHeaderOrder(input?.headerOrder),
    ...(input?.toolOrder ?? []),
  ];
  const toolOrder = normalizeRightPanelToolOrder(
    toolOrderHints,
    options.isCloudWorkspaceSelected,
  );
  const terminalOrderHints = [
    ...terminalIdsFromHeaderOrder(input?.headerOrder),
    ...(input?.terminalOrder ?? []),
  ];
  const terminalOrder = options.liveTerminalIds
    ? mergeTerminalOrder(terminalOrderHints, options.liveTerminalIds)
    : uniqueStringList(terminalOrderHints);
  const headerOrder = normalizeRightPanelHeaderOrder(
    input?.headerOrder,
    toolOrder,
    terminalOrder,
  );
  const activeTerminalId = resolveActiveTerminalId(input?.activeTerminalId, terminalOrder);

  return {
    activeTool: resolveRightPanelActiveTool(input?.activeTool, toolOrder, activeTerminalId),
    toolOrder,
    terminalOrder,
    headerOrder,
    activeTerminalId,
  };
}

export function removeTerminalFromRightPanelState(
  input: Partial<RightPanelWorkspaceState> | undefined,
  terminalId: string,
  isCloudWorkspaceSelected: boolean,
): RightPanelWorkspaceState {
  const state = reconcileRightPanelWorkspaceState(input, { isCloudWorkspaceSelected });
  const terminalOrder = state.terminalOrder.filter((id) => id !== terminalId);
  const terminalKey = rightPanelTerminalHeaderKey(terminalId);
  const headerOrder = state.headerOrder.filter((key) => key !== terminalKey);
  const activeTerminalId = resolveActiveTerminalId(
    state.activeTerminalId === terminalId ? null : state.activeTerminalId,
    terminalOrder,
  );
  return {
    ...state,
    terminalOrder,
    headerOrder,
    activeTerminalId,
    activeTool: resolveRightPanelActiveTool(state.activeTool, state.toolOrder, activeTerminalId),
  };
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
  if (tool === "terminal") {
    return reconcileRightPanelWorkspaceState(input, { isCloudWorkspaceSelected });
  }
  return reorderHeaderEntryInRightPanelState(
    input,
    rightPanelToolHeaderKey(tool),
    beforeTool && beforeTool !== "terminal" ? rightPanelToolHeaderKey(beforeTool) : null,
    isCloudWorkspaceSelected,
  );
}

export function isRightPanelTool(value: unknown): value is RightPanelTool {
  return typeof value === "string" && RIGHT_PANEL_TOOLS.has(value as RightPanelTool);
}

function uniqueStringList(value: readonly string[] | undefined): string[] {
  const next: string[] = [];
  for (const item of value ?? []) {
    if (typeof item === "string" && item && !next.includes(item)) {
      next.push(item);
    }
  }
  return next;
}

function normalizeRightPanelHeaderOrder(
  headerOrder: readonly RightPanelHeaderEntryKey[] | undefined,
  toolOrder: readonly RightPanelTool[],
  terminalOrder: readonly string[],
): RightPanelHeaderEntryKey[] {
  const toolKeys = toolOrder
    .filter((tool) => tool !== "terminal")
    .map((tool) => rightPanelToolHeaderKey(tool));
  const terminalKeys = terminalOrder.map((terminalId) => rightPanelTerminalHeaderKey(terminalId));
  const validToolKeys = new Set(toolKeys);
  const validTerminalKeys = new Set(terminalKeys);
  const source = headerOrder && headerOrder.length > 0
    ? headerOrder
    : [...toolKeys, ...terminalKeys];
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
  }

  for (const key of [...toolKeys, ...terminalKeys]) {
    if (!next.includes(key)) {
      next.push(key);
    }
  }

  return next;
}

function toolsFromHeaderOrder(
  headerOrder: readonly RightPanelHeaderEntryKey[] | undefined,
): RightPanelTool[] {
  const tools: RightPanelTool[] = [];
  for (const key of headerOrder ?? []) {
    const entry = parseRightPanelHeaderEntryKey(key);
    if (entry?.kind === "tool" && !tools.includes(entry.tool)) {
      tools.push(entry.tool);
    }
  }
  return tools;
}

function terminalIdsFromHeaderOrder(
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
